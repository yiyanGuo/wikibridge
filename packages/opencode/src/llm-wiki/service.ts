import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { LlmWikiConfig } from "@/llm-wiki/config"
import type { FileContent, Files, FilesQueryShape, Graph, GraphQueryShape, Health, Projects, Rescan, Reviews, ReviewsQueryShape, Search, SearchRequestShape } from "@/llm-wiki/types"
import { FileContentResponse, FilesResponse, GraphResponse, HealthResponse, ProjectsResponse, RescanResponse, ReviewsResponse, SearchRequest, SearchResponse } from "@/llm-wiki/types"
import { Context, Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { LlmWikiNotFoundError, LlmWikiUnauthorizedError, LlmWikiUnavailableError } from "./error"

export interface Interface {
  readonly health: () => Effect.Effect<Health, LlmWikiUnavailableError | LlmWikiUnauthorizedError | LlmWikiNotFoundError>
  readonly projects: () => Effect.Effect<Projects, LlmWikiUnavailableError | LlmWikiUnauthorizedError | LlmWikiNotFoundError>
  readonly files: (input: { projectId: string; query: FilesQueryShape }) => Effect.Effect<Files, LlmWikiUnavailableError | LlmWikiUnauthorizedError | LlmWikiNotFoundError>
  readonly fileContent: (input: { projectId: string; path: string }) => Effect.Effect<FileContent, LlmWikiUnavailableError | LlmWikiUnauthorizedError | LlmWikiNotFoundError>
  readonly reviews: (input: { projectId: string; query: ReviewsQueryShape }) => Effect.Effect<Reviews, LlmWikiUnavailableError | LlmWikiUnauthorizedError | LlmWikiNotFoundError>
  readonly search: (input: { projectId: string; payload: SearchRequestShape }) => Effect.Effect<Search, LlmWikiUnavailableError | LlmWikiUnauthorizedError | LlmWikiNotFoundError>
  readonly graph: (input: { projectId: string; query: GraphQueryShape }) => Effect.Effect<Graph, LlmWikiUnavailableError | LlmWikiUnauthorizedError | LlmWikiNotFoundError>
  readonly rescanSources: (input: { projectId: string }) => Effect.Effect<Rescan, LlmWikiUnavailableError | LlmWikiUnauthorizedError | LlmWikiNotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LlmWiki") {}

export const use = serviceUse(Service)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const client = withTransientReadRetry(yield* HttpClient.HttpClient)
    const config = yield* LlmWikiConfig.Service

    const execute = <A, E>(
      request: Effect.Effect<HttpClientRequest.HttpClientRequest, E>,
      decode: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<A, LlmWikiUnavailableError>,
    ) =>
      Effect.gen(function* () {
        const prepared = yield* request
        const response = yield* client
          .execute(
            prepared.pipe(
              HttpClientRequest.acceptJson,
              HttpClientRequest.setHeaders({
                Accept: "application/json",
                ...(Option.isSome(config.token)
                  ? {
                      Authorization: `Bearer ${config.token.value}`,
                      "X-LLM-Wiki-Token": config.token.value,
                    }
                  : {}),
              }),
            ),
          ).pipe(
            Effect.mapError(
              (error) =>
                new LlmWikiUnavailableError({
                  message: `llm_wiki request failed before send: ${error instanceof Error ? error.message : String(error)}`,
                }),
            ),
          )
          .pipe(
            Effect.mapError(
              (error) =>
                new LlmWikiUnavailableError({
                  message: `llm_wiki request failed: ${error instanceof Error ? error.message : String(error)}`,
                }),
            ),
          )

        if (response.status === 401) return yield* new LlmWikiUnauthorizedError({ message: yield* errorMessage(response) })
        if (response.status === 404) return yield* new LlmWikiNotFoundError({ message: yield* errorMessage(response) })
        if (response.status < 200 || response.status >= 300) {
          return yield* new LlmWikiUnavailableError({ message: yield* errorMessage(response), status: response.status })
        }
        return yield* decode(response)
      })

    const decode = <A>(schema: unknown) =>
      (response: HttpClientResponse.HttpClientResponse) =>
        HttpClientResponse.schemaBodyJson(schema as never)(response).pipe(
          Effect.mapError(
            (error) =>
              new LlmWikiUnavailableError({
                message: `llm_wiki returned an invalid response: ${error instanceof Error ? error.message : String(error)}`,
                status: response.status,
              }),
          ),
        ) as Effect.Effect<A, LlmWikiUnavailableError>

    const health = Effect.fn("LlmWiki.health")(() =>
      execute(Effect.succeed(HttpClientRequest.get(`${config.baseUrl}/health`)), decode<Health>(HealthResponse)),
    )
    const projects = Effect.fn("LlmWiki.projects")(() =>
      execute(Effect.succeed(HttpClientRequest.get(`${config.baseUrl}/projects`)), decode<Projects>(ProjectsResponse)),
    )
    const files = Effect.fn("LlmWiki.files")((input: { projectId: string; query: FilesQueryShape }) =>
      execute(
        Effect.succeed(
          HttpClientRequest.get(
            `${config.baseUrl}/projects/${encodeURIComponent(input.projectId)}/files?${queryParams(input.query).toString()}`,
          ),
        ),
        decode<Files>(FilesResponse),
      ),
    )
    const fileContent = Effect.fn("LlmWiki.fileContent")((input: { projectId: string; path: string }) =>
      execute(
        Effect.succeed(
          HttpClientRequest.get(
            `${config.baseUrl}/projects/${encodeURIComponent(input.projectId)}/files/content?${queryParams({ path: input.path }).toString()}`,
          ),
        ),
        decode<FileContent>(FileContentResponse),
      ),
    )
    const reviews = Effect.fn("LlmWiki.reviews")((input: { projectId: string; query: ReviewsQueryShape }) =>
      execute(
        Effect.succeed(
          HttpClientRequest.get(
            `${config.baseUrl}/projects/${encodeURIComponent(input.projectId)}/reviews?${queryParams(input.query).toString()}`,
          ),
        ),
        decode<Reviews>(ReviewsResponse),
      ),
    )
    const search = Effect.fn("LlmWiki.search")((input: { projectId: string; payload: SearchRequestShape }) =>
      execute(
        HttpClientRequest.post(`${config.baseUrl}/projects/${encodeURIComponent(input.projectId)}/search`).pipe(
          HttpClientRequest.setHeader("content-type", "application/json"),
          HttpClientRequest.bodyJson(input.payload),
          Effect.mapError(
            (error) =>
              new LlmWikiUnavailableError({
                message: `llm_wiki request body encoding failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
          ),
        ),
        decode<Search>(SearchResponse),
      ),
    )
    const graph = Effect.fn("LlmWiki.graph")((input: { projectId: string; query: GraphQueryShape }) =>
      execute(
        Effect.succeed(
          HttpClientRequest.get(
            `${config.baseUrl}/projects/${encodeURIComponent(input.projectId)}/graph?${queryParams(input.query).toString()}`,
          ),
        ),
        decode<Graph>(GraphResponse),
      ),
    )
    const rescanSources = Effect.fn("LlmWiki.rescanSources")((input: { projectId: string }) =>
      execute(
        Effect.succeed(HttpClientRequest.post(`${config.baseUrl}/projects/${encodeURIComponent(input.projectId)}/sources/rescan`)),
        decode<Rescan>(RescanResponse),
      ),
    )

    return Service.of({ health, projects, files, fileContent, reviews, search, graph, rescanSources })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(LlmWikiConfig.defaultLayer))

function queryParams(input: Record<string, string | number | boolean | undefined>) {
  return Object.entries(input).reduce((params, [key, value]) => {
    if (value !== undefined) params.set(key, String(value))
    return params
  }, new URLSearchParams())
}

const errorMessage = Effect.fnUntraced(function* (response: HttpClientResponse.HttpClientResponse) {
  const text = yield* response.text.pipe(Effect.orElseSucceed(() => ""))
  return text || `llm_wiki request failed with status ${response.status}`
})

export * as LlmWikiService from "./service"

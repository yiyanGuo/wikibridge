import { describe, expect } from "bun:test"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { LlmWikiService } from "@/llm-wiki/service"
import { testEffect } from "../lib/effect"

const json = (request: Parameters<typeof HttpClientResponse.fromWeb>[0], body: unknown, status = 200) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  )

const requests: HttpClientRequest.HttpClientRequest[] = []

const client = HttpClient.make((request) =>
  Effect.gen(function* () {
    requests.push(request)
    if (request.url.endsWith("/health")) {
      return json(request, {
        ok: true,
        status: "running",
        version: "1.2.3",
        enabled: true,
        authRequired: true,
        authConfigured: true,
        allowUnauthenticated: false,
        mcpEnabled: true,
      })
    }
    if (request.url.includes("/projects/current/search")) {
      return json(request, {
        ok: true,
        projectId: "current",
        mode: "hybrid",
        tokenHits: 3,
        vectorHits: 2,
        results: [
          {
            path: "wiki/index.md",
            title: "Index",
            snippet: "hello world",
            score: 0.95,
            content: "hello world content",
          },
        ],
      })
    }
    if (request.url.includes("/projects/missing/files")) {
      return json(request, { ok: false, error: "missing project" }, 404)
    }
    return json(request, { ok: false, error: "unexpected" }, 500)
  }),
)

const layer = LlmWikiService.defaultLayer.pipe(
  Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        LLM_WIKI_BASE_URL: "http://127.0.0.1:19828",
        LLM_WIKI_TOKEN: "secret-token",
      }),
    ),
  ),
)

const it = testEffect(layer)

describe("llm-wiki.service", () => {
  it.effect("normalizes the base URL and decodes health responses", () =>
    Effect.gen(function* () {
      requests.length = 0
      const svc = yield* LlmWikiService.Service
      const result = yield* svc.health()

      expect(result.version).toBe("1.2.3")
      expect(requests[0]?.url).toBe("http://127.0.0.1:19828/api/v1/health")
      expect(requests[0]?.headers.authorization).toBe("Bearer secret-token")
      expect(requests[0]?.headers["x-llm-wiki-token"]).toBe("secret-token")
    }),
  )

  it.effect("sends typed search payloads and maps results", () =>
    Effect.gen(function* () {
      requests.length = 0
      const svc = yield* LlmWikiService.Service
      const result = yield* svc.search({
        projectId: "current",
        payload: {
          query: "index",
          topK: 5,
          includeContent: true,
          queryEmbedding: [0.1, 0.2],
        },
      })

      expect(result.mode).toBe("hybrid")
      expect(result.results[0]?.content).toBe("hello world content")

      const web = yield* HttpClientRequest.toWeb(requests[0]!).pipe(Effect.orDie)
      const body = yield* Effect.promise(() => web.text())
      expect(body).toContain('"query":"index"')
    }),
  )

  it.effect("maps 404 responses to typed not found errors", () =>
    Effect.gen(function* () {
      const svc = yield* LlmWikiService.Service
      const error = yield* svc.files({ projectId: "missing", query: { root: "wiki", recursive: true, maxFiles: 10 } }).pipe(Effect.flip)
      expect(error._tag).toBe("LlmWikiNotFoundError")
    }),
  )
})

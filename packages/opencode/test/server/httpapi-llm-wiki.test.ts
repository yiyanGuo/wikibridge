import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Config, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  { disableListenLog: true, disableLogger: true },
)

const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* Effect.promise(() => resetDatabase())
  }),
)

const httpApiServerLayer = servedRoutes.pipe(
  Layer.provide(Socket.layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)

const it = testEffect(Layer.mergeAll(testStateLayer, httpApiServerLayer))

describe("instance HttpApi llm-wiki", () => {
  it.live("exposes the llm-wiki health route and reports unavailable upstream", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const response = yield* HttpClientRequest.get("/instance/llm-wiki/health").pipe(
        HttpClientRequest.setHeader("x-opencode-directory", dir),
        HttpClient.execute,
      )
      const body = yield* response.json

      expect(response.status).toBe(503)
      expect(body).toMatchObject({
        _tag: "LlmWikiUnavailableError",
        message: expect.stringContaining("llm_wiki request failed"),
      })
    }),
  )

  it.live("exposes the llm-wiki projects route and reports unavailable upstream", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const response = yield* HttpClientRequest.get("/instance/llm-wiki/projects").pipe(
        HttpClientRequest.setHeader("x-opencode-directory", dir),
        HttpClient.execute,
      )
      const body = yield* response.json

      expect(response.status).toBe(503)
      expect(body).toMatchObject({ _tag: "LlmWikiUnavailableError" })
    }),
  )

  it.live("exposes the llm-wiki search route and reports unavailable upstream", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const response = yield* HttpClientRequest.post("/instance/llm-wiki/projects/wiki/search").pipe(
        HttpClientRequest.setHeader("x-opencode-directory", dir),
        HttpClientRequest.bodyJson({ query: "hello", topK: 5 }),
        Effect.flatMap(HttpClient.execute),
      )
      const body = yield* response.json

      expect(response.status).toBe(503)
      expect(body).toMatchObject({ _tag: "LlmWikiUnavailableError" })
    }),
  )
})

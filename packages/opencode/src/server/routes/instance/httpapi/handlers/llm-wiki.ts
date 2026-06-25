import { LlmWikiService } from "@/llm-wiki/service"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const llmWikiHandlers = HttpApiBuilder.group(InstanceHttpApi, "llm-wiki", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* LlmWikiService.Service

    // KB mode only restricts local filesystem and shell-like operations.
    // llm_wiki calls are remote HTTP operations and must stay available.
    return handlers
      .handle("health", () => svc.health())
      .handle("projects", () => svc.projects())
      .handle("files", (ctx) => svc.files({ projectId: ctx.params.projectID, query: { root: ctx.query.root, recursive: ctx.query.recursive === undefined ? undefined : ctx.query.recursive === "true", maxFiles: ctx.query.maxFiles } }))
      .handle("fileContent", (ctx) => svc.fileContent({ projectId: ctx.params.projectID, path: ctx.query.path }))
      .handle("reviews", (ctx) => svc.reviews({ projectId: ctx.params.projectID, query: { status: ctx.query.status, type: ctx.query.type, limit: ctx.query.limit } }))
      .handle("search", (ctx) => svc.search({ projectId: ctx.params.projectID, payload: ctx.payload }))
      .handle("graph", (ctx) => svc.graph({ projectId: ctx.params.projectID, query: { q: ctx.query.q, nodeType: ctx.query.nodeType, limit: ctx.query.limit } }))
      .handle("rescanSources", (ctx) => svc.rescanSources({ projectId: ctx.params.projectID }))
  }),
)

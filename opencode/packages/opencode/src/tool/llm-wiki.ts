import { LlmWikiConfig } from "@/llm-wiki/config"
import { LlmWikiService } from "@/llm-wiki/service"
import { Effect, Option, Schema } from "effect"
import * as Tool from "./tool"

const DEFAULT_TOP_K = 5
const MAX_TOP_K = 20
const DEFAULT_GRAPH_LIMIT = 40
const MAX_GRAPH_LIMIT = 100
const SEARCH_CONTENT_LIMIT = 2400

const SearchParameters = Schema.Struct({
  query: Schema.String.annotate({ description: "The natural language query to search in the current knowledge base" }),
  topK: Schema.optional(Schema.Number).annotate({
    description: `Maximum number of results to return. Defaults to ${DEFAULT_TOP_K}; maximum ${MAX_TOP_K}.`,
  }),
  includeContent: Schema.optional(Schema.Boolean).annotate({
    description: "Whether to include short matched page content snippets. Defaults to false.",
  }),
})

const ReadFileParameters = Schema.Struct({
  path: Schema.String.annotate({
    description: "Relative path to a wiki file in the current knowledge base, for example wiki/Overview.md",
  }),
})

const GraphParameters = Schema.Struct({
  q: Schema.optional(Schema.String).annotate({ description: "Optional entity or title text to filter graph nodes" }),
  nodeType: Schema.optional(Schema.String).annotate({ description: "Optional graph node type filter" }),
  limit: Schema.optional(Schema.Number).annotate({
    description: `Maximum number of graph nodes to return. Defaults to ${DEFAULT_GRAPH_LIMIT}; maximum ${MAX_GRAPH_LIMIT}.`,
  }),
})

type Metadata = {
  projectId: string
  truncated?: boolean
}

export const LlmWikiSearchTool = Tool.define<typeof SearchParameters, Metadata, LlmWikiService.Service | LlmWikiConfig.Service>(
  "llm_wiki_search",
  Effect.gen(function* () {
    const svc = yield* LlmWikiService.Service
    const config = yield* LlmWikiConfig.Service
    return {
      description:
        "Search the WikiBridge knowledge base bound to this OpenCode chat. Use this before answering knowledge-base questions.",
      parameters: SearchParameters,
      execute: (params) =>
        Effect.gen(function* () {
          const projectId = yield* resolveProjectId(svc, config)
          const topK = clampNumber(params.topK, DEFAULT_TOP_K, 1, MAX_TOP_K)
          const includeContent = params.includeContent === true
          const response = yield* svc.search({
            projectId,
            payload: { query: params.query, topK, includeContent },
          })
          return {
            title: `llm_wiki search: ${params.query}`,
            metadata: { projectId },
            output: JSON.stringify(
              {
                projectId: response.projectId,
                mode: response.mode,
                tokenHits: response.tokenHits,
                vectorHits: response.vectorHits,
                results: response.results.map((result) => ({
                  path: result.path,
                  title: result.title,
                  snippet: result.snippet,
                  score: result.score,
                  ...(includeContent && result.content
                    ? { content: truncate(result.content, SEARCH_CONTENT_LIMIT) }
                    : {}),
                })),
              },
              null,
              2,
            ),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const LlmWikiReadFileTool = Tool.define<
  typeof ReadFileParameters,
  Metadata,
  LlmWikiService.Service | LlmWikiConfig.Service
>(
  "llm_wiki_read_file",
  Effect.gen(function* () {
    const svc = yield* LlmWikiService.Service
    const config = yield* LlmWikiConfig.Service
    return {
      description:
        "Read one Markdown wiki file from the WikiBridge knowledge base bound to this OpenCode chat. This is read-only and cannot access raw sources.",
      parameters: ReadFileParameters,
      execute: (params) =>
        Effect.gen(function* () {
          const projectId = yield* resolveProjectId(svc, config)
          const path = normalizeWikiPath(params.path)
          const response = yield* svc.fileContent({ projectId, path })
          return {
            title: response.path,
            metadata: { projectId },
            output: [`# ${response.path}`, "", response.content].join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const LlmWikiGraphTool = Tool.define<typeof GraphParameters, Metadata, LlmWikiService.Service | LlmWikiConfig.Service>(
  "llm_wiki_graph",
  Effect.gen(function* () {
    const svc = yield* LlmWikiService.Service
    const config = yield* LlmWikiConfig.Service
    return {
      description:
        "Read entity and wikilink graph data from the WikiBridge knowledge base bound to this OpenCode chat.",
      parameters: GraphParameters,
      execute: (params) =>
        Effect.gen(function* () {
          const projectId = yield* resolveProjectId(svc, config)
          const limit = clampNumber(params.limit, DEFAULT_GRAPH_LIMIT, 1, MAX_GRAPH_LIMIT)
          const response = yield* svc.graph({
            projectId,
            query: { q: emptyToUndefined(params.q), nodeType: emptyToUndefined(params.nodeType), limit },
          })
          return {
            title: params.q ? `llm_wiki graph: ${params.q}` : "llm_wiki graph",
            metadata: { projectId },
            output: JSON.stringify(
              {
                projectId: response.projectId,
                nodes: response.nodes.map((node) => ({
                  id: node.id,
                  label: node.label,
                  nodeType: node.nodeType,
                  path: node.path,
                  linkCount: node.linkCount,
                })),
                edges: response.edges.map((edge) => ({
                  source: edge.source,
                  target: edge.target,
                  weight: edge.weight,
                })),
              },
              null,
              2,
            ),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const resolveProjectId = Effect.fn("LlmWikiTool.resolveProjectId")(function* (
  svc: LlmWikiService.Interface,
  config: { projectId: Option.Option<string> },
) {
  if (Option.isSome(config.projectId)) return config.projectId.value
  const projects = yield* svc.projects()
  if (projects.currentProject?.id) return projects.currentProject.id
  return yield* Effect.fail(new Error("No LLM Wiki project is bound to this OpenCode chat"))
})

function normalizeWikiPath(input: string) {
  const trimmed = input.trim().replace(/\\/g, "/").replace(/^\/+/, "")
  if (!trimmed || trimmed.includes("\0")) {
    throw new Error("path must be a relative wiki file path")
  }
  const path = trimmed.startsWith("wiki/") ? trimmed : `wiki/${trimmed}`
  const parts = path.split("/")
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("path must stay inside the current project's wiki directory")
  }
  if (path === "wiki" || path.endsWith("/")) {
    throw new Error("path must point to a wiki file")
  }
  return path
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function emptyToUndefined(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function truncate(value: string, limit: number) {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n... (truncated)`
}

import { Schema } from "effect"

export const ProjectRoot = Schema.Literals(["wiki", "sources", "all"]).annotate({ identifier: "LlmWikiProjectRoot" })
export const ReviewStatus = Schema.Literals(["unresolved", "resolved", "all"]).annotate({ identifier: "LlmWikiReviewStatus" })

export const FileNode: Schema.Schema<any> = Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    path: Schema.String,
    isDir: Schema.Boolean,
    size: Schema.Number,
    children: Schema.optional(Schema.Array(FileNode)),
  }).annotate({ identifier: "LlmWikiFileNode" }),
)

export const Project = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  current: Schema.Boolean,
}).annotate({ identifier: "LlmWikiProject" })

export const HealthResponse = Schema.Struct({
  ok: Schema.Literal(true),
  status: Schema.String,
  version: Schema.String,
  enabled: Schema.Boolean,
  authRequired: Schema.Boolean,
  authConfigured: Schema.Boolean,
  allowUnauthenticated: Schema.Boolean,
  mcpEnabled: Schema.Boolean,
}).annotate({ identifier: "LlmWikiHealthResponse" })

export const ProjectsResponse = Schema.Struct({
  ok: Schema.Literal(true),
  projects: Schema.Array(Project),
  currentProject: Schema.NullOr(Project),
}).annotate({ identifier: "LlmWikiProjectsResponse" })

export const FilesQuery = Schema.Struct({ root: ProjectRoot, recursive: Schema.optional(Schema.Boolean), maxFiles: Schema.optional(Schema.Number) })
export const FilesResponse = Schema.Struct({ ok: Schema.Literal(true), projectId: Schema.String, root: ProjectRoot, files: Schema.Array(FileNode) }).annotate({ identifier: "LlmWikiFilesResponse" })
export const FileContentQuery = Schema.Struct({ path: Schema.String })
export const FileContentResponse = Schema.Struct({ ok: Schema.Literal(true), projectId: Schema.String, path: Schema.String, content: Schema.String }).annotate({ identifier: "LlmWikiFileContentResponse" })

export const ReviewOption = Schema.Struct({ label: Schema.String, action: Schema.String }).annotate({ identifier: "LlmWikiReviewOption" })
export const Review = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  title: Schema.String,
  description: Schema.String,
  sourcePath: Schema.optional(Schema.String),
  affectedPages: Schema.optional(Schema.Array(Schema.String)),
  searchQueries: Schema.optional(Schema.Array(Schema.String)),
  options: Schema.Array(ReviewOption),
  resolved: Schema.Boolean,
  resolvedAction: Schema.optional(Schema.String),
  createdAt: Schema.Number,
}).annotate({ identifier: "LlmWikiReview" })

export const ReviewsQuery = Schema.Struct({ status: Schema.optional(ReviewStatus), type: Schema.optional(Schema.String), limit: Schema.optional(Schema.Number) })
export const ReviewsResponse = Schema.Struct({ ok: Schema.Literal(true), projectId: Schema.String, status: ReviewStatus, count: Schema.Number, reviews: Schema.Array(Review) }).annotate({ identifier: "LlmWikiReviewsResponse" })

export const SearchRequest = Schema.Struct({ query: Schema.String, topK: Schema.optional(Schema.Number), includeContent: Schema.optional(Schema.Boolean), queryEmbedding: Schema.optional(Schema.Array(Schema.Number)) }).annotate({ identifier: "LlmWikiSearchRequest" })
export const SearchResult = Schema.Struct({ path: Schema.String, title: Schema.String, snippet: Schema.String, score: Schema.Number, content: Schema.optional(Schema.String) }).annotate({ identifier: "LlmWikiSearchResult" })
export const SearchResponse = Schema.Struct({ ok: Schema.Literal(true), projectId: Schema.String, mode: Schema.String, tokenHits: Schema.Number, vectorHits: Schema.Number, results: Schema.Array(SearchResult) }).annotate({ identifier: "LlmWikiSearchResponse" })

export const GraphQuery = Schema.Struct({ q: Schema.optional(Schema.String), nodeType: Schema.optional(Schema.String), limit: Schema.optional(Schema.Number) })
export const GraphNode = Schema.Struct({ id: Schema.String, label: Schema.String, nodeType: Schema.String, path: Schema.optional(Schema.String), linkCount: Schema.Number }).annotate({ identifier: "LlmWikiGraphNode" })
export const GraphEdge = Schema.Struct({ source: Schema.String, target: Schema.String, weight: Schema.Number }).annotate({ identifier: "LlmWikiGraphEdge" })
export const GraphResponse = Schema.Struct({ ok: Schema.Literal(true), projectId: Schema.String, nodes: Schema.Array(GraphNode), edges: Schema.Array(GraphEdge) }).annotate({ identifier: "LlmWikiGraphResponse" })

export const RescanQueue = Schema.Struct({ version: Schema.Number, tasks: Schema.Array(Schema.Unknown) }).annotate({ identifier: "LlmWikiRescanQueue" })
export const RescanResult = Schema.Struct({ queue: RescanQueue, changedTasks: Schema.Array(Schema.Unknown) }).annotate({ identifier: "LlmWikiRescanResult" })
export const RescanResponse = Schema.Struct({ ok: Schema.Literal(true), projectId: Schema.String, result: RescanResult }).annotate({ identifier: "LlmWikiRescanResponse" })

export type Health = Schema.Schema.Type<typeof HealthResponse>
export type Projects = Schema.Schema.Type<typeof ProjectsResponse>
export type Files = Schema.Schema.Type<typeof FilesResponse>
export type FileContent = Schema.Schema.Type<typeof FileContentResponse>
export type Reviews = Schema.Schema.Type<typeof ReviewsResponse>
export type Search = Schema.Schema.Type<typeof SearchResponse>
export type Graph = Schema.Schema.Type<typeof GraphResponse>
export type Rescan = Schema.Schema.Type<typeof RescanResponse>
export type FilesQueryShape = Schema.Schema.Type<typeof FilesQuery>
export type ReviewsQueryShape = Schema.Schema.Type<typeof ReviewsQuery>
export type SearchRequestShape = Schema.Schema.Type<typeof SearchRequest>
export type GraphQueryShape = Schema.Schema.Type<typeof GraphQuery>

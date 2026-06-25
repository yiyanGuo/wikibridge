import { FileContentQuery as LlmWikiFileContentQuery, FileContentResponse, FilesQuery as LlmWikiFilesQuery, FilesResponse, GraphQuery as LlmWikiGraphQuery, GraphResponse, HealthResponse, LlmWikiNotFoundError, LlmWikiUnauthorizedError, LlmWikiUnavailableError, ProjectsResponse, RescanResponse, ReviewsQuery as LlmWikiReviewsQuery, ReviewsResponse, SearchRequest, SearchResponse } from "@/llm-wiki"
import { Effect, Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/instance/llm-wiki"
const ProjectParams = { projectID: Schema.String }

const FilesQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  root: LlmWikiFilesQuery.fields.root.pipe(Schema.withDecodingDefault(Effect.succeed("wiki" as const))),
  recursive: Schema.optional(Schema.Literals(["true", "false"])),
  maxFiles: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(10000))),
})

const FileContentQuery = Schema.Struct({ ...WorkspaceRoutingQueryFields, ...LlmWikiFileContentQuery.fields })
const ReviewsQuery = Schema.Struct({ ...WorkspaceRoutingQueryFields, ...LlmWikiReviewsQuery.fields, limit: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(1000))) })
const GraphQuery = Schema.Struct({ ...WorkspaceRoutingQueryFields, ...LlmWikiGraphQuery.fields, limit: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(1000))) })

export const LlmWikiApi = HttpApi.make("llm-wiki")
  .add(
    HttpApiGroup.make("llm-wiki")
      .add(
        HttpApiEndpoint.get("health", `${root}/health`, { query: WorkspaceRoutingQuery, success: described(HealthResponse, "llm_wiki service health"), error: [LlmWikiUnauthorizedError, LlmWikiNotFoundError, LlmWikiUnavailableError] }),
        HttpApiEndpoint.get("projects", `${root}/projects`, { query: WorkspaceRoutingQuery, success: described(ProjectsResponse, "Known llm_wiki projects"), error: [LlmWikiUnauthorizedError, LlmWikiNotFoundError, LlmWikiUnavailableError] }),
        HttpApiEndpoint.get("files", `${root}/projects/:projectID/files`, { params: ProjectParams, query: FilesQuery, success: described(FilesResponse, "llm_wiki project files"), error: [LlmWikiUnauthorizedError, LlmWikiNotFoundError, LlmWikiUnavailableError] }),
        HttpApiEndpoint.get("fileContent", `${root}/projects/:projectID/files/content`, { params: ProjectParams, query: FileContentQuery, success: described(FileContentResponse, "llm_wiki file content"), error: [LlmWikiUnauthorizedError, LlmWikiNotFoundError, LlmWikiUnavailableError] }),
        HttpApiEndpoint.get("reviews", `${root}/projects/:projectID/reviews`, { params: ProjectParams, query: ReviewsQuery, success: described(ReviewsResponse, "llm_wiki reviews"), error: [LlmWikiUnauthorizedError, LlmWikiNotFoundError, LlmWikiUnavailableError] }),
        HttpApiEndpoint.post("search", `${root}/projects/:projectID/search`, { params: ProjectParams, query: WorkspaceRoutingQuery, payload: SearchRequest, success: described(SearchResponse, "llm_wiki search results"), error: [LlmWikiUnauthorizedError, LlmWikiNotFoundError, LlmWikiUnavailableError] }),
        HttpApiEndpoint.get("graph", `${root}/projects/:projectID/graph`, { params: ProjectParams, query: GraphQuery, success: described(GraphResponse, "llm_wiki graph"), error: [LlmWikiUnauthorizedError, LlmWikiNotFoundError, LlmWikiUnavailableError] }),
        HttpApiEndpoint.post("rescanSources", `${root}/projects/:projectID/sources/rescan`, { params: ProjectParams, query: WorkspaceRoutingQuery, success: described(RescanResponse, "llm_wiki rescan result"), error: [LlmWikiUnauthorizedError, LlmWikiNotFoundError, LlmWikiUnavailableError] }),
      )
      .annotateMerge(OpenApi.annotations({ title: "llm-wiki", description: "Experimental HttpApi llm_wiki routes." }))
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(OpenApi.annotations({ title: "opencode experimental HttpApi", version: "0.0.1", description: "Experimental HttpApi surface for selected instance routes." }))

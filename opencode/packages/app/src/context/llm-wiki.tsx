import { createSimpleContext } from "@opencode-ai/ui/context"
import { createEffect, createResource, createSignal, Show, type Accessor, type JSX } from "solid-js"
import { useServerSDK } from "./server-sdk"
import type {
  LlmWikiProject,
  LlmWikiFileNode,
  LlmWikiGraphEdge,
  LlmWikiGraphNode,
  LlmWikiSearchResult,
} from "@opencode-ai/sdk/v2/client"

export type { LlmWikiProject, LlmWikiFileNode, LlmWikiGraphEdge, LlmWikiGraphNode, LlmWikiSearchResult }

const FAKE_DIRECTORY = "."

export interface LlmWikiContextValue {
  projects: Accessor<LlmWikiProject[]>
  currentProject: Accessor<LlmWikiProject | undefined>
  setCurrentProjectId: (id: string) => void
  files: Accessor<LlmWikiFileNode[]>
  filesLoading: Accessor<boolean>
  loadFile: (path: string) => Promise<{ content: string } | undefined>
  graphNodes: Accessor<LlmWikiGraphNode[]>
  graphEdges: Accessor<LlmWikiGraphEdge[]>
  graphLoading: Accessor<boolean>
  searchResults: Accessor<LlmWikiSearchResult[]>
  searchLoading: Accessor<boolean>
  search: (query: string) => void
  selectedPath: Accessor<string | undefined>
  selectPath: (path?: string) => void
}

export const { use: useLlmWiki, provider: LlmWikiProvider } = createSimpleContext({
  name: "LlmWiki",
  init: () => {
    const serverSDK = useServerSDK()
    const [currentProjectId, setCurrentProjectId] = createSignal<string | undefined>()
    const [selectedPath, selectPath] = createSignal<string | undefined>()
    const [searchQuery, setSearchQuery] = createSignal<string>("")

    const client = () => serverSDK().client

    const [projectsResource] = createResource(
      () => serverSDK().url,
      async () => {
        try {
          const response = await client().llmWiki.projects({ directory: FAKE_DIRECTORY })
          return response.data
        } catch {
          return undefined
        }
      },
    )

    const projects = () => {
      const data = projectsResource()
      return data?.projects ?? []
    }

    createEffect(() => {
      const data = projectsResource()
      if (currentProjectId() || !data?.currentProject?.id) return
      setCurrentProjectId(data.currentProject.id)
    })

    const currentProject = () => {
      const id = currentProjectId()
      if (!id) return undefined
      return projects().find((project) => project.id === id)
    }

    const [filesResource, { refetch: refetchFiles }] = createResource(
      () => ({ id: currentProjectId(), url: serverSDK().url }),
      async (ctx) => {
        if (!ctx.id) return []
        try {
          const response = await client().llmWiki.files({
            projectID: ctx.id,
            directory: FAKE_DIRECTORY,
            root: "wiki",
            recursive: "true",
          })
          return response.data?.files ?? []
        } catch {
          return []
        }
      },
    )

    const files = () => filesResource() ?? []
    const filesLoading = () => filesResource.loading

    const [graphResource] = createResource(
      () => ({ id: currentProjectId(), url: serverSDK().url }),
      async (ctx) => {
        if (!ctx.id) return { nodes: [], edges: [] }
        try {
          const response = await client().llmWiki.graph({
            projectID: ctx.id,
            directory: FAKE_DIRECTORY,
            limit: "100",
          })
          return {
            nodes: response.data?.nodes ?? [],
            edges: response.data?.edges ?? [],
          }
        } catch {
          return { nodes: [], edges: [] }
        }
      },
    )

    const graphNodes = () => graphResource()?.nodes ?? []
    const graphEdges = () => graphResource()?.edges ?? []
    const graphLoading = () => graphResource.loading

    const loadFile = async (path: string) => {
      const projectId = currentProjectId()
      if (!projectId) return undefined
      try {
        const response = await client().llmWiki.fileContent({
          projectID: projectId,
          directory: FAKE_DIRECTORY,
          path,
        })
        return response.data
      } catch {
        return undefined
      }
    }

    const [searchResource, { refetch: refetchSearch }] = createResource(
      () => ({ id: currentProjectId(), query: searchQuery(), url: serverSDK().url }),
      async (ctx) => {
        if (!ctx.id || !ctx.query.trim()) return []
        try {
          const response = await client().llmWiki.search({
            projectID: ctx.id,
            directory: FAKE_DIRECTORY,
            llmWikiSearchRequest: { query: ctx.query },
          })
          return response.data?.results ?? []
        } catch {
          return []
        }
      },
    )

    const searchResults = () => searchResource() ?? []
    const searchLoading = () => searchResource.loading

    const search = (query: string) => {
      setSearchQuery(query)
      if (query.trim()) refetchSearch()
    }

    const setProjectId = (id: string) => {
      setCurrentProjectId(id)
      selectPath(undefined)
      refetchFiles()
    }

    return {
      projects,
      currentProject,
      setCurrentProjectId: setProjectId,
      files,
      filesLoading,
      loadFile,
      graphNodes,
      graphEdges,
      graphLoading,
      searchResults,
      searchLoading,
      search,
      selectedPath,
      selectPath,
    } satisfies LlmWikiContextValue
  },
})

export function LlmWikiGuard(props: { children: JSX.Element }) {
  const ctx = useLlmWiki()
  return (
    <Show
      when={ctx.currentProject()}
      fallback={
        <div class="flex h-full items-center justify-center text-v2-text-text-muted">
          Select a knowledge base project to begin.
        </div>
      }
    >
      {props.children}
    </Show>
  )
}

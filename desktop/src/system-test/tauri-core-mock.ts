type AppSnapshot = {
  is_authenticated: boolean
}

type LlmWikiLlmConfig = {
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  maxContextSize: number
  configured: boolean
}

type UserDto = {
  username: string
  balance_mb: number
}

type ProjectMaterial = {
  material_id: string
  original_name: string
  stored_name: string
  size_bytes: number
}

type KnowledgeProject = {
  project_id: string
  name: string
  folder_path: string
  raw_dir: string
  materials: ProjectMaterial[]
  build_status: string
  link_status: string
}

type ProjectConnection = {
  connection_id: string
  project_id: string
  project_name: string
  proxy_id: number
  public_url?: string | null
  running: boolean
  enabled: boolean
  service_ready: boolean
  traffic_limit_mb: number
  traffic_used_bytes: number
  status: string
}

type SidecarState = {
  running: boolean
  healthy: boolean
  url?: string | null
  port?: number | null
  logPath?: string | null
  projectId?: string | null
}

type DesktopServicesState = {
  bearfrpBackendUrl: string
  appDataDir: string
  opencode: SidecarState
  llmWiki: SidecarState
}

type LlmSettings = {
  provider: string
  model: string
  baseUrl?: string | null
  hasApiKey: boolean
}

type RemoteProject = {
  id: string
  name: string
  path: string
  current: boolean
}

type RemoteKnowledgeBase = {
  remoteId: string
  name: string
  url: string
  apiUrl: string
  status: string
  projectCount: number
  projects: RemoteProject[]
  currentProject?: RemoteProject | null
  authRequired: boolean
  mcpStatus: string
  token?: string | null
  addedAt: number
  lastOpenedAt?: number | null
}

type WikiQueueSummary = {
  pending: number
  processing: number
  failed: number
  completed: number
  total: number
}

type WikiProjectState = {
  project: { id: string; name: string; path: string }
  queue: WikiQueueSummary
  sourceCount: number
  wikiCount: number
}

type ProjectTreeNode = {
  node_id: string
  name: string
  kind: string
  document_id?: string | null
  readable: boolean
  children: ProjectTreeNode[]
}

type ProjectDocumentContent = {
  document_id: string
  title: string
  content: string
}

type Invocation = {
  command: string
  args?: unknown
}

const FIXED_BEARFRP_BACKEND_URL = "https://frp.muleizh.ink"

export type SystemTestState = {
  services: DesktopServicesState
  llmSettings: LlmSettings
  llmConfig: LlmWikiLlmConfig
  authenticated: boolean
  user: UserDto | null
  projects: KnowledgeProject[]
  connections: ProjectConnection[]
  remoteKnowledgeBases: RemoteKnowledgeBase[]
  wikiProjects: Record<string, WikiProjectState>
  projectTrees: Record<string, ProjectTreeNode>
  projectDocuments: Record<string, ProjectDocumentContent>
  commandFailures: Record<string, string>
  invocations: Invocation[]
  nextId: number
}

type SystemTestController = {
  reset: (next?: Partial<SystemTestState>) => void
  getState: () => SystemTestState
  getInvocations: () => Invocation[]
  failCommand: (command: string, message: string) => void
  clearCommandFailure: (command: string) => void
}

declare global {
  interface Window {
    __wikibridgeSystemTest?: SystemTestController
    __wikibridgeSystemTestInitialState?: Partial<SystemTestState>
  }
}

let state = createState(window.__wikibridgeSystemTestInitialState)

window.__wikibridgeSystemTest = {
  reset(next) {
    state = createState(next)
  },
  getState() {
    return clone(state)
  },
  getInvocations() {
    return clone(state.invocations)
  },
  failCommand(command, message) {
    state.commandFailures[command] = message
  },
  clearCommandFailure(command) {
    delete state.commandFailures[command]
  },
}

export async function invoke<T = unknown>(command: string, args?: unknown): Promise<T> {
  state.invocations.push({ command, args: clone(args) })
  const failure = state.commandFailures[command]
  if (failure) throw new Error(failure)

  switch (command) {
    case "get_desktop_services_state":
      return clone(state.services) as T
    case "set_bearfrp_backend_url":
    case "save_settings":
      state.services.bearfrpBackendUrl = FIXED_BEARFRP_BACKEND_URL
      return snapshot() as T
    case "get_llm_wiki_llm_config":
      return clone(state.llmConfig) as T
    case "set_llm_wiki_llm_config":
      return saveLlmWikiConfig(args) as T
    case "get_llm_settings":
      return clone(state.llmSettings) as T
    case "save_llm_settings":
      return saveLlmSettings(args) as T
    case "clear_llm_settings":
      state.llmSettings = { ...state.llmSettings, hasApiKey: false }
      state.services.opencode = stoppedSidecar()
      state.services.llmWiki = stoppedSidecar()
      return clone(state.llmSettings) as T
    case "ensure_opencode_stack_running":
      return ensureOpenCodeStackRunning() as T
    case "stop_opencode_stack":
      state.services.opencode = stoppedSidecar()
      state.services.llmWiki = stoppedSidecar()
      return undefined as T
    case "create_opencode_session":
      return createOpenCodeSession() as T
    case "list_remote_knowledge_bases":
      return clone(state.remoteKnowledgeBases) as T
    case "add_remote_knowledge_base":
      return addRemoteKnowledgeBase(args) as T
    case "touch_remote_knowledge_base":
      return touchRemoteKnowledgeBase(readStringArg(args, "remoteId")) as T
    case "remove_remote_knowledge_base":
      state.remoteKnowledgeBases = state.remoteKnowledgeBases.filter(
        (item) => item.remoteId !== readStringArg(args, "remoteId"),
      )
      return undefined as T
    case "check_remote_knowledge_base":
      return checkRemoteKnowledgeBase(readStringArg(args, "url")) as T
    case "select_remote_knowledge_base_project":
      return selectRemoteKnowledgeBaseProject(
        readStringArg(args, "remoteId"),
        readStringArg(args, "projectId"),
      ) as T
    case "ensure_opencode_for_remote":
      return ensureOpenCodeForRemote(readStringArg(args, "remoteId")) as T
    case "get_state":
      return snapshot() as T
    case "list_projects":
      return clone(state.projects) as T
    case "list_connections":
      return clone(state.connections) as T
    case "get_current_user":
      if (!state.user) throw new Error("未登录")
      return clone(state.user) as T
    case "login_user":
    case "register_user":
      state.authenticated = true
      state.user = { username: readStringArg(args, "username") || "tester", balance_mb: 1024 }
      return clone(state.user) as T
    case "logout_user":
      state.authenticated = false
      state.user = null
      return undefined as T
    case "recharge_user":
      if (!state.user) throw new Error("未登录")
      state.user.balance_mb += 100
      return undefined as T
    case "create_project":
      return createProject(args) as T
    case "delete_project":
      return deleteProject(readStringArg(args, "projectId")) as T
    case "get_wiki_project":
      return ensureWikiProject(readStringArg(args, "projectId")) as T
    case "list_project_tree":
      return ensureProjectTree(readStringArg(args, "projectId")) as T
    case "read_project_tree_document":
      return readProjectDocument(readStringArg(args, "nodeId")) as T
    case "import_wiki_sources":
      return importWikiSources(args) as T
    case "build_wiki_project":
      return buildWikiProject(readStringArg(args, "projectId")) as T
    case "refresh_wiki_graph":
      return {
        projectId: readStringArg(args, "projectId"),
        nodes: [
          { id: "intro.md", label: "Intro", nodeType: "page", path: "Intro.md", linkCount: 1 },
        ],
        edges: [],
        source: "mock",
      } as T
    case "start_project_chat":
      return {
        opencodeUrl: "http://127.0.0.1:9010",
        llmWikiUrl: "http://127.0.0.1:9011",
        opencodePort: 9010,
        llmWikiPort: 9011,
        projectId: readStringArg(args, "projectId"),
      } as T
    case "stop_project_chat":
      return undefined as T
    case "create_connection":
      return createConnection(args) as T
    case "start_connection":
      return updateConnection(readStringArg(args, "connectionId"), {
        running: true,
        public_url: "https://wiki.example.test/api/v1",
      }) as T
    case "stop_connection":
      return updateConnection(readStringArg(args, "connectionId"), { running: false }) as T
    case "delete_connection":
      state.connections = state.connections.filter(
        (item) => item.connection_id !== readStringArg(args, "connectionId"),
      )
      return undefined as T
    case "read_project_asset":
      return { mime_type: "image/png", bytes: [] } as T
    default:
      throw new Error(`Unhandled system-test invoke command: ${command}`)
  }
}

function createState(overrides: Partial<SystemTestState> = {}): SystemTestState {
  const defaultProject = sampleProject()
  const base: SystemTestState = {
    services: {
      bearfrpBackendUrl: FIXED_BEARFRP_BACKEND_URL,
      appDataDir: "/tmp/wikibridge/system-test",
      opencode: stoppedSidecar(),
      llmWiki: stoppedSidecar(),
    },
    llmSettings: {
      provider: "deepseek",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      hasApiKey: true,
    },
    llmConfig: {
      provider: "deepseek",
      apiKey: "sk-system-test",
      model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com/v1",
      maxContextSize: 64000,
      configured: true,
    },
    authenticated: false,
    user: null,
    projects: [defaultProject],
    connections: [],
    remoteKnowledgeBases: [],
    wikiProjects: {
      [defaultProject.project_id]: sampleWikiProject(defaultProject),
    },
    projectTrees: {
      [defaultProject.project_id]: sampleTree(),
    },
    projectDocuments: {
      "intro.md": {
        document_id: "intro.md",
        title: "Intro",
        content: "# Intro\n\nThis is a system-test wiki document.",
      },
    },
    commandFailures: {},
    invocations: [],
    nextId: 2,
  }

  return {
    ...base,
    ...clone(overrides),
    services: {
      ...base.services,
      ...clone(overrides.services),
      bearfrpBackendUrl: FIXED_BEARFRP_BACKEND_URL,
    },
    llmSettings: { ...base.llmSettings, ...clone(overrides.llmSettings) },
    llmConfig: { ...base.llmConfig, ...clone(overrides.llmConfig) },
    wikiProjects: { ...base.wikiProjects, ...clone(overrides.wikiProjects) },
    projectTrees: { ...base.projectTrees, ...clone(overrides.projectTrees) },
    projectDocuments: { ...base.projectDocuments, ...clone(overrides.projectDocuments) },
    commandFailures: { ...base.commandFailures, ...clone(overrides.commandFailures) },
    invocations: [],
  }
}

function addRemoteKnowledgeBase(args: unknown): RemoteKnowledgeBase {
  const input = readInput(args)
  const url = normalizeRemoteUrl(String(input.url || ""))
  const apiUrl = normalizeRemoteApiUrl(url)
  const existing = state.remoteKnowledgeBases.find(
    (item) => item.apiUrl === apiUrl || item.url === url,
  )
  const projects = sampleRemoteProjects()
  const currentProject = projects.find((project) => project.current) || projects[0] || null
  if (existing) {
    existing.name = String(input.name || "") || new URL(url).host
    existing.url = url
    existing.apiUrl = apiUrl
    existing.status = "ready"
    existing.projectCount = projects.length
    existing.projects = projects
    existing.currentProject = currentProject
    existing.authRequired = false
    existing.lastOpenedAt = Date.now()
    return clone(existing)
  }
  const remote: RemoteKnowledgeBase = {
    remoteId: `remote-${state.nextId++}`,
    name: String(input.name || "") || new URL(url).host,
    url,
    apiUrl,
    status: "ready",
    projectCount: projects.length,
    projects,
    currentProject,
    authRequired: false,
    mcpStatus: "not_registered",
    token: typeof input.token === "string" && input.token.trim() ? input.token.trim() : null,
    addedAt: Date.now(),
    lastOpenedAt: Date.now(),
  }
  state.remoteKnowledgeBases = [
    remote,
    ...state.remoteKnowledgeBases.filter((item) => item.apiUrl !== apiUrl && item.url !== url),
  ]
  return clone(remote)
}

function touchRemoteKnowledgeBase(remoteId: string): RemoteKnowledgeBase {
  const remote = state.remoteKnowledgeBases.find((item) => item.remoteId === remoteId)
  if (!remote) throw new Error("远程知识库不存在")
  remote.lastOpenedAt = Date.now()
  return clone(remote)
}

function checkRemoteKnowledgeBase(url: string) {
  const normalized = normalizeRemoteUrl(url)
  const apiUrl = normalizeRemoteApiUrl(normalized)
  const ok = !normalized.includes("down")
  const projects = ok ? sampleRemoteProjects() : []
  const currentProject = projects.find((project) => project.current) || projects[0] || null
  const existing = state.remoteKnowledgeBases.find(
    (item) => item.url === normalized || item.apiUrl === apiUrl || item.url === url,
  )
  if (existing) {
    existing.url = normalized
    existing.apiUrl = apiUrl
    existing.status = ok ? "ready" : "unreachable"
    existing.projectCount = projects.length
    existing.projects = projects
    existing.currentProject = currentProject
    existing.authRequired = false
  }
  return {
    url: normalized,
    apiUrl,
    ok,
    status: ok ? "ready" : "unreachable",
    message: ok ? `远程知识库 API 可用，发现 ${projects.length} 个项目` : "远程知识库不可达",
    llmWikiHealthy: ok,
    projectCount: projects.length,
    projects,
    currentProject,
    authRequired: false,
    mcpStatus: existing?.mcpStatus || "not_registered",
  }
}

function selectRemoteKnowledgeBaseProject(
  remoteId: string,
  projectId: string,
): RemoteKnowledgeBase {
  const remote = state.remoteKnowledgeBases.find((item) => item.remoteId === remoteId)
  if (!remote) throw new Error("远程知识库不存在")
  const project = remote.projects.find((item) => item.id === projectId)
  if (!project) throw new Error("所选知识库项目不存在，请先重新检测远程知识库")
  remote.projects = remote.projects.map((item) => ({ ...item, current: item.id === projectId }))
  remote.currentProject = { ...project, current: true }
  remote.mcpStatus = "not_registered"
  return clone(remote)
}

function ensureOpenCodeStackRunning() {
  state.services.llmWiki = {
    running: true,
    healthy: true,
    url: "http://127.0.0.1:9011/api/v1",
    port: 9011,
    logPath: "/tmp/wikibridge/system-test/llm-wiki.log",
    projectId: null,
  }
  state.services.opencode = {
    running: true,
    healthy: true,
    url: "http://127.0.0.1:9010",
    port: 9010,
    logPath: "/tmp/wikibridge/system-test/opencode.log",
    projectId: null,
  }
  const session = createOpenCodeSession()
  return {
    opencodeUrl: "http://127.0.0.1:9010",
    llmWikiUrl: "http://127.0.0.1:9011/api/v1",
    opencodePort: 9010,
    llmWikiPort: 9011,
    opencodeLogPath: "/tmp/wikibridge/system-test/opencode.log",
    llmWikiLogPath: "/tmp/wikibridge/system-test/llm-wiki.log",
    projectId: null,
    mcpServerName: null,
    mcpStatus: null,
    sessionId: session.sessionId,
    sessionUrl: session.url,
  }
}

function ensureOpenCodeForRemote(remoteId: string) {
  const remote = state.remoteKnowledgeBases.find((item) => item.remoteId === remoteId)
  if (!remote) throw new Error("远程知识库不存在")
  const stack = ensureOpenCodeStackRunning()
  state.services.llmWiki = stoppedSidecar()
  state.services.opencode.projectId = `remote-${remote.remoteId}`
  remote.mcpStatus = "registered"
  remote.lastOpenedAt = Date.now()
  const session = createOpenCodeSession()
  return {
    stack: {
      ...stack,
      llmWikiUrl: remote.apiUrl || normalizeRemoteApiUrl(remote.url),
      llmWikiPort: null,
      llmWikiLogPath: null,
      projectId: `remote-${remote.remoteId}`,
      mcpServerName: `llm-wiki-${remote.remoteId}`,
      mcpStatus: "registered",
      sessionId: session.sessionId,
      sessionUrl: session.url,
    },
    remote: clone(remote),
    session,
  }
}

function createOpenCodeSession() {
  if (!state.services.opencode.running) {
    state.services.opencode = {
      running: true,
      healthy: true,
      url: "http://127.0.0.1:9010",
      port: 9010,
      logPath: "/tmp/wikibridge/system-test/opencode.log",
      projectId: null,
    }
  }
  const sessionId = `session-${state.nextId++}`
  const directory = "/tmp/wikibridge/system-test/opencode-data/users/default"
  return {
    sessionId,
    directory,
    url: `http://127.0.0.1:9010/mock/session/${sessionId}`,
  }
}

function createProject(args: unknown): KnowledgeProject {
  const input = readInput(args)
  const name = String(input.name || "知识库")
  const folderPath = String(input.folderPath || input.folder_path || "/tmp/wikibridge-project")
  const project: KnowledgeProject = {
    project_id: `project-${state.nextId++}`,
    name,
    folder_path: folderPath,
    raw_dir: `${folderPath}/raw`,
    materials: [],
    build_status: "not_built",
    link_status: "not_linked",
  }
  state.projects = [project, ...state.projects]
  state.wikiProjects[project.project_id] = sampleWikiProject(project)
  state.projectTrees[project.project_id] = sampleTree()
  return clone(project)
}

function deleteProject(projectId: string) {
  state.projects = state.projects.filter((item) => item.project_id !== projectId)
  state.connections = state.connections.filter((item) => item.project_id !== projectId)
  delete state.wikiProjects[projectId]
  delete state.projectTrees[projectId]
}

function ensureWikiProject(projectId: string): WikiProjectState {
  const project = state.projects.find((item) => item.project_id === projectId)
  if (!project) throw new Error("项目不存在")
  state.wikiProjects[projectId] ||= sampleWikiProject(project)
  return clone(state.wikiProjects[projectId])
}

function saveLlmWikiConfig(args: unknown): LlmWikiLlmConfig {
  const input = readInput(args)
  const next: LlmWikiLlmConfig = {
    provider: String(input.provider || "deepseek"),
    apiKey: String(input.apiKey || ""),
    model: String(input.model || "deepseek-v4-flash"),
    baseUrl: String(input.baseUrl || "https://api.deepseek.com/v1"),
    maxContextSize: Number(input.maxContextSize || 64000),
    configured: Boolean(String(input.apiKey || "").trim()),
  }
  state.llmConfig = next
  return clone(next)
}

function saveLlmSettings(args: unknown): LlmSettings {
  const input = readInput(args)
  const provider = String(input.provider || "deepseek")
  const model = String(input.model || "deepseek-chat")
  const baseUrl = typeof input.baseUrl === "string" ? input.baseUrl : null
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : ""
  state.llmSettings = {
    provider,
    model,
    baseUrl,
    hasApiKey: apiKey ? true : state.llmSettings.hasApiKey,
  }
  return clone(state.llmSettings)
}

function ensureProjectTree(projectId: string): ProjectTreeNode {
  state.projectTrees[projectId] ||= sampleTree()
  return clone(state.projectTrees[projectId])
}

function readProjectDocument(nodeId: string): ProjectDocumentContent {
  const document = state.projectDocuments[nodeId]
  if (!document) throw new Error("文档不存在")
  return clone(document)
}

function importWikiSources(args: unknown) {
  const input = readInput(args)
  const projectId = String(input.projectId || input.project_id || "")
  const project = ensureWikiProject(projectId)
  project.sourceCount += Array.isArray(input.paths) ? input.paths.length : 1
  state.wikiProjects[projectId] = project
  return {
    project: project.project,
    queue: project.queue,
    importedPaths: Array.isArray(input.paths) ? input.paths : [],
    skippedPaths: [],
  }
}

function buildWikiProject(projectId: string) {
  const project = ensureWikiProject(projectId)
  project.queue = { pending: 1, processing: 0, failed: 0, completed: 0, total: 1 }
  state.wikiProjects[projectId] = project
  return {
    project: project.project,
    queue: project.queue,
    enqueuedCount: 1,
  }
}

function createConnection(args: unknown): ProjectConnection {
  const input = readInput(args)
  const projectId = String(input.projectId || input.project_id || "")
  const project = state.projects.find((item) => item.project_id === projectId)
  if (!project) throw new Error("项目不存在")
  const connection: ProjectConnection = {
    connection_id: `connection-${state.nextId++}`,
    project_id: project.project_id,
    project_name: project.name,
    proxy_id: state.nextId,
    public_url: null,
    running: false,
    enabled: true,
    service_ready: true,
    traffic_limit_mb: Number(input.trafficMb || 100),
    traffic_used_bytes: 0,
    status: "stopped",
  }
  state.connections = [connection, ...state.connections]
  return clone(connection)
}

function updateConnection(
  connectionId: string,
  patch: Partial<ProjectConnection>,
): ProjectConnection {
  const index = state.connections.findIndex((item) => item.connection_id === connectionId)
  if (index < 0) throw new Error("连接不存在")
  const next = {
    ...state.connections[index],
    ...patch,
    status: patch.running ? "running" : "stopped",
  }
  state.connections[index] = next
  return clone(next)
}

function sampleProject(): KnowledgeProject {
  return {
    project_id: "project-1",
    name: "示例知识库",
    folder_path: "/tmp/wikibridge/sample",
    raw_dir: "/tmp/wikibridge/sample/raw",
    materials: [],
    build_status: "built",
    link_status: "linked",
  }
}

function sampleRemoteProjects(): RemoteProject[] {
  return [
    {
      id: "remote-project-1",
      name: "团队项目",
      path: "/remote/team",
      current: true,
    },
  ]
}

function stoppedSidecar(): SidecarState {
  return {
    running: false,
    healthy: false,
    url: null,
    port: null,
    logPath: null,
    projectId: null,
  }
}

function normalizeRemoteUrl(value: string) {
  return value
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
}

function normalizeRemoteApiUrl(value: string) {
  const normalized = normalizeRemoteUrl(value)
  if (normalized.endsWith("/api/v1")) return normalized
  if (normalized.endsWith("/api")) return `${normalized}/v1`
  return `${normalized}/api/v1`
}

function sampleWikiProject(project: KnowledgeProject): WikiProjectState {
  return {
    project: { id: project.project_id, name: project.name, path: project.folder_path },
    queue: { pending: 0, processing: 0, failed: 0, completed: 1, total: 1 },
    sourceCount: 1,
    wikiCount: 1,
  }
}

function sampleTree(): ProjectTreeNode {
  return {
    node_id: "",
    name: "root",
    kind: "directory",
    readable: false,
    children: [
      {
        node_id: "intro.md",
        name: "Intro.md",
        kind: "file",
        document_id: "intro.md",
        readable: true,
        children: [],
      },
    ],
  }
}

function snapshot(): AppSnapshot {
  return { is_authenticated: state.authenticated }
}

function readInput(args: unknown): Record<string, unknown> {
  return isRecord(args) && isRecord(args.input) ? args.input : {}
}

function readStringArg(args: unknown, key: string): string {
  if (!isRecord(args)) return ""
  const value = args[key]
  return typeof value === "string" ? value : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value))
}

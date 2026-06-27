import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import {
  BookOpen,
  ExternalLink,
  Plus,
  RefreshCcw,
  Save,
  Server,
  TerminalSquare,
  Trash2,
} from "lucide-react"
import BearFrpApp from "./BearFrpApp"

type Entry = "bearfrp" | "opencode"
type LlmMode = "openai" | "deepseek" | "relay"

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"

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
  apiKey?: string | null
  hasApiKey: boolean
}

type OpenCodeStack = {
  opencodeUrl: string
  llmWikiUrl: string
  opencodePort: number
  llmWikiPort?: number | null
  projectId?: string | null
  mcpServerName?: string | null
  mcpStatus?: string | null
  sessionId?: string | null
  sessionUrl?: string | null
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
  projects?: RemoteProject[]
  currentProject?: RemoteProject | null
  authRequired: boolean
  mcpStatus: string
  addedAt: number
  lastOpenedAt?: number | null
}

type RemoteKnowledgeBaseCheck = {
  url: string
  apiUrl: string
  ok: boolean
  status: string
  message: string
  llmWikiHealthy: boolean
  projectCount: number
  projects?: RemoteProject[]
  currentProject?: RemoteProject | null
  authRequired: boolean
  mcpStatus?: string | null
}

type RemoteKnowledgeBaseConnect = {
  stack: OpenCodeStack
  remote: RemoteKnowledgeBase
  session: OpenCodeSession
}

type OpenCodeSession = {
  sessionId: string
  directory: string
  url: string
}

export default function App() {
  const [activeEntry, setActiveEntry] = useState<Entry>("bearfrp")
  const [services, setServices] = useState<DesktopServicesState | null>(null)
  const [llmSettings, setLlmSettings] = useState<LlmSettings | null>(null)
  const [llmModeDraft, setLlmModeDraft] = useState<LlmMode>("deepseek")
  const [relayProviderDraft, setRelayProviderDraft] = useState("openai")
  const [llmModelDraft, setLlmModelDraft] = useState(defaultModelForMode("deepseek"))
  const [llmBaseUrlDraft, setLlmBaseUrlDraft] = useState(DEEPSEEK_BASE_URL)
  const [llmApiKeyDraft, setLlmApiKeyDraft] = useState("")
  const [remoteKnowledgeBases, setRemoteKnowledgeBases] = useState<RemoteKnowledgeBase[]>([])
  const [remoteUrl, setRemoteUrl] = useState("")
  const [remotePassword, setRemotePassword] = useState("")
  const [remoteNeedsPassword, setRemoteNeedsPassword] = useState(false)
  const [activeRemoteId, setActiveRemoteId] = useState("")
  const [viewerMode, setViewerMode] = useState<"local" | "remote">("local")
  const [sessionViewerUrl, setSessionViewerUrl] = useState("")
  const [showAdvancedModel, setShowAdvancedModel] = useState(false)
  const [frameKey, setFrameKey] = useState(0)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const autoStartAttempted = useRef(false)

  const activeRemote = useMemo(
    () => remoteKnowledgeBases.find((item) => item.remoteId === activeRemoteId) || null,
    [activeRemoteId, remoteKnowledgeBases],
  )
  const viewerUrl = sessionViewerUrl
  const viewerTitle =
    viewerMode === "remote" && activeRemote
      ? `${activeRemote.name} · 本地 OpenCode`
      : "本地 OpenCode"
  const viewerPlaceholder = services?.opencode.running
    ? "本地 OpenCode 已启动，点击“进入对话”创建聊天会话"
    : activeRemote
      ? "正在准备本地 OpenCode"
      : "请先保存模型设置并启动本地 OpenCode"

  const applyLlmSettingsToDraft = useCallback((settings: LlmSettings) => {
    const mode = inferLlmMode(settings)
    setLlmSettings(settings)
    setLlmModeDraft(mode)
    setRelayProviderDraft(mode === "relay" ? settings.provider || "openai" : "openai")
    setLlmModelDraft(settings.model || defaultModelForMode(mode))
    setLlmBaseUrlDraft(
      mode === "relay" ? settings.baseUrl || "" : mode === "deepseek" ? DEEPSEEK_BASE_URL : "",
    )
    setLlmApiKeyDraft(settings.apiKey || "")
  }, [])

  const refreshServices = useCallback(async () => {
    const next = await invoke<DesktopServicesState>("get_desktop_services_state")
    setServices(next)
    return next
  }, [])

  const refreshRemoteKnowledgeBases = useCallback(async () => {
    const items = await invoke<RemoteKnowledgeBase[]>("list_remote_knowledge_bases")
    setRemoteKnowledgeBases(sortRemoteKnowledgeBases(items))
    return items
  }, [])

  const refreshLlmSettings = useCallback(async () => {
    const next = await invoke<LlmSettings>("get_llm_settings")
    applyLlmSettingsToDraft(next)
    return next
  }, [applyLlmSettingsToDraft])

  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => setError(""), 3000)
    return () => window.clearTimeout(timer)
  }, [error])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        await Promise.all([refreshServices(), refreshRemoteKnowledgeBases(), refreshLlmSettings()])
        if (cancelled) return
      } catch (err) {
        if (!cancelled) setError(friendlyError(err))
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [refreshLlmSettings, refreshRemoteKnowledgeBases, refreshServices])

  useEffect(() => {
    if (activeEntry !== "opencode") return
    if (!llmSettings?.hasApiKey) return
    if (!services?.opencode.running || !services.opencode.healthy) return
    if (sessionViewerUrl || busy) return
    if (autoStartAttempted.current) return

    autoStartAttempted.current = true
    createOpenCodeSession().catch((err) => {
      autoStartAttempted.current = false
      setError(friendlyError(err))
    })
  }, [
    activeEntry,
    busy,
    llmSettings?.hasApiKey,
    services?.opencode.healthy,
    services?.opencode.running,
    sessionViewerUrl,
  ])

  async function addRemoteKnowledgeBase(event: FormEvent) {
    event.preventDefault()
    setBusy("remote-add")
    setError("")
    try {
      const url = remoteUrl.trim()
      if (!remoteNeedsPassword) {
        const check = await invoke<RemoteKnowledgeBaseCheck>("probe_remote_llm_wiki", {
          url,
          token: null,
        })
        if (!check.ok && check.authRequired) {
          setRemoteNeedsPassword(true)
          setNotice("该知识库需要访问密码")
          return
        }
        if (!check.ok) {
          throw new Error(check.message)
        }
      }
      const remote = await invoke<RemoteKnowledgeBase>("add_remote_knowledge_base", {
        input: { name: null, url, token: remoteNeedsPassword ? remotePassword || null : null },
      })
      setRemoteKnowledgeBases((items) =>
        sortRemoteKnowledgeBases(upsertRemoteKnowledgeBase(items, remote)),
      )
      setRemoteUrl("")
      setRemotePassword("")
      setRemoteNeedsPassword(false)
      setActiveRemoteId(remote.remoteId)
      setViewerMode("remote")
      setNotice(
        remote.status === "ready"
          ? "远程知识库已添加"
          : `远程知识库已添加：${remoteStatusLabel(remote.status)}`,
      )
    } catch (err) {
      const message = friendlyError(err)
      setError(remoteNeedsPassword && message.includes("密码") ? "密码不正确或已失效" : message)
    } finally {
      setBusy("")
    }
  }

  async function openRemoteKnowledgeBase(remote: RemoteKnowledgeBase) {
    if (!llmSettings?.hasApiKey) {
      setError("请先保存模型供应商和 API Key，然后再打开远程知识库。")
      return
    }
    setActiveRemoteId(remote.remoteId)
    setActiveEntry("opencode")
    setViewerMode("remote")
    setBusy(`remote-open-${remote.remoteId}`)
    setError("")
    try {
      const result = await invoke<RemoteKnowledgeBaseConnect>("ensure_opencode_for_remote", {
        remoteId: remote.remoteId,
      })
      await refreshServices()
      setRemoteKnowledgeBases((items) =>
        sortRemoteKnowledgeBases(upsertRemoteKnowledgeBase(items, result.remote)),
      )
      setSessionViewerUrl(result.session.url)
      setFrameKey((key) => key + 1)
      setNotice("本地 OpenCode 已连接远程知识库并创建对话")
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy("")
    }
  }

  async function saveLlmSettings(event: FormEvent) {
    event.preventDefault()
    setBusy("llm-settings")
    setError("")
    try {
      const payload = llmSettingsPayload(
        llmModeDraft,
        relayProviderDraft,
        llmModelDraft,
        llmBaseUrlDraft,
        llmApiKeyDraft,
      )
      const next = await invoke<LlmSettings>("save_llm_settings", {
        input: payload,
      })
      applyLlmSettingsToDraft(next)
      setNotice("模型设置已保存")
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy("")
    }
  }

  async function startLocalOpenCode(options: { auto?: boolean } = {}) {
    setBusy("opencode-start")
    if (!options.auto) setError("")
    try {
      const stack = await invoke<OpenCodeStack>("ensure_opencode_stack_running")
      await refreshServices()
      if (stack.sessionUrl) {
        setSessionViewerUrl(stack.sessionUrl)
        setFrameKey((key) => key + 1)
      } else {
        await openNewOpenCodeSession()
      }
      setViewerMode("local")
      setActiveRemoteId("")
      setNotice(
        options.auto
          ? `本地 OpenCode 已自动启动并创建对话：${stack.opencodeUrl}`
          : `本地 OpenCode 已启动并创建对话：${stack.opencodeUrl}`,
      )
    } catch (err) {
      if (options.auto) {
        setNotice("")
      }
      setError(friendlyError(err))
    } finally {
      setBusy("")
    }
  }

  async function stopLocalOpenCode() {
    setBusy("opencode-stop")
    setError("")
    try {
      await invoke("stop_opencode_stack")
      await refreshServices()
      setSessionViewerUrl("")
      setNotice("本地 OpenCode 已停止")
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy("")
    }
  }

  function changeLlmMode(mode: LlmMode) {
    const previousDefault = defaultModelForMode(llmModeDraft)
    setLlmModeDraft(mode)
    if (mode === "openai") setLlmBaseUrlDraft("")
    if (mode === "deepseek") setLlmBaseUrlDraft(DEEPSEEK_BASE_URL)
    setLlmModelDraft((current) => {
      if (!current || current === previousDefault) return defaultModelForMode(mode)
      return current
    })
  }

  async function removeRemoteKnowledgeBase(remote: RemoteKnowledgeBase) {
    if (!window.confirm(`删除远程知识库“${remote.name}”？`)) return
    setBusy(`remote-remove-${remote.remoteId}`)
    setError("")
    try {
      await invoke("remove_remote_knowledge_base", { remoteId: remote.remoteId })
      setRemoteKnowledgeBases((items) => items.filter((item) => item.remoteId !== remote.remoteId))
      if (activeRemoteId === remote.remoteId) {
        setActiveRemoteId("")
      }
      setNotice("远程知识库已删除")
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy("")
    }
  }

  async function checkRemoteKnowledgeBase(remote: RemoteKnowledgeBase) {
    setBusy(`remote-check-${remote.remoteId}`)
    setError("")
    try {
      const check = await invoke<RemoteKnowledgeBaseCheck>("check_remote_knowledge_base", {
        url: remote.url,
      })
      setRemoteKnowledgeBases((items) =>
        sortRemoteKnowledgeBases(
          items.map((item) =>
            item.remoteId === remote.remoteId
              ? { ...item, url: check.url, status: check.status }
              : item,
          ),
        ),
      )
      if (check.ok) {
        setNotice(check.message)
      } else {
        setError(check.message)
      }
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy("")
    }
  }

  async function selectRemoteProject(remote: RemoteKnowledgeBase, projectId: string) {
    setBusy(`remote-project-${remote.remoteId}`)
    setError("")
    try {
      const updated = await invoke<RemoteKnowledgeBase>("select_remote_knowledge_base_project", {
        remoteId: remote.remoteId,
        projectId,
      })
      setRemoteKnowledgeBases((items) =>
        sortRemoteKnowledgeBases(upsertRemoteKnowledgeBase(items, updated)),
      )
      setNotice(`已选择知识库项目：${updated.currentProject?.name || projectId}`)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy("")
    }
  }

  async function createOpenCodeSession(options: { forceLocal?: boolean } = {}) {
    setBusy("opencode-session")
    setError("")
    try {
      if (!options.forceLocal && viewerMode === "remote" && activeRemote) {
        const result = await invoke<RemoteKnowledgeBaseConnect>("ensure_opencode_for_remote", {
          remoteId: activeRemote.remoteId,
        })
        await refreshServices()
        setRemoteKnowledgeBases((items) =>
          sortRemoteKnowledgeBases(upsertRemoteKnowledgeBase(items, result.remote)),
        )
        setSessionViewerUrl(result.session.url)
        setFrameKey((key) => key + 1)
        setNotice("OpenCode 远程知识库对话已创建")
        return
      }
      const stack = await invoke<OpenCodeStack>("ensure_opencode_stack_running")
      await refreshServices()
      if (stack.sessionUrl) {
        setSessionViewerUrl(stack.sessionUrl)
        setFrameKey((key) => key + 1)
      } else {
        await openNewOpenCodeSession()
      }
      setViewerMode("local")
      setActiveRemoteId("")
      setNotice("OpenCode 对话已创建")
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy("")
    }
  }

  async function openNewOpenCodeSession() {
    const session = await invoke<OpenCodeSession>("create_opencode_session")
    setSessionViewerUrl(session.url)
    setFrameKey((key) => key + 1)
    return session
  }

  return (
    <div className="desktop-root">
      <header className="desktop-topbar">
        <div className="desktop-brand">
          <BookOpen size={22} aria-hidden="true" />
          <div>
            <strong>WikiBridge</strong>
            <span>Desktop</span>
          </div>
        </div>

        <nav className="entry-nav" aria-label="入口">
          <button
            className={activeEntry === "bearfrp" ? "active" : ""}
            onClick={() => setActiveEntry("bearfrp")}
          >
            <Server size={17} />
            发布端
          </button>
          <button
            className={activeEntry === "opencode" ? "active" : ""}
            onClick={() => setActiveEntry("opencode")}
          >
            <TerminalSquare size={17} />
            消费端
          </button>
        </nav>

        <div className="desktop-actions">
          <button
            className="icon-button"
            title="刷新"
            onClick={() => {
              refreshServices().catch((err) => setError(friendlyError(err)))
              refreshRemoteKnowledgeBases().catch((err) => setError(friendlyError(err)))
            }}
            disabled={Boolean(busy)}
          >
            <RefreshCcw size={17} aria-hidden="true" />
          </button>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}
      {notice && (
        <div className="alert notice" onClick={() => setNotice("")}>
          {notice}
        </div>
      )}

      {activeEntry === "bearfrp" ? (
        <section className="entry-pane">
          <BearFrpApp />
        </section>
      ) : (
        <section className="entry-pane opencode-pane">
          <div className="opencode-workspace">
            <aside className="opencode-sidebar">
              <section className="opencode-section">
                <div className="section-heading compact">
                  <div>
                    <h2>模型设置</h2>
                    <p>
                      {llmSettings?.hasApiKey
                        ? `${modelProviderLabel(llmSettings.provider)} / ${llmSettings.model}`
                        : "默认 DeepSeek，只需保存 API Key"}
                    </p>
                  </div>
                  {llmSettings?.hasApiKey && (
                    <span className="remote-status" data-status="ready">
                      已配置
                    </span>
                  )}
                </div>
                <form className="llm-form" onSubmit={saveLlmSettings}>
                  <label>
                    {modelProviderLabel(currentProviderId(llmModeDraft, relayProviderDraft))} API
                    Key
                    <input
                      value={llmApiKeyDraft}
                      onChange={(event) => setLlmApiKeyDraft(event.target.value)}
                      placeholder="粘贴 API Key"
                      type="password"
                      autoComplete="off"
                    />
                  </label>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setShowAdvancedModel((value) => !value)}
                  >
                    {showAdvancedModel ? "收起高级模型设置" : "高级模型设置"}
                  </button>
                  {showAdvancedModel && (
                    <div className="advanced-model-panel">
                      <div className="provider-tabs" role="tablist" aria-label="模型供应商">
                        <button
                          type="button"
                          className={llmModeDraft === "openai" ? "active" : ""}
                          onClick={() => changeLlmMode("openai")}
                        >
                          OpenAI
                        </button>
                        <button
                          type="button"
                          className={llmModeDraft === "deepseek" ? "active" : ""}
                          onClick={() => changeLlmMode("deepseek")}
                        >
                          DeepSeek
                        </button>
                        <button
                          type="button"
                          className={llmModeDraft === "relay" ? "active" : ""}
                          onClick={() => changeLlmMode("relay")}
                        >
                          中转站
                        </button>
                      </div>
                      {llmModeDraft === "relay" && (
                        <label>
                          Provider ID
                          <input
                            value={relayProviderDraft}
                            onChange={(event) => setRelayProviderDraft(event.target.value)}
                            placeholder="默认 openai，可填 openrouter / custom-openai"
                          />
                        </label>
                      )}
                      <label>
                        模型
                        <input
                          value={llmModelDraft}
                          onChange={(event) => setLlmModelDraft(event.target.value)}
                          placeholder={defaultModelForMode(llmModeDraft)}
                        />
                      </label>
                      {llmModeDraft === "relay" && (
                        <label>
                          Base URL
                          <input
                            value={llmBaseUrlDraft}
                            onChange={(event) => setLlmBaseUrlDraft(event.target.value)}
                            placeholder="https://example.com/v1"
                          />
                        </label>
                      )}
                    </div>
                  )}
                  <div className="card-actions compact-actions">
                    <button className="primary" disabled={busy === "llm-settings"}>
                      <Save size={17} />
                      保存
                    </button>
                  </div>
                </form>
              </section>

              <section className="opencode-section">
                <div className="section-heading compact">
                  <div>
                    <h2>添加远程知识库</h2>
                    <p>粘贴分享方提供的 URL 地址。</p>
                  </div>
                </div>
                <form className="remote-form" onSubmit={addRemoteKnowledgeBase}>
                  <label>
                    URL 地址
                    <input
                      value={remoteUrl}
                      onChange={(event) => {
                        setRemoteUrl(event.target.value)
                        setRemoteNeedsPassword(false)
                        setRemotePassword("")
                      }}
                      placeholder="https://wiki.example.com 或 /api/v1"
                    />
                  </label>
                  {remoteNeedsPassword && (
                    <label>
                      访问密码
                      <input
                        value={remotePassword}
                        onChange={(event) => setRemotePassword(event.target.value)}
                        placeholder="输入分享方提供的密码"
                        type="password"
                        autoComplete="off"
                      />
                    </label>
                  )}
                  <button className="primary" disabled={busy === "remote-add" || !remoteUrl.trim()}>
                    <Plus size={17} />
                    {remoteNeedsPassword ? "验证并添加" : "添加"}
                  </button>
                </form>
              </section>

              <section className="opencode-section remote-section">
                <div className="section-heading compact">
                  <div>
                    <h2>远程知识库</h2>
                    <p>
                      {remoteKnowledgeBases.length
                        ? `${remoteKnowledgeBases.length} 个 API 分享`
                        : "还没有添加远程 API"}
                    </p>
                  </div>
                  <button
                    className="icon-button"
                    title="刷新列表"
                    onClick={() => refreshRemoteKnowledgeBases()}
                    disabled={Boolean(busy)}
                  >
                    <RefreshCcw size={17} aria-hidden="true" />
                  </button>
                </div>
                {remoteKnowledgeBases.length ? (
                  <div className="remote-list">
                    {remoteKnowledgeBases.map((remote) => (
                      <article
                        className={
                          activeRemoteId === remote.remoteId ? "remote-card active" : "remote-card"
                        }
                        key={remote.remoteId}
                        onClick={() => {
                          setActiveRemoteId(remote.remoteId)
                          setViewerMode("remote")
                        }}
                      >
                        <div className="remote-card-heading">
                          <div>
                            <strong>{remote.name}</strong>
                            <span>{remote.apiUrl || remote.url}</span>
                          </div>
                          <span className="remote-status" data-status={remote.status}>
                            {remoteStatusLabel(remote.status)}
                          </span>
                        </div>
                        <div className="remote-card-meta">
                          <span>{remote.currentProject?.name || `${remote.projectCount || 0} 个项目`}</span>
                          {remote.authRequired && <span>需要访问密码</span>}
                        </div>
                        <div className="card-actions">
                          <button
                            className="icon-button danger"
                            title="删除"
                            onClick={(event) => {
                              event.stopPropagation()
                              removeRemoteKnowledgeBase(remote)
                            }}
                            disabled={busy === `remote-remove-${remote.remoteId}`}
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state compact">
                    添加远程知识库 URL 后可进入本地 OpenCode。
                  </div>
                )}
              </section>
            </aside>

            <div className="opencode-viewer">
              <div className="viewer-toolbar">
                <div>
                  <strong>{viewerTitle}</strong>
                  <span>{viewerUrl || viewerPlaceholder}</span>
                </div>
                <div className="card-actions">
                  {viewerUrl && (
                    <button
                      className="primary"
                      onClick={() => createOpenCodeSession()}
                      disabled={
                        !llmSettings?.hasApiKey ||
                        busy === "opencode-session" ||
                        busy === "opencode-start"
                      }
                    >
                      <Plus size={17} />
                      新建对话
                    </button>
                  )}
                  {viewerUrl && (
                    <button className="secondary" onClick={() => setFrameKey((key) => key + 1)}>
                      <RefreshCcw size={17} />
                      刷新
                    </button>
                  )}
                  {viewerUrl && (
                    <button className="secondary" onClick={() => window.open(viewerUrl, "_blank")}>
                      <ExternalLink size={17} />
                      浏览器
                    </button>
                  )}
                </div>
              </div>
              {viewerUrl ? (
                <div className="opencode-frame-wrap">
                  <iframe
                    className="opencode-frame"
                    src={viewerUrl}
                    title={viewerTitle}
                    key={`${viewerUrl}-${frameKey}`}
                  />
                  <div className="opencode-frame-hint">
                    <span>如果当前页没有输入框，请使用外层“新建对话”创建会话。</span>
                    <button
                      className="secondary compact"
                      onClick={() => createOpenCodeSession()}
                      disabled={
                        !llmSettings?.hasApiKey ||
                        busy === "opencode-session" ||
                        busy === "opencode-start"
                      }
                    >
                      <Plus size={15} />
                      新建对话
                    </button>
                  </div>
                </div>
              ) : (
                <div className="remote-empty-panel">
                  <TerminalSquare size={32} aria-hidden="true" />
                  <h1>{activeRemote ? activeRemote.name : "本地 OpenCode"}</h1>
                  <p>
                    {activeRemote
                      ? "通过本地 OpenCode 进入这个远程知识库上下文。"
                      : "保存模型设置后，可在这里通过本地 OpenCode 提问。"}
                  </p>
                  <button
                    className="primary"
                    onClick={() =>
                      activeRemote
                        ? createOpenCodeSession()
                        : services?.opencode.running
                        ? createOpenCodeSession({ forceLocal: true })
                        : startLocalOpenCode()
                    }
                    disabled={
                      !llmSettings?.hasApiKey ||
                      busy === "opencode-session" ||
                      busy === "opencode-start"
                    }
                  >
                    <TerminalSquare size={17} />
                    {activeRemote || !services?.opencode.running ? "启动并进入" : "进入对话"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function inferLlmMode(settings: LlmSettings): LlmMode {
  const provider = settings.provider.trim().toLowerCase()
  const baseUrl = (settings.baseUrl || "").trim().replace(/\/+$/, "")
  if (provider === "deepseek" && (!baseUrl || baseUrl === DEEPSEEK_BASE_URL)) return "deepseek"
  if (provider === "openai" && !baseUrl) return "openai"
  return "relay"
}

function llmSettingsPayload(
  mode: LlmMode,
  relayProvider: string,
  model: string,
  baseUrl: string,
  apiKey: string,
) {
  const provider = currentProviderId(mode, relayProvider)
  if (mode === "openai") return { provider, model, apiKey: apiKey.trim() || null, baseUrl: null }
  if (mode === "deepseek")
    return { provider, model, apiKey: apiKey.trim() || null, baseUrl: DEEPSEEK_BASE_URL }
  return {
    provider,
    model,
    apiKey: apiKey.trim() || null,
    baseUrl: baseUrl.trim() || null,
  }
}

function currentProviderId(mode: LlmMode, relayProvider: string) {
  if (mode === "openai") return "openai"
  if (mode === "deepseek") return "deepseek"
  return relayProvider.trim() || "openai"
}

function defaultModelForMode(mode: LlmMode) {
  if (mode === "deepseek") return "deepseek-v4-flash"
  return "gpt-5"
}

function modelProviderLabel(provider: string) {
  const normalized = provider.trim().toLowerCase()
  if (normalized === "deepseek") return "DeepSeek"
  if (normalized === "openai") return "OpenAI"
  return provider || "自定义"
}

function serviceLabel(service?: SidecarState | null) {
  if (!service?.running) return "未启动"
  if (service.healthy) return service.url || "运行中"
  return service.url ? `${service.url}（启动中）` : "启动中"
}

function sortRemoteKnowledgeBases(items: RemoteKnowledgeBase[]) {
  return [...items].sort((left, right) => {
    const leftTime = left.lastOpenedAt || left.addedAt
    const rightTime = right.lastOpenedAt || right.addedAt
    return rightTime - leftTime || left.name.localeCompare(right.name)
  })
}

function upsertRemoteKnowledgeBase(items: RemoteKnowledgeBase[], next: RemoteKnowledgeBase) {
  return items.some((item) => item.remoteId === next.remoteId)
    ? items.map((item) => (item.remoteId === next.remoteId ? next : item))
    : [next, ...items]
}

function remoteStatusLabel(status: string) {
  const labels: Record<string, string> = {
    ready: "可用",
    llm_wiki_unavailable: "知识库异常",
    auth_required: "需密码",
    unreachable: "不可达",
    not_llm_wiki: "非知识库 API",
    no_projects: "无项目",
  }
  return labels[status] || status
}

function mcpStatusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    connected: "已注册",
    registered: "已注册",
    disabled: "未启用",
    failed: "失败",
    not_registered: "未注册",
  }
  return labels[status || "not_registered"] || status || "未注册"
}

function friendlyError(error: unknown) {
  const text =
    error instanceof Error ? error.message : typeof error === "string" ? error : "操作失败"
  if (text.includes("二进制") || text.includes("启动") || text.includes("端口")) return text
  if (text.includes("模型供应商") || text.includes("API Key") || text.includes("模型名称"))
    return text
  if (text.includes("后端地址") || text.includes("backend")) return text
  if (text.includes("OpenCode") || text.includes("分享链接") || text.includes("远程知识库"))
    return text
  return text === "操作失败" ? "操作未完成，请稍后重试" : `操作未完成：${text}`
}

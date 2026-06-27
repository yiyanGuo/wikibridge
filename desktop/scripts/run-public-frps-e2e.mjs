#!/usr/bin/env node

import { spawn as spawnChild } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { executableName, hostPlatformKey } from "./platforms.mjs"

const required = ["WIKIBRIDGE_PUBLIC_FRPS_E2E", "WIKIBRIDGE_PUBLIC_SECRET"]
const missing = required.filter((key) => !process.env[key]?.trim())
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(__dirname, "..")
const artifactsDir = path.join(desktopDir, "test-results", "public-frps", timestamp())
const children = []
const cleanupTasks = []

try {
  validateEnvironment()
  mkdirSync(artifactsDir, { recursive: true })
  await main()
  console.log(`Public FRPS E2E passed. Logs: ${path.relative(desktopDir, artifactsDir)}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  for (const cleanup of cleanupTasks.reverse()) {
    try {
      await cleanup()
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
    }
  }
  for (const child of children.reverse()) {
    child.process.kill()
    child.log.end()
  }
}

process.exit(process.exitCode ?? 0)

function validateEnvironment() {
  if (process.env.WIKIBRIDGE_PUBLIC_FRPS_E2E !== "1") {
    fail(
      "Public FRPS E2E is opt-in. Set WIKIBRIDGE_PUBLIC_FRPS_E2E=1 with WIKIBRIDGE_PUBLIC_SECRET. Set WIKIBRIDGE_PUBLIC_URL to validate an existing publication, or omit it to provision one through BearFRP.",
    )
  }

  if (missing.length) {
    fail(`Missing required environment variables: ${missing.join(", ")}`)
  }
}

async function main() {
  const secret = process.env.WIKIBRIDGE_PUBLIC_SECRET.trim()
  const password = process.env.WIKIBRIDGE_PUBLIC_PASSWORD?.trim() || ""
  const publicUrl = value("WIKIBRIDGE_PUBLIC_URL")
    ? normalizeBaseUrl(process.env.WIKIBRIDGE_PUBLIC_URL)
    : await publishFixtureKnowledgeBase({ secret, password })
  const headers = apiHeaders(password)

  console.log(`Checking public LLM Wiki API at ${publicUrl}`)
  const project = await verifyPublicApi(publicUrl, headers, secret, Boolean(password))
  const llm = resolveLlmSettings()
  const opencode = await startOpenCode({ publicUrl, password, project, llm })
  await askOpenCodeForSecret(opencode, secret)
}

async function verifyPublicApi(publicUrl, headers, secret, hasPassword) {
  const health = await requestJson(`${publicUrl}/health`, { headers })
  assert(health.ok === true, "Health check did not return ok=true")

  if (health.authRequired && !hasPassword) {
    fail("Remote reports authRequired=true. Set WIKIBRIDGE_PUBLIC_PASSWORD to the publish password.")
  }

  const projects = await requestJson(`${publicUrl}/projects`, { headers })
  const currentProject = projects.currentProject || projects.projects?.find((project) => project.current)
  const project = currentProject || projects.projects?.[0]
  assert(project?.id, "Remote project list is empty")

  const search = await requestJson(`${publicUrl}/projects/${encodeURIComponent(project.id)}/search`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ query: secret, topK: 5, includeContent: true }),
  })

  const searchText = JSON.stringify(search)
  assert(
    searchText.includes(secret),
    "Public search completed but did not return the expected secret. Confirm the published knowledge base was built with the secret source.",
  )

  return {
    id: project.id,
    name: project.name || projects.currentProject?.name || "Public FRPS Knowledge Base",
  }
}

async function publishFixtureKnowledgeBase({ secret, password }) {
  const platform = hostPlatformKey()
  const llmBinary = sidecarBinary("llm-wiki-server", "llm-wiki-server", platform)
  const frpcBinary = sidecarBinary("frpc", "frpc", platform)
  if (!existsSync(llmBinary)) {
    fail(`LLM Wiki sidecar binary is missing: ${llmBinary}. Run npm --prefix desktop run sidecars:llm-wiki first.`)
  }
  if (!existsSync(frpcBinary)) {
    fail(`frpc sidecar binary is missing: ${frpcBinary}. Run npm --prefix desktop run sidecars:frpc first.`)
  }

  const appDataDir = mkdtempSync(path.join(tmpdir(), "wikibridge-public-frps-publisher-"))
  const llmDataDir = path.join(appDataDir, "llm-wiki")
  const llmPort = await freePort()
  const project = createLlmWikiSecretFixture(llmDataDir, secret, password)
  const llm = spawn(llmBinary, [], {
    cwd: appDataDir,
    env: {
      ...process.env,
      LLM_WIKI_DATA_DIR: llmDataDir,
      LLM_WIKI_BIND: "127.0.0.1",
      LLM_WIKI_PORT: String(llmPort),
      ...(password ? { LLM_WIKI_TOKEN: password } : {}),
    },
    logPath: path.join(artifactsDir, "llm-wiki-server.log"),
  })
  children.push(llm)

  const localApiUrl = `http://127.0.0.1:${llmPort}/api/v1`
  await waitForHttp(`${localApiUrl}/health`, "local LLM Wiki publisher", '"ok":true', {
    headers: apiHeaders(password),
  })

  const bearfrp = await authenticateBearFrp()
  const proxy = await createPublicHttpProxy(bearfrp, llmPort)
  cleanupTasks.push(async () => {
    await fetch(`${bearfrp.baseUrl}/api/proxies/${proxy.id}`, {
      method: "DELETE",
      headers: { cookie: bearfrp.cookie },
    })
  })

  const configPath = path.join(appDataDir, "frpc.toml")
  writeFileSync(configPath, proxy.frpcConfig)
  const frpc = spawn(frpcBinary, ["-c", configPath], {
    cwd: appDataDir,
    env: process.env,
    logPath: path.join(artifactsDir, "frpc.log"),
  })
  children.push(frpc)

  const publicUrl = normalizeBaseUrl(proxy.publicUrl)
  await waitForHttp(`${publicUrl}/health`, "public BearFRP LLM Wiki publication", '"ok":true', {
    headers: apiHeaders(password),
  })
  console.log(`Published temporary knowledge base "${project.name}" at ${publicUrl}`)
  return publicUrl
}

function createLlmWikiSecretFixture(llmDataDir, secret, password) {
  const projectId = `public-frps-${Date.now()}`
  const projectName = "WikiBridge Public FRPS E2E"
  const projectDir = path.join(llmDataDir, "projects", projectId)
  mkdirSync(path.join(projectDir, ".llm-wiki"), { recursive: true })
  mkdirSync(path.join(projectDir, "wiki"), { recursive: true })
  mkdirSync(path.join(projectDir, "raw", "sources"), { recursive: true })

  writeFileSync(
    path.join(projectDir, ".llm-wiki", "project.json"),
    JSON.stringify({ id: projectId, name: projectName }, null, 2),
  )
  writeFileSync(
    path.join(projectDir, "purpose.md"),
    "# Public FRPS E2E\n\nThis fixture verifies WikiBridge public publishing.\n",
  )
  writeFileSync(
    path.join(projectDir, "raw", "sources", "secret.md"),
    `# Public FRPS E2E Secret\n\nThe public FRPS E2E secret is ${secret}.\n`,
  )
  writeFileSync(
    path.join(projectDir, "wiki", "index.md"),
    `# Public FRPS E2E Secret\n\nThe public FRPS E2E secret is ${secret}.\n`,
  )
  writeFileSync(
    path.join(llmDataDir, "app-state.json"),
    JSON.stringify(
      {
        currentProject: { id: projectId, name: projectName, path: projectDir },
        projectRegistry: {
          [projectId]: { id: projectId, name: projectName, path: projectDir },
        },
        recentProjects: [{ id: projectId, name: projectName, path: projectDir }],
        apiConfig: {
          enabled: true,
          allowUnauthenticated: !password,
          mcpEnabled: true,
          token: password || "",
        },
      },
      null,
      2,
    ),
  )
  return { id: projectId, name: projectName, path: projectDir }
}

async function authenticateBearFrp() {
  const baseUrl = normalizeBackendUrl(
    value("WIKIBRIDGE_PUBLIC_BEARFRP_URL") || "https://frp.muleizh.ink",
  )
  const username = value("WIKIBRIDGE_PUBLIC_BEARFRP_USERNAME") || `wikibridge_e2e_${Date.now()}`
  const password = value("WIKIBRIDGE_PUBLIC_BEARFRP_PASSWORD") || `wikibridge-${randomUUID()}`
  const endpoint = value("WIKIBRIDGE_PUBLIC_BEARFRP_USERNAME") ? "login" : "register"
  const auth = await requestJsonWithResponse(`${baseUrl}/api/user/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  })
  const cookie = cookieHeader(auth.response)
  assert(cookie, "BearFRP did not set a user session cookie")

  if (!value("WIKIBRIDGE_PUBLIC_BEARFRP_SKIP_RECHARGE")) {
    await requestJson(`${baseUrl}/api/user/recharge`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: "{}",
    })
  }

  return { baseUrl, cookie }
}

async function createPublicHttpProxy(bearfrp, localPort) {
  const subdomain = `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
  const trafficMb = Number(value("WIKIBRIDGE_PUBLIC_TRAFFIC_MB") || 10)
  const response = await requestJson(`${bearfrp.baseUrl}/api/proxies`, {
    method: "POST",
    headers: { cookie: bearfrp.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: subdomain,
      proxy_type: "http",
      traffic_mb: trafficMb,
      speed_limit_kbps: 1024,
      local_ip: "127.0.0.1",
      local_port: localPort,
      subdomain,
    }),
  })
  const publicUrl = response.proxy?.public_url || response.proxy?.public_urls?.[0]
  assert(response.proxy?.id, "BearFRP proxy creation did not return proxy.id")
  assert(response.frpc_config, "BearFRP proxy creation did not return frpc_config")
  assert(publicUrl, "BearFRP proxy creation did not return a public URL")
  return {
    id: response.proxy.id,
    publicUrl,
    frpcConfig: response.frpc_config,
  }
}

async function startOpenCode({ publicUrl, password, project, llm }) {
  const platform = hostPlatformKey()
  const binary = sidecarBinary("opencode", "opencode", platform)
  if (!existsSync(binary)) {
    fail(`OpenCode sidecar binary is missing: ${binary}. Run npm --prefix desktop run sidecars:opencode first.`)
  }

  const appDataDir = mkdtempSync(path.join(tmpdir(), "wikibridge-public-frps-opencode-"))
  const dataDir = path.join(appDataDir, "opencode-data")
  const workDir = path.join(appDataDir, "opencode-workspace")
  const configDir = path.join(dataDir, "config")
  const xdgConfigDir = path.join(dataDir, "xdg-config")
  const xdgDataDir = path.join(dataDir, "xdg-data")
  const xdgStateDir = path.join(dataDir, "xdg-state")
  const xdgCacheDir = path.join(dataDir, "xdg-cache")
  const isolatedHome = path.join(dataDir, "home")
  const port = await freePort()

  for (const dir of [
    path.join(dataDir, "users", "default"),
    path.join(dataDir, "wiki"),
    workDir,
    configDir,
    xdgConfigDir,
    xdgDataDir,
    xdgStateDir,
    xdgCacheDir,
    isolatedHome,
  ]) {
    mkdirSync(dir, { recursive: true })
  }
  writeKbAgentInstructions(workDir, project)

  const env = {
    ...process.env,
    OPENCODE_KB_MODE: "1",
    OPENCODE_KB_DATA_DIR: dataDir,
    OPENCODE_KB_USER: "default",
    OPENCODE_KB_READONLY: "1",
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_CONFIG_DIR: configDir,
    OPENCODE_DB: path.join(dataDir, "opencode.db"),
    XDG_CONFIG_HOME: xdgConfigDir,
    XDG_DATA_HOME: xdgDataDir,
    XDG_STATE_HOME: xdgStateDir,
    XDG_CACHE_HOME: xdgCacheDir,
    OPENCODE_TEST_HOME: isolatedHome,
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    LLM_WIKI_BASE_URL: publicUrl,
    LLM_WIKI_PROJECT_ID: project.id,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(openCodeConfig(llm)),
  }
  if (password) env.LLM_WIKI_TOKEN = password

  const child = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: workDir,
    env,
    logPath: path.join(artifactsDir, "opencode.log"),
  })
  children.push(child)

  const baseUrl = `http://127.0.0.1:${port}`
  await waitForHttp(`${baseUrl}/global/health`, "OpenCode sidecar", '"healthy":true')
  await waitForHttp(`${baseUrl}/vcs?directory=%2Fusers%2Fdefault`, "OpenCode KB session guard", "{}")
  await waitForHttp(`${baseUrl}/instance/llm-wiki/health`, "OpenCode LLM Wiki proxy", '"ok":true')

  return { baseUrl, workDir, project }
}

async function askOpenCodeForSecret(opencode, secret) {
  const question =
    process.env.WIKIBRIDGE_PUBLIC_QUESTION?.trim() ||
    "请在当前知识库中查找 public FRPS E2E secret，并只回答秘密字符串本身，不要添加解释。"
  const directoryQuery = `directory=${encodeURIComponent(opencode.workDir)}`
  const session = await requestJson(`${opencode.baseUrl}/session?${directoryQuery}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
  const sessionId = session.id || session.data?.id
  assert(sessionId, "OpenCode did not return a session id")

  const answer = await requestJson(`${opencode.baseUrl}/session/${encodeURIComponent(sessionId)}/message?${directoryQuery}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      parts: [{ type: "text", text: question }],
    }),
  })

  if (answer?.info?.error) {
    const message = answer.info.error.data?.message || answer.info.error.name || "unknown model error"
    fail(`OpenCode model call failed: ${message}`)
  }
  const answerText = textFromMessage(answer)
  writeFileSync(path.join(artifactsDir, "opencode-answer.json"), JSON.stringify(answer, null, 2))
  assert(
    answerText.includes(secret),
    `OpenCode answered through the public knowledge base, but the response did not include the expected secret. Answer text: ${answerText.slice(0, 500)}`,
  )
}

function resolveLlmSettings() {
  const publisher = readPublisherLlmSettings()
  const persisted = readPersistedLlmSettings()
  const provider =
    value("WIKIBRIDGE_PUBLIC_LLM_PROVIDER") ||
    value("WIKIBRIDGE_LLM_PROVIDER") ||
    (value("OPENAI_API_KEY") && !value("DEEPSEEK_API_KEY") && !value("WIKIBRIDGE_PUBLIC_LLM_API_KEY")
      ? "openai"
      : "") ||
    publisher?.provider ||
    persisted?.provider ||
    "deepseek"
  const model =
    value("WIKIBRIDGE_PUBLIC_LLM_MODEL") ||
    value("WIKIBRIDGE_LLM_MODEL") ||
    publisher?.model ||
    persisted?.model ||
    (provider === "openai" ? "gpt-4o-mini" : "deepseek-v4-flash")
  const apiKey =
    value("WIKIBRIDGE_PUBLIC_LLM_API_KEY") ||
    value("WIKIBRIDGE_LLM_API_KEY") ||
    value("DEEPSEEK_API_KEY") ||
    value("OPENAI_API_KEY") ||
    publisher?.apiKey ||
    persisted?.api_key ||
    persisted?.apiKey ||
    ""
  const baseUrl =
    value("WIKIBRIDGE_PUBLIC_LLM_BASE_URL") ||
    value("WIKIBRIDGE_LLM_BASE_URL") ||
    publisher?.baseUrl ||
    persisted?.base_url ||
    persisted?.baseUrl ||
    ""

  if (!apiKey) {
    fail(
      "OpenCode model API key is required. Set WIKIBRIDGE_PUBLIC_LLM_API_KEY, DEEPSEEK_API_KEY, OPENAI_API_KEY, or save the desktop consumer model settings first.",
    )
  }

  return { provider: provider.trim().toLowerCase(), model: model.trim(), apiKey, baseUrl: baseUrl.trim() }
}

function readPublisherLlmSettings() {
  for (const statePath of publisherStateCandidates()) {
    try {
      if (!statePath || !existsSync(statePath)) continue
      const state = JSON.parse(readFileSync(statePath, "utf8"))
      const config = state.llmConfig
      const deepseek = state.providerConfigs?.deepseek
      const apiKey = config?.apiKey || deepseek?.apiKey || ""
      const model = config?.model || deepseek?.model || ""
      const baseUrl = config?.customEndpoint || deepseek?.baseUrl || ""
      if (!apiKey) continue
      return {
        provider: inferOpenCodeProvider(baseUrl, config?.provider || deepseek?.provider || ""),
        model,
        apiKey,
        baseUrl,
      }
    } catch {
      // Ignore malformed local publisher state; explicit env vars remain authoritative.
    }
  }
  return null
}

function readPersistedLlmSettings() {
  for (const statePath of persistedStateCandidates()) {
    try {
      if (!statePath || !existsSync(statePath)) continue
      const state = JSON.parse(readFileSync(statePath, "utf8"))
      const settings = state.llm_settings || state.llmSettings
      if (settings?.api_key || settings?.apiKey) return settings
    } catch {
      // Ignore malformed local state; the explicit env vars above are authoritative for this E2E.
    }
  }
  return null
}

function publisherStateCandidates() {
  return [
    value("WIKIBRIDGE_LLM_WIKI_STATE"),
    ...appDataDirCandidates().map((dir) => path.join(dir, "llm-wiki", "app-state.json")),
  ].filter(Boolean)
}

function persistedStateCandidates() {
  const explicit = value("WIKIBRIDGE_DESKTOP_STATE")
  const candidates = explicit ? [explicit] : []
  candidates.push(...appDataDirCandidates().map((dir) => path.join(dir, "state.json")))
  return candidates
}

function appDataDirCandidates() {
  const home = homedir()

  if (process.platform === "darwin") {
    return [
      path.join(home, "Library", "Application Support", "cn.wikibridge.desktop"),
      path.join(home, "Library", "Application Support", "WikiBridge Desktop"),
    ]
  } else if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming")
    return [path.join(appData, "cn.wikibridge.desktop"), path.join(appData, "WikiBridge Desktop")]
  }

  const dataHome = process.env.XDG_DATA_HOME || path.join(home, ".local", "share")
  return [path.join(dataHome, "cn.wikibridge.desktop"), path.join(dataHome, "WikiBridge Desktop")]
}

function inferOpenCodeProvider(baseUrl, provider) {
  const normalizedProvider = String(provider).trim().toLowerCase()
  if (normalizedProvider && normalizedProvider !== "custom") return normalizedProvider
  const normalizedBaseUrl = String(baseUrl).trim().toLowerCase()
  if (normalizedBaseUrl.includes("deepseek")) return "deepseek"
  if (normalizedBaseUrl.includes("openai")) return "openai"
  return "deepseek"
}

function openCodeConfig(settings) {
  const providerOptions = { apiKey: settings.apiKey }
  if (settings.baseUrl) {
    providerOptions.baseURL = settings.baseUrl
  } else if (settings.provider === "deepseek") {
    providerOptions.baseURL = "https://api.deepseek.com"
  }
  return {
    $schema: "https://opencode.ai/config.json",
    model: `${settings.provider}/${settings.model}`,
    provider: {
      [settings.provider]: {
        options: providerOptions,
      },
    },
  }
}

function writeKbAgentInstructions(workDir, project) {
  const content = `# WikiBridge Knowledge Base Chat

You are running inside WikiBridge visitor mode for the selected knowledge base: **${markdownInline(project.name)}**.

Rules:
- Answer the user's questions using this selected knowledge base first.
- Before answering factual questions about the knowledge base, call \`llm_wiki_search\` or \`llm_wiki_read_file\` when those tools are available.
- If search results are insufficient, say what is missing instead of inventing details.
- Keep answers concise and in the user's language.
- Current LLM Wiki project_id is \`${markdownInline(project.id)}\`.
- Do not use shell, terminal, file mutation, git, or VCS features in this mode.
`
  writeFileSync(path.join(workDir, "AGENTS.md"), content)
}

function textFromMessage(message) {
  const values = []
  collectText(message, values)
  return values.join("\n")
}

function collectText(value, values) {
  if (!value || typeof value !== "object") return
  if (value.type === "text" && typeof value.text === "string") values.push(value.text)
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, values)
    return
  }
  for (const child of Object.values(value)) collectText(child, values)
}

async function requestJson(url, init = {}) {
  const { body } = await requestJsonWithResponse(url, init)
  return body
}

async function requestJsonWithResponse(url, init = {}) {
  const response = await fetchWithRetry(url, init)
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    fail(`Expected JSON from ${url}, got: ${text.slice(0, 240)}`)
  }
  if (!response.ok) {
    fail(`HTTP ${response.status} from ${url}: ${JSON.stringify(body)}`)
  }
  return { response, body }
}

async function fetchText(url, options) {
  const response = await fetchWithRetry(url, options)
  const text = await response.text()
  if (!response.ok) fail(`${url} returned HTTP ${response.status}: ${text}`)
  return text
}

async function fetchWithRetry(url, options, attempts = 5) {
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetch(url, options)
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, attempt * 750))
    }
  }
  fail(`Fetch failed for ${url}: ${errorMessage(lastError)}`)
}

async function waitForHttp(url, label, expectedText, options) {
  const deadline = Date.now() + 45_000
  let lastError = ""
  while (Date.now() < deadline) {
    try {
      const text = await fetchText(url, options)
      if (!expectedText || text.includes(expectedText)) return
      lastError = `${label} response did not include ${expectedText}: ${text.slice(0, 240)}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  fail(`${label} did not become healthy: ${lastError}`)
}

function spawn(command, args, { cwd, env, logPath }) {
  const log = createWriteStream(logPath, { flags: "a" })
  log.write(`\n=== ${command} ${args.join(" ")} ===\n`)
  const child = spawnChild(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  })
  child.stdout.pipe(log)
  child.stderr.pipe(log)
  child.on("exit", (code, signal) => {
    log.write(`\n=== exited code=${code} signal=${signal} ===\n`)
  })
  return { process: child, log }
}

async function freePort() {
  const { createServer } = await import("node:net")
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

function sidecarBinary(group, name, platform = hostPlatformKey()) {
  return path.join(
    desktopDir,
    "src-tauri",
    "binaries",
    group,
    platform,
    executableName(platform, name),
  )
}

function apiHeaders(password) {
  return {
    Accept: "application/json",
    ...(password ? { Authorization: `Bearer ${password}`, "X-LLM-Wiki-Token": password } : {}),
  }
}

function cookieHeader(response) {
  const getSetCookie = response.headers.getSetCookie?.()
  const values = getSetCookie?.length
    ? getSetCookie
    : [response.headers.get("set-cookie")].filter(Boolean)
  return values.map((value) => value.split(";")[0]).join("; ")
}

function normalizeBackendUrl(value) {
  const trimmed = value.trim().replace(/\/+$/, "")
  assert(/^https?:\/\//i.test(trimmed), "BearFRP URL must be a complete http(s) URL")
  return trimmed
}

function normalizeBaseUrl(value) {
  const trimmed = value.trim().replace(/\/+$/, "")
  if (trimmed.endsWith("/api/v1")) return trimmed
  if (trimmed.endsWith("/api")) return `${trimmed}/v1`
  return `${trimmed}/api/v1`
}

function markdownInline(value) {
  return String(value).replace(/[`\\]/g, "\\$&")
}

function value(key) {
  return process.env[key]?.trim() || ""
}

function errorMessage(error) {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause instanceof Error ? `; cause: ${error.cause.message}` : ""
  return `${error.message}${cause}`
}

function assert(condition, message) {
  if (!condition) fail(message)
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function fail(message) {
  throw new Error(message)
}

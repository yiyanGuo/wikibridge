#!/usr/bin/env node

import { spawn as spawnChild, spawnSync } from "node:child_process"
import { createWriteStream, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { executableName, hostPlatformKey } from "./platforms.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(__dirname, "..")
const repoRoot = path.resolve(desktopDir, "..")
const bearfrpDir = path.join(repoRoot, "bearfrp")
const artifactsDir = path.join(desktopDir, "test-results", "fake-stack", timestamp())
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm"
const condaBin = process.platform === "win32" ? "conda.exe" : "conda"
const envName = process.env.BEARFRP_CONDA_ENV || "bearfrp_test"
const fakeToken = "fake-token"
const fakeChatModel = "fake-chat-model"
const fakeEmbeddingModel = "fake-embedding-model"
const children = []

mkdirSync(artifactsDir, { recursive: true })

try {
  await main()
  console.log(`Fake stack checks passed. Logs: ${path.relative(desktopDir, artifactsDir)}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  for (const child of children.reverse()) {
    child.process.kill()
    child.log.end()
  }
}

process.exit(process.exitCode ?? 0)

async function main() {
  run(npmBin, ["run", "test:conda"])
  run(npmBin, ["run", "sidecars:check"])

  const fakeLlm = await startFakeLlm()
  const fakeFrps = await startFakeFrpsAdmin()
  await waitForHttp(`${fakeLlm.baseUrl}/v1/models`, "fake LLM", fakeChatModel, {
    headers: { authorization: `Bearer ${fakeToken}` },
  })
  await waitForHttp(`${fakeFrps.baseUrl}/api/proxy/tcp`, "fake frps admin")

  await runBearfrpFakeStack(fakeFrps)
  await runSidecarFakeStack(fakeLlm)
}

async function runBearfrpFakeStack(fakeFrps) {
  const port = await freePort()
  const configDir = mkdtempSync(path.join(tmpdir(), "wikibridge-fake-bearfrp-config-"))
  const frpsDir = mkdtempSync(path.join(tmpdir(), "wikibridge-fake-frps-"))
  const backend = spawn(
    condaBin,
    [
      "run",
      "--no-capture-output",
      "-n",
      envName,
      "python",
      "-m",
      "uvicorn",
      "backend.main:app",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: bearfrpDir,
      env: {
        ...process.env,
        BACKEND_PORT: String(port),
        BEARFRPS_CONFIG_DIR: configDir,
        BEARFRPS_FRPS_DIR: frpsDir,
        BEARFRPS_START_FRPS: "0",
        FRPS_ADMIN_API_URL: fakeFrps.baseUrl,
        SERVER_PUBLIC_HOST: "127.0.0.1",
        USAGE_POLL_INTERVAL_SEC: "1",
      },
      logPath: path.join(artifactsDir, "bearfrp-backend.log"),
    },
  )
  children.push(backend)

  const baseUrl = `http://127.0.0.1:${port}`
  await waitForHttp(`${baseUrl}/`, "BearFRP backend")

  const username = `fake_stack_${Date.now()}`
  const password = "integration-secret"
  const register = await fetchJson(`${baseUrl}/api/user/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  })
  const cookie = cookieHeader(register.response)
  assert(cookie, "BearFRP register response did not set auth cookies")
  assert(register.body.uid?.startsWith("u_"), "BearFRP register response did not return a uid")

  const recharge = await fetchJson(`${baseUrl}/api/user/recharge`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: "{}",
  })
  assert(typeof recharge.body.balance_mb === "number", "BearFRP recharge did not return balance_mb")

  const tokenResponse = await fetchJson(`${baseUrl}/api/user/frpc-token`, { headers: { cookie } })
  const frpcToken = tokenResponse.body.token
  assert(
    typeof frpcToken === "string" && frpcToken.length > 8,
    "BearFRP did not return a user frpc token",
  )

  const httpSubdomain = `fake-stack-${Date.now()}`
  const httpProxy = await createBearfrpProxy(baseUrl, cookie, {
    name: "fake-http",
    proxy_type: "http",
    traffic_mb: 10,
    speed_limit_kbps: 512,
    local_ip: "127.0.0.1",
    local_port: 9080,
    subdomain: httpSubdomain,
  })
  assert(httpProxy.body.proxy.frps_name, "HTTP proxy did not expose frps_name")
  assertIncludes(httpProxy.body.frpc_config, `metadatas.token = "${frpcToken}"`, "HTTP frpc config")
  assertIncludes(httpProxy.body.frpc_config, `subdomain = "${httpSubdomain}"`, "HTTP frpc config")

  const tcpProxy = await createBearfrpProxy(baseUrl, cookie, {
    name: "fake-tcp",
    proxy_type: "tcp",
    traffic_mb: 10,
    speed_limit_kbps: 512,
    local_ip: "127.0.0.1",
    local_port: 9070,
  })
  const tcpMapping = tcpProxy.body.proxy.tcp_mappings?.[0]
  assert(tcpMapping?.frps_name, "TCP proxy did not expose a tcp mapping frps_name")
  assertIncludes(tcpProxy.body.frpc_config, `metadatas.token = "${frpcToken}"`, "TCP frpc config")
  assertIncludes(
    tcpProxy.body.frpc_config,
    `remotePort = ${tcpMapping.remote_port}`,
    "TCP frpc config",
  )

  const login = await postPlugin(baseUrl, {
    op: "Login",
    content: {
      version: "0.58.1",
      hostname: "fake-stack",
      os: process.platform,
      arch: process.arch,
      user: "",
      timestamp: 123,
      privilege_key: "",
      metas: { token: frpcToken },
    },
  })
  assert(
    login.body.reject === false && login.body.unchange === false,
    "BearFRP plugin Login was not accepted",
  )
  assert(
    login.body.content.user === register.body.uid,
    "BearFRP plugin Login did not rewrite user to uid",
  )
  assert(
    login.body.content.metas?.token_version === "1",
    "BearFRP plugin Login did not include token version",
  )
  const pluginUser = { user: login.body.content.user, metas: login.body.content.metas }

  const httpNewProxy = await postPlugin(baseUrl, {
    op: "NewProxy",
    content: {
      user: pluginUser,
      proxy_name: httpProxy.body.proxy.frps_name,
      proxy_type: "http",
      subdomain: httpSubdomain,
    },
  })
  assert(httpNewProxy.body.reject === false, "BearFRP plugin NewProxy rejected the HTTP proxy")
  assert(
    httpNewProxy.body.content.bandwidth_limit === "512KB",
    "BearFRP plugin NewProxy did not inject bandwidth_limit",
  )

  const tcpNewProxy = await postPlugin(baseUrl, {
    op: "NewProxy",
    content: {
      user: pluginUser,
      proxy_name: tcpMapping.frps_name,
      proxy_type: "tcp",
      remote_port: tcpMapping.remote_port,
    },
  })
  assert(tcpNewProxy.body.reject === false, "BearFRP plugin NewProxy rejected the TCP proxy")

  const ping = await postPlugin(baseUrl, { op: "Ping", content: { user: pluginUser } })
  assert(ping.body.reject === false, "BearFRP plugin Ping was not accepted")

  const close = await postPlugin(baseUrl, {
    op: "CloseProxy",
    content: { proxy_name: httpProxy.body.proxy.frps_name },
  })
  assert(close.body.reject === false, "BearFRP plugin CloseProxy was not accepted")

  fakeFrps.setProxy("http", {
    name: httpProxy.body.proxy.frps_name,
    status: "online",
    conf: { localPort: 9080 },
    todayTrafficIn: 1024,
    todayTrafficOut: 2048,
  })
  await waitForCondition("BearFRP poller to mark HTTP proxy online", async () => {
    const listed = await fetchJson(`${baseUrl}/api/proxies`, { headers: { cookie } })
    const proxy = listed.body.proxies.find((item) => item.id === httpProxy.body.proxy.id)
    return proxy?.is_online === true && proxy.actual_local_port === 9080
  })

  fakeFrps.setProxy("http", {
    name: httpProxy.body.proxy.frps_name,
    status: "online",
    conf: { localPort: 9080 },
    todayTrafficIn: 4096,
    todayTrafficOut: 4096,
  })
  await waitForCondition("BearFRP poller to charge fake traffic", async () => {
    const listed = await fetchJson(`${baseUrl}/api/proxies`, { headers: { cookie } })
    const proxy = listed.body.proxies.find((item) => item.id === httpProxy.body.proxy.id)
    return proxy?.traffic_used_bytes > 0 && proxy.current_speed_bps > 0
  })
}

async function createBearfrpProxy(baseUrl, cookie, payload) {
  const response = await fetchJson(`${baseUrl}/api/proxies`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  assert(response.body.proxy?.id, `BearFRP proxy "${payload.name}" did not return proxy.id`)
  assert(response.body.frpc_config, `BearFRP proxy "${payload.name}" did not return frpc_config`)
  return response
}

async function postPlugin(baseUrl, payload) {
  return await fetchJson(`${baseUrl}/frps-plugin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
}

async function runSidecarFakeStack(fakeLlm) {
  const platform = hostPlatformKey()
  const appDataDir = mkdtempSync(path.join(tmpdir(), "wikibridge-fake-sidecars-"))
  const llmDataDir = path.join(appDataDir, "llm-wiki")
  const project = createLlmWikiProjectFixture(llmDataDir, fakeLlm.baseUrl)
  const llmPort = await freePort()
  const opencodePort = await freePort()
  const llmBinary = sidecarBinary("llm-wiki-server", "llm-wiki-server", platform)
  const opencodeBinary = sidecarBinary("opencode", "opencode", platform)

  const llm = spawn(llmBinary, [], {
    cwd: appDataDir,
    env: {
      ...process.env,
      LLM_WIKI_DATA_DIR: llmDataDir,
      LLM_WIKI_BIND: "127.0.0.1",
      LLM_WIKI_PORT: String(llmPort),
    },
    logPath: path.join(artifactsDir, "llm-wiki-server.log"),
  })
  children.push(llm)
  const llmBaseUrl = `http://127.0.0.1:${llmPort}/api/v1`
  await waitForHttp(`${llmBaseUrl}/health`, "LLM Wiki sidecar", '"ok":true')

  await assertLlmWikiApi(llmBaseUrl, project, fakeLlm)

  const opencodeDataDir = path.join(appDataDir, "opencode-data")
  const opencodeWorkDir = path.join(appDataDir, "opencode-workspace")
  mkdirSync(path.join(opencodeDataDir, "users", "default"), { recursive: true })
  mkdirSync(path.join(opencodeDataDir, "wiki"), { recursive: true })
  mkdirSync(opencodeWorkDir, { recursive: true })

  const opencode = spawn(
    opencodeBinary,
    ["serve", "--hostname", "127.0.0.1", "--port", String(opencodePort)],
    {
      cwd: opencodeWorkDir,
      env: {
        ...process.env,
        OPENCODE_KB_MODE: "1",
        OPENCODE_KB_DATA_DIR: opencodeDataDir,
        OPENCODE_KB_USER: "default",
        LLM_WIKI_BASE_URL: llmBaseUrl,
      },
      logPath: path.join(artifactsDir, "opencode.log"),
    },
  )
  children.push(opencode)
  const opencodeBaseUrl = `http://127.0.0.1:${opencodePort}`
  await waitForHttp(`${opencodeBaseUrl}/global/health`, "OpenCode sidecar", '"healthy":true')
  await assertOpenCodeLlmWikiProxy(opencodeBaseUrl, project)
}

function createLlmWikiProjectFixture(llmDataDir, fakeLlmBaseUrl) {
  const projectId = "fake-stack-project"
  const projectName = "Fake Stack Project"
  const projectDir = path.join(llmDataDir, "projects", projectId)
  mkdirSync(path.join(projectDir, ".llm-wiki"), { recursive: true })
  mkdirSync(path.join(projectDir, "wiki"), { recursive: true })
  mkdirSync(path.join(projectDir, "raw", "sources"), { recursive: true })

  writeFileSync(
    path.join(projectDir, ".llm-wiki", "project.json"),
    JSON.stringify({ id: projectId, name: projectName }, null, 2),
  )
  writeFileSync(
    path.join(projectDir, ".llm-wiki", "review.json"),
    JSON.stringify(
      [
        {
          id: "review-1",
          type: "source",
          title: "Fake review",
          description: "Fixture review item",
          sourcePath: "raw/sources/source.md",
          options: [{ label: "Keep", action: "keep" }],
          resolved: false,
          createdAt: 1,
        },
      ],
      null,
      2,
    ),
  )
  writeFileSync(
    path.join(projectDir, "purpose.md"),
    "# Fake Stack Purpose\n\nThis project verifies fake-stack system tests.\n",
  )
  writeFileSync(
    path.join(projectDir, "wiki", "index.md"),
    "# Fake Stack Index\n\nThis page links to [[graph]] and mentions contract testing.\n",
  )
  writeFileSync(
    path.join(projectDir, "wiki", "graph.md"),
    "# Graph Node\n\nBacklink to [[index]] for graph coverage.\n",
  )
  writeFileSync(
    path.join(projectDir, "raw", "sources", "source.md"),
    "# Source\n\nA local source document for the fake stack fixture.\n",
  )
  mkdirSync(llmDataDir, { recursive: true })
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
          allowUnauthenticated: true,
          mcpEnabled: false,
          token: "",
        },
        llmConfig: {
          provider: "custom",
          apiKey: fakeToken,
          model: fakeChatModel,
          customEndpoint: `${fakeLlmBaseUrl}/v1`,
          apiMode: "chat_completions",
        },
        embeddingConfig: {
          enabled: true,
          endpoint: `${fakeLlmBaseUrl}/v1/embeddings`,
          apiKey: fakeToken,
          model: fakeEmbeddingModel,
        },
      },
      null,
      2,
    ),
  )
  return { id: projectId, name: projectName, path: projectDir }
}

async function assertLlmWikiApi(baseUrl, project, fakeLlm) {
  const health = await fetchJson(`${baseUrl}/health`)
  assert(
    health.body.ok === true && health.body.allowUnauthenticated === true,
    "llm-wiki health did not expose unauthenticated local API",
  )

  const projects = await fetchJson(`${baseUrl}/projects`)
  assert(
    projects.body.projects.some((item) => item.id === project.id),
    "llm-wiki projects did not include the fixture project",
  )

  const files = await fetchJson(
    `${baseUrl}/projects/${encodeURIComponent(project.id)}/files?root=wiki&recursive=true`,
  )
  assert(
    findFile(files.body.files, "wiki/index.md"),
    "llm-wiki files did not include wiki/index.md",
  )

  const content = await fetchJson(
    `${baseUrl}/projects/${encodeURIComponent(project.id)}/files/content?path=${encodeURIComponent("wiki/index.md")}`,
  )
  assertIncludes(content.body.content, "contract testing", "llm-wiki file content")

  const search = await fetchJson(`${baseUrl}/projects/${encodeURIComponent(project.id)}/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "contract testing", topK: 5, includeContent: true }),
  })
  assert(
    search.body.results.some((item) => item.path === "wiki/index.md"),
    "llm-wiki search did not find wiki/index.md",
  )
  assert(
    fakeLlm.requests.some((request) => request.kind === "embedding"),
    "llm-wiki search did not call the fake embedding API",
  )

  const graph = await fetchJson(
    `${baseUrl}/projects/${encodeURIComponent(project.id)}/graph?limit=20`,
  )
  assert(
    graph.body.nodes.some((node) => node.path === "wiki/index.md"),
    "llm-wiki graph did not include wiki/index.md",
  )
}

async function assertOpenCodeLlmWikiProxy(baseUrl, project) {
  const health = await fetchJson(`${baseUrl}/instance/llm-wiki/health`)
  assert(health.body.ok === true, "OpenCode llm-wiki health proxy did not return ok")

  const projects = await fetchJson(`${baseUrl}/instance/llm-wiki/projects`)
  assert(
    projects.body.projects.some((item) => item.id === project.id),
    "OpenCode llm-wiki projects proxy did not include fixture project",
  )

  const files = await fetchJson(
    `${baseUrl}/instance/llm-wiki/projects/${encodeURIComponent(project.id)}/files?root=wiki&recursive=true`,
  )
  assert(
    findFile(files.body.files, "wiki/index.md"),
    "OpenCode llm-wiki files proxy did not include wiki/index.md",
  )

  const content = await fetchJson(
    `${baseUrl}/instance/llm-wiki/projects/${encodeURIComponent(project.id)}/files/content?path=${encodeURIComponent("wiki/index.md")}`,
  )
  assertIncludes(content.body.content, "contract testing", "OpenCode llm-wiki file content proxy")

  const search = await fetchJson(
    `${baseUrl}/instance/llm-wiki/projects/${encodeURIComponent(project.id)}/search`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "contract testing", topK: 5, includeContent: true }),
    },
  )
  assert(
    search.body.results.some((item) => item.path === "wiki/index.md"),
    "OpenCode llm-wiki search proxy did not find wiki/index.md",
  )

  const graph = await fetchJson(
    `${baseUrl}/instance/llm-wiki/projects/${encodeURIComponent(project.id)}/graph?limit=20`,
  )
  assert(
    graph.body.nodes.some((node) => node.path === "wiki/index.md"),
    "OpenCode llm-wiki graph proxy did not include wiki/index.md",
  )
}

async function startFakeLlm() {
  const port = await freePort()
  const requests = []
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`)
      if (url.pathname === "/v1/models" && req.method === "GET") {
        assertBearer(req)
        return sendJson(res, 200, {
          object: "list",
          data: [
            { id: fakeChatModel, object: "model", owned_by: "fake-stack" },
            { id: fakeEmbeddingModel, object: "model", owned_by: "fake-stack" },
          ],
        })
      }
      if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
        assertBearer(req)
        const body = await readJson(req)
        requests.push({ kind: "chat", body })
        if (body.model !== fakeChatModel)
          return sendJson(res, 404, { error: { message: "unknown model" } })
        if (!Array.isArray(body.messages))
          return sendJson(res, 400, { error: { message: "messages must be an array" } })
        if (body.stream) return sendChatStream(res)
        return sendJson(res, 200, {
          id: "chatcmpl-fake-stack",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "fake-stack-ok" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      }
      if (url.pathname === "/v1/embeddings" && req.method === "POST") {
        assertBearer(req)
        const body = await readJson(req)
        requests.push({ kind: "embedding", body })
        if (body.model !== fakeEmbeddingModel)
          return sendJson(res, 404, { error: { message: "unknown model" } })
        if (typeof body.input !== "string" && !Array.isArray(body.input)) {
          return sendJson(res, 400, { error: { message: "input must be a string or array" } })
        }
        return sendJson(res, 200, {
          object: "list",
          data: [{ object: "embedding", index: 0, embedding: deterministicEmbedding(body.input) }],
          model: body.model,
          usage: { prompt_tokens: 1, total_tokens: 1 },
        })
      }
      return sendJson(res, 404, {
        error: { message: `No fake LLM route for ${req.method} ${url.pathname}` },
      })
    } catch (error) {
      return sendJson(res, error.statusCode ?? 500, { error: { message: error.message } })
    } finally {
      writeFileSync(
        path.join(artifactsDir, "fake-llm-requests.json"),
        JSON.stringify(requests, null, 2),
      )
    }
  })
  await listen(server, port)
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function startFakeFrpsAdmin() {
  const port = await freePort()
  const state = {
    proxies: {
      tcp: [],
      http: [],
      stcp: [],
      xtcp: [],
    },
    trafficByName: new Map(),
    deletedOffline: false,
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`)
    if (req.method === "GET" && url.pathname.startsWith("/api/proxy/")) {
      const kind = url.pathname.split("/").at(-1)
      return sendJson(res, 200, { proxies: state.proxies[kind] ?? [] })
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/traffic/")) {
      const name = decodeURIComponent(url.pathname.slice("/api/traffic/".length))
      const traffic = state.trafficByName.get(name) ?? { traffic_in: 0, traffic_out: 0 }
      return sendJson(res, 200, {
        name,
        todayTrafficIn: traffic.traffic_in,
        todayTrafficOut: traffic.traffic_out,
        curConns: 1,
      })
    }
    if (req.method === "DELETE" && url.pathname === "/api/proxies") {
      state.deletedOffline = url.searchParams.get("status") === "offline"
      return sendJson(res, 200, { ok: true })
    }
    return sendJson(res, 404, {
      error: `No fake frps admin route for ${req.method} ${url.pathname}`,
    })
  })
  await listen(server, port)
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    state,
    setProxy(kind, proxy) {
      state.proxies[kind] = [proxy]
      state.trafficByName.set(proxy.name, {
        traffic_in: proxy.todayTrafficIn ?? 0,
        traffic_out: proxy.todayTrafficOut ?? 0,
      })
    },
    clearProxy(kind) {
      state.proxies[kind] = []
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

function assertBearer(req) {
  const expected = `Bearer ${fakeToken}`
  if (req.headers.authorization !== expected) {
    const error = new Error("missing or invalid bearer token")
    error.statusCode = 401
    throw error
  }
}

function deterministicEmbedding(input) {
  const text = Array.isArray(input) ? input.join("\n") : String(input)
  let seed = 0
  for (const char of text) seed = (seed + char.charCodeAt(0)) % 97
  return Array.from({ length: 8 }, (_, index) =>
    Number((((seed + index + 1) % 17) / 17).toFixed(6)),
  )
}

function sendChatStream(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  })
  res.write(
    `data: ${JSON.stringify({ choices: [{ delta: { content: "fake-stack-ok" }, index: 0 }] })}\n\n`,
  )
  res.write("data: [DONE]\n\n")
  res.end()
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString("utf8")
  return text ? JSON.parse(text) : {}
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", resolve)
  })
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: desktopDir,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  })
  if (result.error) fail(`Failed to run ${command}: ${result.error.message}`)
  if (result.status !== 0) process.exit(result.status ?? 1)
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
  const closed = new Promise((resolve) => {
    child.once("close", resolve)
  })
  return { process: child, log, closed }
}

async function fetchText(url, options) {
  const response = await fetch(url, options)
  const text = await response.text()
  if (!response.ok) fail(`${url} returned HTTP ${response.status}: ${text}`)
  return text
}

async function fetchJson(url, options) {
  const response = await fetch(url, options)
  const text = await response.text()
  if (!response.ok) fail(`${url} returned HTTP ${response.status}: ${text}`)
  return { response, body: text ? JSON.parse(text) : null }
}

async function waitForHttp(url, label, expectedText, options) {
  const deadline = Date.now() + 30_000
  let lastError = ""
  while (Date.now() < deadline) {
    try {
      const text = await fetchText(url, options)
      if (!expectedText || text.includes(expectedText)) return
      lastError = `${label} response did not include ${expectedText}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  fail(`${label} did not become healthy: ${lastError}`)
}

async function waitForCondition(label, predicate) {
  const deadline = Date.now() + 30_000
  let lastError = ""
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  fail(`${label} timed out${lastError ? `: ${lastError}` : ""}`)
}

async function freePort() {
  const { createServer: createNetServer } = await import("node:net")
  return await new Promise((resolve, reject) => {
    const server = createNetServer()
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

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function cookieHeader(response) {
  const getSetCookie = response.headers.getSetCookie?.()
  const values = getSetCookie?.length
    ? getSetCookie
    : [response.headers.get("set-cookie")].filter(Boolean)
  return values.map((value) => value.split(";")[0]).join("; ")
}

function findFile(files, expectedPath) {
  for (const file of files ?? []) {
    if (file.path === expectedPath) return file
    const child = findFile(file.children, expectedPath)
    if (child) return child
  }
  return null
}

function assertIncludes(text, expected, label) {
  if (!String(text).includes(expected)) fail(`${label} did not include ${expected}`)
}

function assert(condition, message) {
  if (!condition) fail(message)
}

function fail(message) {
  throw new Error(message)
}

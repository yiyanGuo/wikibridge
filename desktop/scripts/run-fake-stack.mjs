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
        if (body.model !== fakeChatModel) return sendJson(res, 404, { error: { message: "unknown model" } })
        if (!Array.isArray(body.messages)) return sendJson(res, 400, { error: { message: "messages must be an array" } })
        if (body.stream) return sendChatStream(res)
        return sendJson(res, 200, {
          id: "chatcmpl-fake-stack",
          object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content: "fake-stack-ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      }
      if (url.pathname === "/v1/embeddings" && req.method === "POST") {
        assertBearer(req)
        const body = await readJson(req)
        requests.push({ kind: "embedding", body })
        if (body.model !== fakeEmbeddingModel) return sendJson(res, 404, { error: { message: "unknown model" } })
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
      return sendJson(res, 404, { error: { message: `No fake LLM route for ${req.method} ${url.pathname}` } })
    } catch (error) {
      return sendJson(res, error.statusCode ?? 500, { error: { message: error.message } })
    } finally {
      writeFileSync(path.join(artifactsDir, "fake-llm-requests.json"), JSON.stringify(requests, null, 2))
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
    return sendJson(res, 404, { error: `No fake frps admin route for ${req.method} ${url.pathname}` })
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
  return Array.from({ length: 8 }, (_, index) => Number((((seed + index + 1) % 17) / 17).toFixed(6)))
}

function sendChatStream(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  })
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "fake-stack-ok" }, index: 0 }] })}\n\n`)
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
  return path.join(desktopDir, "src-tauri", "binaries", group, platform, executableName(platform, name))
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function fail(message) {
  throw new Error(message)
}

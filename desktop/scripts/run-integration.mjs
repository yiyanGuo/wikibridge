#!/usr/bin/env node

import { spawn as spawnChild, spawnSync } from "node:child_process"
import { createWriteStream, mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { executableName, hostPlatformKey } from "./platforms.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(__dirname, "..")
const repoRoot = path.resolve(desktopDir, "..")
const bearfrpDir = path.join(repoRoot, "bearfrp")
const artifactsDir = path.join(desktopDir, "test-results", "integration", timestamp())
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm"
const condaBin = process.platform === "win32" ? "conda.exe" : "conda"
const envName = process.env.BEARFRP_CONDA_ENV || "bearfrp_test"
const children = []

run(npmBin, ["run", "test:conda"])
run(npmBin, ["run", "sidecars:check"])

mkdirSync(artifactsDir, { recursive: true })

try {
  await runBearfrpSmoke()
  await runSidecarSmoke()
  console.log(`Desktop integration checks passed. Logs: ${path.relative(desktopDir, artifactsDir)}`)
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

async function runBearfrpSmoke() {
  const port = await freePort()
  const configDir = mkdtempSync(path.join(tmpdir(), "wikibridge-bearfrp-config-"))
  const frpsDir = mkdtempSync(path.join(tmpdir(), "wikibridge-frps-"))
  const logPath = path.join(artifactsDir, "bearfrp-backend.log")
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
        SERVER_PUBLIC_HOST: "127.0.0.1",
        USAGE_POLL_INTERVAL_SEC: "3600",
      },
      logPath,
    },
  )
  children.push(backend)
  const baseUrl = `http://127.0.0.1:${port}`
  await waitForHttp(`${baseUrl}/`, "BearFRP backend")

  const userPage = await fetchText(`${baseUrl}/user`)
  assertIncludes(userPage, "BearFRPs", "/user page")

  const username = `ci_${Date.now()}`
  const password = "integration-secret"
  const register = await fetchJson(`${baseUrl}/api/user/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  })
  const cookie = cookieHeader(register.response)
  if (!cookie) fail("BearFRP register response did not set auth cookies")
  if (register.body.username !== username) fail("BearFRP register response returned the wrong user")

  const me = await fetchJson(`${baseUrl}/api/user/me`, {
    headers: { cookie },
  })
  if (me.body.username !== username) fail("BearFRP /api/user/me did not return the registered user")

  const recharge = await fetchJson(`${baseUrl}/api/user/recharge`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: "{}",
  })
  if (typeof recharge.body.balance_mb !== "number") fail("BearFRP recharge did not return balance_mb")

  const proxy = await fetchJson(`${baseUrl}/api/proxies`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      name: "desktop-ci",
      proxy_type: "http",
      traffic_mb: 10,
      speed_limit_kbps: 1024,
      local_ip: "127.0.0.1",
      local_port: 9527,
      subdomain: `desktop-ci-${Date.now()}`,
    }),
  })
  if (!proxy.body.proxy?.id || !proxy.body.frpc_config) {
    fail("BearFRP proxy creation did not return proxy id and frpc config")
  }
}

async function runSidecarSmoke() {
  const platform = hostPlatformKey()
  const appDataDir = mkdtempSync(path.join(tmpdir(), "wikibridge-sidecars-"))
  const llmPort = await freePort()
  const opencodePort = await freePort()
  const llmBinary = sidecarBinary("llm-wiki-server", "llm-wiki-server", platform)
  const opencodeBinary = sidecarBinary("opencode", "opencode", platform)

  const llm = spawn(llmBinary, [], {
    cwd: appDataDir,
    env: {
      ...process.env,
      LLM_WIKI_DATA_DIR: path.join(appDataDir, "llm-wiki"),
      LLM_WIKI_BIND: "127.0.0.1",
      LLM_WIKI_PORT: String(llmPort),
    },
    logPath: path.join(artifactsDir, "llm-wiki-server.log"),
  })
  children.push(llm)
  await waitForHttp(`http://127.0.0.1:${llmPort}/api/v1/health`, "LLM Wiki sidecar")

  const opencodeDataDir = path.join(appDataDir, "opencode-data")
  const opencodeWorkDir = path.join(appDataDir, "opencode-workspace")
  mkdirSync(path.join(opencodeDataDir, "users", "default"), { recursive: true })
  mkdirSync(path.join(opencodeDataDir, "wiki"), { recursive: true })
  mkdirSync(opencodeWorkDir, { recursive: true })
  const opencode = spawn(opencodeBinary, ["serve", "--hostname", "127.0.0.1", "--port", String(opencodePort)], {
    cwd: opencodeWorkDir,
    env: {
      ...process.env,
      OPENCODE_KB_MODE: "1",
      OPENCODE_KB_DATA_DIR: opencodeDataDir,
      OPENCODE_KB_USER: "default",
      LLM_WIKI_BASE_URL: `http://127.0.0.1:${llmPort}/api/v1`,
    },
    logPath: path.join(artifactsDir, "opencode.log"),
  })
  children.push(opencode)
  await waitForHttp(`http://127.0.0.1:${opencodePort}/global/health`, "OpenCode sidecar", "\"healthy\":true")
}

function sidecarBinary(group, name, platform) {
  return path.join(desktopDir, "src-tauri", "binaries", group, platform, executableName(platform, name))
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: desktopDir,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  })
  if (result.error) {
    console.error(`Failed to run ${command}: ${result.error.message}`)
    process.exit(1)
  }
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

async function waitForHttp(url, label, expectedText) {
  const deadline = Date.now() + 30_000
  let lastError = ""
  while (Date.now() < deadline) {
    try {
      const text = await fetchText(url)
      if (!expectedText || text.includes(expectedText)) return
      lastError = `${label} response did not include ${expectedText}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  fail(`${label} did not become healthy: ${lastError}`)
}

function cookieHeader(response) {
  const getSetCookie = response.headers.getSetCookie?.()
  const values = getSetCookie?.length ? getSetCookie : [response.headers.get("set-cookie")].filter(Boolean)
  return values.map((value) => value.split(";")[0]).join("; ")
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

function assertIncludes(text, expected, label) {
  if (!text.includes(expected)) fail(`${label} did not include ${expected}`)
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function fail(message) {
  throw new Error(message)
}

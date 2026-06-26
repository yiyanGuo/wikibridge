#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")

const options = parseArgs(process.argv.slice(2))
const projectId = resolveProjectId(options)
const startedAt = Date.now()
const results = []

const taskDefinitions = [
  {
    id: "T-01",
    name: "deployment and startup",
    whitebox: [
      commandStep("Docker Compose config is valid", "docker", ["compose", "config", "--quiet"], {
        requiredBinary: "docker",
      }),
    ],
    blackbox: [
      httpCheck("nginx OpenCode entry", `${options.baseUrl}/global/health`, {
        expectStatus: 200,
        expectJson: (body) => body && body.healthy === true,
      }),
      httpCheck("nginx LLM Wiki bridge health", `${options.baseUrl}/instance/llm-wiki/health`, {
        expectStatus: 200,
        expectJson: (body) => body && (body.ok === true || body.healthy === true),
      }),
      httpCheck("BearFRP online API", `${options.bearfrpUrl}/api/show/online`, {
        expectStatus: 200,
        expectJson: (body) => body && typeof body === "object",
      }),
    ],
  },
  {
    id: "T-02",
    name: "LLM Wiki API",
    whitebox: [
      commandStep("llm_wiki mocked tests", "npm", ["run", "test:mocks"], {
        cwd: "llm_wiki",
        requiredPath: "llm_wiki/node_modules",
      }),
      commandStep("LLM Wiki MCP tests", "npm", ["run", "mcp:test"], { cwd: "llm_wiki" }),
    ],
    blackbox: [
      httpCheck("LLM Wiki health", `${options.llmWikiUrl}/health`, {
        expectStatus: 200,
        expectJson: (body) => body && body.ok === true,
      }),
      httpCheck("LLM Wiki projects", `${options.llmWikiUrl}/projects`, {
        expectStatus: 200,
        expectJson: (body) => Array.isArray(body?.projects),
      }),
      projectHttpCheck("LLM Wiki project files", `${options.llmWikiUrl}/projects/${encodeURIComponent(projectId || options.projectId)}/files`, {
        expectStatus: 200,
        expectJson: (body) => body && (Array.isArray(body.files) || Array.isArray(body.items)),
      }),
      projectHttpCheck("LLM Wiki search", `${options.llmWikiUrl}/projects/${encodeURIComponent(projectId || options.projectId)}/search`, {
        method: "POST",
        json: { query: options.searchQuery },
        expectStatus: 200,
        expectJson: (body) => body && (Array.isArray(body.results) || Array.isArray(body.items)),
      }),
      projectHttpCheck("LLM Wiki graph", `${options.llmWikiUrl}/projects/${encodeURIComponent(projectId || options.projectId)}/graph`, {
        expectStatus: 200,
        expectJson: (body) => body && (Array.isArray(body.nodes) || typeof body.graph === "object"),
      }),
    ],
  },
  {
    id: "T-03",
    name: "OpenCode KB permissions",
    whitebox: [
      commandStep("OpenCode KB guard tests", "bun", ["test", "test/kb/guard.test.ts", "test/kb/server.test.ts"], {
        cwd: "opencode/packages/opencode",
        requiredBinary: "bun",
      }),
    ],
    blackbox: [
      httpCheck("OpenCode KB public health", `${options.baseUrl}/global/health`, {
        expectStatus: 200,
        expectJson: (body) => body && body.healthy === true,
      }),
      httpCheck("OpenCode KB blocks VCS in KB mode", `${options.baseUrl}/vcs?directory=..%2F`, {
        expectStatus: 403,
      }),
      httpCheck("OpenCode KB blocks VCS diff in KB mode", `${options.baseUrl}/vcs/diff?directory=..%2F&mode=git`, {
        expectStatus: 403,
      }),
    ],
  },
  {
    id: "T-04",
    name: "BearFRP users and proxies",
    whitebox: [
      commandStep("BearFRP pytest API coverage", pythonCommand(), ["-m", "pytest", "-q", "tests/test_api.py"], {
        cwd: "bearfrp",
      }),
    ],
  },
  {
    id: "T-05",
    name: "frps plugin authorization",
    whitebox: [
      commandStep("BearFRP plugin and poller tests", pythonCommand(), ["-m", "pytest", "-q", "tests/test_plugin_and_poller.py"], {
        cwd: "bearfrp",
      }),
    ],
  },
  {
    id: "T-06",
    name: "auto-publish sidecar",
    whitebox: [
      commandStep("sidecar Python syntax", pythonCommand(), [
        "-c",
        "import ast, pathlib; ast.parse(pathlib.Path('docker/bearfrp-wikibridge-frpc/start.py').read_text(encoding='utf-8'))",
      ]),
      commandStep("sidecar image build", "docker", ["compose", "build", "bearfrp-wikibridge-frpc"], {
        optional: true,
        runWhen: () => options.docker,
      }),
    ],
  },
  {
    id: "T-07",
    name: "end-to-end access",
    blackbox: [
      httpCheck("OpenCode page advertises KB mode", `${options.baseUrl}/`, {
        expectStatus: 200,
        expectText: "opencode-kb-mode",
      }),
      httpCheck("bridge project list", `${options.baseUrl}/instance/llm-wiki/projects`, {
        expectStatus: 200,
        expectJson: (body) => Array.isArray(body?.projects),
      }),
      projectHttpCheck("bridge project files", `${options.baseUrl}/instance/llm-wiki/projects/${encodeURIComponent(projectId || options.projectId)}/files`, {
        expectStatus: 200,
        expectJson: (body) => body && (Array.isArray(body.files) || Array.isArray(body.items)),
      }),
    ],
  },
  {
    id: "T-08",
    name: "exception and security boundaries",
    whitebox: [
      commandStep("BearFRP pytest security/error coverage", pythonCommand(), ["-m", "pytest", "-q", "tests/test_api.py", "tests/test_plugin_and_poller.py"], {
        cwd: "bearfrp",
      }),
    ],
    blackbox: [
      httpCheck("unknown BearFRP path returns 404", `${options.bearfrpUrl}/__not_found__`, {
        expectStatus: 404,
      }),
      httpCheck("BearFRP user endpoint requires auth", `${options.bearfrpUrl}/api/user/me`, {
        expectStatus: 401,
      }),
      httpCheck("LLM Wiki rejects oversized body", `${options.llmWikiUrl}/projects/${encodeURIComponent(projectId || options.projectId)}/search`, {
        method: "POST",
        body: JSON.stringify({ query: "x".repeat(1024 * 1024 + 1) }),
        headers: { "content-type": "application/json" },
        expectStatus: [400, 413, 503],
        expectText: "Request body too large",
      }),
    ],
  },
  {
    id: "T-09",
    name: "desktop knowledge-base loop",
    whitebox: [
      commandStep("desktop mocked system tests", "npm", ["run", "test:system"], {
        cwd: "desktop",
        requiredNode: "20.19.0",
      }),
      commandStep("desktop Rust contract tests", "npm", ["run", "test:contracts"], {
        cwd: "desktop",
        skipWhenProcessContains: "desktop/src-tauri/target/debug/binaries/",
      }),
    ],
  },
]

for (const task of taskDefinitions) {
  if (!options.tasks.has(task.id)) continue
  console.log(`\n${task.id} ${task.name}`)
  let ran = 0

  if (options.whitebox) {
    for (const step of task.whitebox ?? []) {
      ran += 1
      runStep(task.id, step)
    }
  }

  if (options.blackbox) {
    for (const step of task.blackbox ?? []) {
      ran += 1
      runStep(task.id, step)
    }
  }

  if (ran === 0) {
    record(task.id, "skip", "no checks selected for this task")
  }
}

printSummary()

const failed = results.filter((result) => result.status === "fail")
if (failed.length > 0) {
  process.exit(1)
}

function runStep(taskId, stepFactory) {
  const step = stepFactory()
  if (step.status === "skip") {
    record(taskId, "skip", step.name, step.detail)
    return
  }
  if (step.status === "pass") {
    record(taskId, "pass", step.name, step.detail)
    return
  }
  record(taskId, "fail", step.name, step.detail)
}

function commandStep(name, command, args, config = {}) {
  return () => {
    if (config.runWhen && !config.runWhen()) {
      return { name, status: "skip", detail: "disabled by CLI options" }
    }
    if (config.requiredBinary && !hasCommand(config.requiredBinary)) {
      return { name, status: "skip", detail: `missing required binary: ${config.requiredBinary}` }
    }
    if (!hasCommand(command)) {
      return { name, status: "skip", detail: `missing command: ${command}` }
    }
    if (config.requiredNode && !nodeAtLeast(config.requiredNode)) {
      return {
        name,
        status: "skip",
        detail: `Node ${process.versions.node} is below required ${config.requiredNode}`,
      }
    }
    if (config.requiredPath && !existsSync(resolve(repoRoot, config.requiredPath))) {
      return { name, status: "skip", detail: `missing path: ${config.requiredPath}` }
    }
    if (config.skipWhenProcessContains && processListIncludes(config.skipWhenProcessContains)) {
      return {
        name,
        status: "skip",
        detail: `running process uses ${config.skipWhenProcessContains}`,
      }
    }

    const cwd = resolve(repoRoot, config.cwd ?? ".")
    const result = spawnSync(command, args, {
      cwd,
      env: { ...process.env, CI: process.env.CI ?? "1" },
      stdio: "inherit",
      shell: false,
    })

    if (result.error) {
      const status = config.optional ? "skip" : "fail"
      return { name, status, detail: result.error.message }
    }
    if (result.status !== 0) {
      const status = config.optional ? "skip" : "fail"
      return { name, status, detail: `exit code ${result.status}` }
    }
    return { name, status: "pass" }
  }
}

function httpCheck(name, url, config) {
  return () => {
    const curl = curlJson(url, config)
    if (curl.exitCode !== 0) {
      return { name, status: "fail", detail: curl.error || `curl exited ${curl.exitCode}` }
    }
    const { status, body, text } = curl
    const expectedStatuses = Array.isArray(config.expectStatus) ? config.expectStatus : [config.expectStatus]
    if (!expectedStatuses.includes(status)) {
      return { name, status: "fail", detail: `HTTP ${status}, expected ${expectedStatuses.join(" or ")}: ${text.slice(0, 300)}` }
    }
    if (config.expectText && !text.includes(config.expectText)) {
      return { name, status: "fail", detail: `missing text ${JSON.stringify(config.expectText)}` }
    }
    if (config.expectJson) {
      if (body === undefined) {
        return { name, status: "fail", detail: `response is not JSON: ${text.slice(0, 300)}` }
      }
      if (!config.expectJson(body)) {
        return { name, status: "fail", detail: `unexpected JSON: ${JSON.stringify(body).slice(0, 300)}` }
      }
    }
    return { name, status: "pass", detail: `HTTP ${status}` }
  }
}

function projectHttpCheck(name, url, config) {
  return () => {
    if (!projectId) {
      return { name, status: "skip", detail: "no LLM Wiki project is available" }
    }
    return httpCheck(name, url, config)()
  }
}

function resolveProjectId(opts) {
  if (!opts.blackbox) return opts.projectId
  if (opts.projectExplicit) return opts.projectId
  const response = curlJson(`${opts.llmWikiUrl}/projects`, { expectStatus: 200 })
  if (response.exitCode !== 0 || response.status !== 200 || response.body === undefined) {
    return opts.projectId
  }
  const projects = Array.isArray(response.body.projects) ? response.body.projects : []
  const currentProject = response.body.currentProject
  if (typeof currentProject?.id === "string") return currentProject.id
  if (typeof currentProject === "string") return currentProject
  const current = projects.find((project) => project && project.current && typeof project.id === "string")
  if (current) return current.id
  const defaultProject = projects.find((project) => project && project.id === "default")
  if (defaultProject) return defaultProject.id
  const first = projects.find((project) => project && typeof project.id === "string")
  return first?.id ?? null
}

function curlJson(url, config) {
  const args = ["-sS", "-L", "--max-time", String(options.httpTimeout), "-w", "\n%{http_code}", "-X", config.method ?? "GET"]
  let input
  for (const [key, value] of Object.entries(config.headers ?? {})) {
    args.push("-H", `${key}: ${value}`)
  }
  if (options.llmWikiToken && url.startsWith(options.llmWikiUrl)) {
    args.push("-H", `Authorization: Bearer ${options.llmWikiToken}`)
    args.push("-H", `X-LLM-Wiki-Token: ${options.llmWikiToken}`)
  }
  if (config.json !== undefined) {
    args.push("-H", "content-type: application/json", "--data-binary", JSON.stringify(config.json))
  } else if (config.body !== undefined) {
    args.push("--data-binary", "@-")
    input = config.body
  }
  args.push(url)

  const result = spawnSync("curl", args, {
    cwd: repoRoot,
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  })
  if (result.error) {
    return { exitCode: result.status ?? 1, status: 0, error: result.error.message }
  }
  const output = result.stdout ?? ""
  const splitAt = output.lastIndexOf("\n")
  const text = splitAt >= 0 ? output.slice(0, splitAt) : output
  const httpStatus = Number(splitAt >= 0 ? output.slice(splitAt + 1).trim() : "0")
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = undefined
  }
  return {
    exitCode: result.status ?? 0,
    status: result.status === 0 ? httpStatus : result.status,
    body,
    text,
    error: result.stderr?.trim(),
  }
}

function record(taskId, status, name, detail = "") {
  const marker = status === "pass" ? "PASS" : status === "skip" ? "SKIP" : "FAIL"
  const suffix = detail ? ` - ${detail}` : ""
  console.log(`  [${marker}] ${name}${suffix}`)
  results.push({ taskId, status, name, detail })
}

function printSummary() {
  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  const passed = results.filter((result) => result.status === "pass").length
  const skipped = results.filter((result) => result.status === "skip").length
  const failed = results.filter((result) => result.status === "fail").length
  console.log(`\nSummary: ${passed} passed, ${skipped} skipped, ${failed} failed in ${elapsedSeconds}s.`)
}

function parseArgs(rawArgs) {
  const allTaskIds = new Set(["T-01", "T-02", "T-03", "T-04", "T-05", "T-06", "T-07", "T-08", "T-09"])
  const selectedTasks = new Set(allTaskIds)
  let whitebox = true
  let blackbox = false
  let docker = false
  let baseUrl = process.env.WIKIBRIDGE_BASE_URL ?? "http://127.0.0.1"
  let llmWikiUrl = process.env.LLM_WIKI_API_URL
  let llmWikiUrlExplicit = Boolean(process.env.LLM_WIKI_API_URL)
  let bearfrpUrl = process.env.BEARFRP_API_URL ?? "http://127.0.0.1:8000"
  let projectId = process.env.WIKIBRIDGE_TEST_PROJECT ?? "current"
  let projectExplicit = Boolean(process.env.WIKIBRIDGE_TEST_PROJECT)
  let searchQuery = process.env.WIKIBRIDGE_TEST_QUERY ?? "example"
  let httpTimeout = Number(process.env.WIKIBRIDGE_HTTP_TIMEOUT ?? "10")
  let llmWikiToken = process.env.LLM_WIKI_TOKEN ?? ""

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]
    if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    }
    if (arg === "--whitebox") {
      whitebox = true
      continue
    }
    if (arg === "--no-whitebox") {
      whitebox = false
      continue
    }
    if (arg === "--blackbox") {
      blackbox = true
      continue
    }
    if (arg === "--docker") {
      docker = true
      continue
    }
    if (arg === "--task") {
      const value = requireValue(rawArgs, index, arg)
      index += 1
      selectedTasks.clear()
      for (const taskId of value.split(",")) {
        addTask(selectedTasks, allTaskIds, taskId)
      }
      continue
    }
    if (arg.startsWith("--task=")) {
      selectedTasks.clear()
      for (const taskId of arg.slice("--task=".length).split(",")) {
        addTask(selectedTasks, allTaskIds, taskId)
      }
      continue
    }
    if (arg === "--base-url") {
      baseUrl = requireValue(rawArgs, index, arg)
      index += 1
      continue
    }
    if (arg.startsWith("--base-url=")) {
      baseUrl = arg.slice("--base-url=".length)
      continue
    }
    if (arg === "--llm-wiki-url") {
      llmWikiUrl = requireValue(rawArgs, index, arg)
      llmWikiUrlExplicit = true
      index += 1
      continue
    }
    if (arg.startsWith("--llm-wiki-url=")) {
      llmWikiUrl = arg.slice("--llm-wiki-url=".length)
      llmWikiUrlExplicit = true
      continue
    }
    if (arg === "--bearfrp-url") {
      bearfrpUrl = requireValue(rawArgs, index, arg)
      index += 1
      continue
    }
    if (arg.startsWith("--bearfrp-url=")) {
      bearfrpUrl = arg.slice("--bearfrp-url=".length)
      continue
    }
    if (arg === "--project") {
      projectId = requireValue(rawArgs, index, arg)
      projectExplicit = true
      index += 1
      continue
    }
    if (arg.startsWith("--project=")) {
      projectId = arg.slice("--project=".length)
      projectExplicit = true
      continue
    }
    if (arg === "--query") {
      searchQuery = requireValue(rawArgs, index, arg)
      index += 1
      continue
    }
    if (arg.startsWith("--query=")) {
      searchQuery = arg.slice("--query=".length)
      continue
    }
    if (arg === "--http-timeout") {
      httpTimeout = Number(requireValue(rawArgs, index, arg))
      index += 1
      continue
    }
    if (arg.startsWith("--http-timeout=")) {
      httpTimeout = Number(arg.slice("--http-timeout=".length))
      continue
    }
    failUsage(`Unknown option: ${arg}`)
  }

  if (!whitebox && !blackbox) {
    failUsage("At least one of --whitebox or --blackbox must be enabled")
  }
  if (!Number.isFinite(httpTimeout) || httpTimeout <= 0) {
    failUsage("--http-timeout must be a positive number")
  }

  return {
    tasks: selectedTasks,
    whitebox,
    blackbox,
    docker,
    baseUrl: stripTrailingSlash(baseUrl),
    llmWikiUrl: stripTrailingSlash(llmWikiUrl ?? (llmWikiUrlExplicit ? "" : `${baseUrl}/instance/llm-wiki`)),
    bearfrpUrl: stripTrailingSlash(bearfrpUrl),
    projectId,
    projectExplicit,
    searchQuery,
    httpTimeout,
    llmWikiToken,
  }
}

function addTask(selectedTasks, allTaskIds, taskId) {
  const normalized = taskId.trim().toUpperCase()
  if (!normalized) return
  if (!allTaskIds.has(normalized)) {
    failUsage(`Unknown task id: ${taskId}`)
  }
  selectedTasks.add(normalized)
}

function requireValue(rawArgs, index, name) {
  const value = rawArgs[index + 1]
  if (!value || value.startsWith("--")) {
    failUsage(`${name} requires a value`)
  }
  return value
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "")
}

function printHelp() {
  console.log(`Usage: node scripts/test-tasks.mjs [options]

Runs the black-box and white-box checks mapped to /doc/测试文档.pdf tasks T-01..T-09.

Default:
  node scripts/test-tasks.mjs
    Runs white-box checks that do not require a running Compose stack.

Useful modes:
  node scripts/test-tasks.mjs --task T-04,T-05
  node scripts/test-tasks.mjs --blackbox --no-whitebox
  node scripts/test-tasks.mjs --blackbox --base-url http://127.0.0.1 --bearfrp-url http://127.0.0.1:8000
  node scripts/test-tasks.mjs --blackbox --llm-wiki-url http://127.0.0.1:19828/api/v1

Options:
  --task <ids>          Comma-separated task ids, for example T-01,T-02.
  --whitebox           Run source-level tests. Enabled by default.
  --no-whitebox        Disable source-level tests.
  --blackbox           Run HTTP checks against already-started services.
  --docker             Also run optional Docker image build checks.
  --base-url <url>     Unified nginx/OpenCode URL. Default: WIKIBRIDGE_BASE_URL or http://127.0.0.1.
  --llm-wiki-url <url> LLM Wiki API base. Default: LLM_WIKI_API_URL or <base-url>/instance/llm-wiki.
  --bearfrp-url <url>  BearFRP API URL. Default: BEARFRP_API_URL or http://127.0.0.1:8000.
  --project <id>       Project id for LLM Wiki checks. Default: WIKIBRIDGE_TEST_PROJECT or current.
  --query <text>       Search query for LLM Wiki checks. Default: WIKIBRIDGE_TEST_QUERY or example.
  --http-timeout <sec> curl timeout for black-box checks. Default: 10.
`)
}

function failUsage(message) {
  console.error(message)
  console.error("Run node scripts/test-tasks.mjs --help for usage.")
  process.exit(2)
}

function hasCommand(command) {
  if (command.includes("/") || command.includes("\\")) {
    return existsSync(resolve(repoRoot, command))
  }
  const result = spawnSync("bash", ["-lc", `command -v ${shellQuote(command)} >/dev/null 2>&1`], {
    cwd: repoRoot,
    stdio: "ignore",
    shell: false,
  })
  return result.status === 0
}

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function pythonCommand() {
  return process.env.PYTHON ?? "python3"
}

function processListIncludes(needle) {
  const result = spawnSync("ps", ["-eo", "args"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    shell: false,
  })
  return result.status === 0 && result.stdout.includes(needle)
}

function nodeAtLeast(minimum) {
  const current = parseVersion(process.versions.node)
  const required = parseVersion(minimum)
  for (let index = 0; index < required.length; index += 1) {
    if ((current[index] ?? 0) > required[index]) return true
    if ((current[index] ?? 0) < required[index]) return false
  }
  return true
}

function parseVersion(version) {
  return version.split(".").map((part) => Number(part.replace(/\D.*/, "")) || 0)
}

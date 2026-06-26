#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const seRoot = resolve(repoRoot, "..")
const screenshotDir = resolve(
  process.env.WIKIBRIDGE_SCREENSHOT_DIR ?? resolve(seRoot, "doc/软件测试报告/screen-shot"),
)
const reportPath = resolve(seRoot, "doc/软件测试报告/playwright-人工测试截图说明.md")
const baseUrl = stripTrailingSlash(process.env.WIKIBRIDGE_BASE_URL ?? "http://127.0.0.1:18080")
const bearfrpPublicUrl = stripTrailingSlash(process.env.WIKIBRIDGE_BEARFRP_PUBLIC_URL ?? "http://127.0.0.1:52600")
const projectId = process.env.WIKIBRIDGE_TEST_PROJECT ?? "sample-wiki"
const query = process.env.WIKIBRIDGE_TEST_QUERY ?? "WikiBridge"
const viewport = { width: 1440, height: 1000 }
const desktopScreenshotNames = [
  "T-09-desktop-project-dashboard.png",
  "T-09-desktop-compile-ready.png",
  "T-09-desktop-link-report-ready.png",
  "T-09-desktop-local-wiki-reader.png",
]

const playwrightPackage = resolve(repoRoot, "desktop/node_modules/playwright")
const results = []
const require = createRequire(import.meta.url)

mkdirSync(screenshotDir, { recursive: true })

if (!existsSync(playwrightPackage)) {
  fail(`Missing Playwright dependency at ${relativePath(playwrightPackage)}. Run npm ci in wikibridge/desktop first.`)
}

const { chromium } = require(playwrightPackage)

runPrepareBlackboxData()

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  await captureWebEvidence(page)
  await context.close()
} finally {
  await browser.close()
}

await captureDesktopEvidence()
writeReport()
printSummary()

const failed = results.filter((result) => result.status === "fail")
if (failed.length > 0) process.exit(1)

async function captureWebEvidence(page) {
  const local = await openApp(page, baseUrl, "/")
  await assertStatus(local.response, 200, `${baseUrl}/`)
  await expectMeta(page, "opencode-kb-mode", "1")
  await expectText(page, /Projects|Knowledge Base|Nothing here yet|New session/)
  await screenshot(page, "T-07-local-entry-opencode-kb-home.png", {
    task: "T-07",
    title: "本地入口 OpenCode KB 页面",
    mode: "real-ui",
    note: "检查入口 HTTP 200 且 meta[name=\"opencode-kb-mode\"] 为 1。",
  })

  await screenshot(page, "T-03-kb-mode-meta-and-ui.png", {
    task: "T-03",
    title: "OpenCode KB UI 权限可视化",
    mode: "real-ui",
    note: "页面暴露 KB mode meta，并显示 OpenCode KB 入口 UI。",
  })

  await captureKnowledgeBaseUi(page)

  const bearfrp = await openApp(page, bearfrpPublicUrl, "/")
  await assertStatus(bearfrp.response, 200, `${bearfrpPublicUrl}/`)
  await expectMeta(page, "opencode-kb-mode", "1")
  await expectText(page, /Projects|Knowledge Base|Nothing here yet|New session/)
  await screenshot(page, "T-07-bearfrp-published-entry.png", {
    task: "T-07",
    title: "BearFRP 发布 URL 首页",
    mode: "real-ui",
    note: "BearFRP 发布入口可访问，并返回 OpenCode KB shell。",
  })
}

async function captureKnowledgeBaseUi(page) {
  const opened = await openApp(page, baseUrl, "/llm-wiki")
  await assertStatus(opened.response, 200, `${baseUrl}/llm-wiki`)
  await page.getByText("Knowledge Base", { exact: true }).waitFor({ state: "visible", timeout: 10_000 })

  const projectSelect = page.locator("select").first()
  await projectSelect.waitFor({ state: "visible", timeout: 10_000 })
  await projectSelect.selectOption(projectId)
  await waitForSelectValue(projectSelect, projectId)
  await page.getByRole("button", { name: /^index\.md$/ }).first().waitFor({ state: "visible", timeout: 10_000 })
  await page.getByRole("button", { name: /^xss\.md$/ }).first().waitFor({ state: "visible", timeout: 10_000 })
  await screenshot(page, "T-07-llm-wiki-knowledge-base-page.png", {
    task: "T-07",
    title: "OpenCode /llm-wiki 知识库页面",
    mode: "real-ui",
    note: "真实 /llm-wiki UI 呈现 Knowledge Base、项目选择器和文件树。",
  })

  await page.getByText("Graph", { exact: true }).waitFor({ state: "visible", timeout: 10_000 })
  await page.getByText(/nodes \/ .* edges/).waitFor({ state: "visible", timeout: 10_000 })
  await page.getByText("Sample Wiki Index", { exact: true }).first().waitFor({ state: "visible", timeout: 10_000 })
  await page.getByText(/README -> index|index -> README/).waitFor({ state: "visible", timeout: 10_000 })
  await screenshot(page, "T-07-llm-wiki-graph-view.png", {
    task: "T-07",
    title: "LLM Wiki 图谱视图",
    mode: "real-ui",
    note: "真实 /llm-wiki UI 显示 Graph 节点和边。",
  })

  const fileButton = page.getByRole("button", { name: /^index\.md$/ }).first()
  await fileButton.click({ timeout: 5_000 })
  await page.getByRole("heading", { name: "Sample Wiki Index" }).waitFor({ state: "visible", timeout: 10_000 })
  await screenshot(page, "T-07-llm-wiki-file-content.png", {
    task: "T-07",
    title: "LLM Wiki 文件内容页",
    mode: "real-ui",
    note: "点击 index.md 后显示 Markdown 内容。",
  })

  const search = page.getByPlaceholder("Search knowledge base...")
  await search.fill(query)
  await page.getByRole("button", { name: "Search" }).click()
  await page.getByText("Search results", { exact: true }).waitFor({ state: "visible", timeout: 10_000 })
  await page.getByText(/Sample Wiki Index|WikiBridge/).first().waitFor({ state: "visible", timeout: 10_000 })
  await screenshot(page, "T-07-llm-wiki-search-results.png", {
    task: "T-07",
    title: "LLM Wiki 搜索结果",
    mode: "real-ui",
    note: `搜索 ${query} 后显示 Search results。`,
  })

  await captureXssNoDialog(page)
}

async function captureXssNoDialog(page) {
  const dialogs = []
  const listener = (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`)
    void dialog.dismiss().catch(() => undefined)
  }
  page.on("dialog", listener)
  try {
    await page.getByRole("button", { name: /^xss\.md$/ }).first().click({ timeout: 5_000 })
    await page.getByRole("heading", { name: "XSS Safety Fixture" }).waitFor({ state: "visible", timeout: 10_000 })
    await page.getByText("<script>alert(1)</script>", { exact: true }).waitFor({ state: "visible", timeout: 10_000 })
    await page.waitForTimeout(1_000)
    if (dialogs.length > 0) throw new Error(`Unexpected browser dialog: ${dialogs.join("; ")}`)
    await screenshot(page, "T-08-xss-no-alert-llm-wiki-content.png", {
      task: "T-08",
      title: "XSS 浏览器观察",
      mode: "real-ui",
      note: "打开包含 <script>alert(1)</script> 的真实 Wiki 页面并监听 dialog，未捕获浏览器弹窗。",
    })
  } finally {
    page.off("dialog", listener)
  }
}

async function captureDesktopEvidence() {
  if (!nodeAtLeast("20.19.0")) {
    for (const name of desktopScreenshotNames) {
      const stale = resolve(screenshotDir, name)
      if (existsSync(stale)) unlinkSync(stale)
    }
    results.push({
      task: "T-09",
      file: desktopScreenshotNames.join(", "),
      title: "桌面端闭环截图",
      status: "skip",
      mode: "version-gated",
      note: `Node ${process.versions.node} is below required 20.19.0; stale T-09 screenshots removed if present.`,
    })
    console.log(`SKIP T-09 desktop screenshots: Node ${process.versions.node} is below required 20.19.0`)
    return
  }

  const server = spawnNpm(["run", "test:system:server"], { cwd: resolve(repoRoot, "desktop") })
  try {
    await waitForHttp("http://127.0.0.1:1421", 120_000)
    const browser = await chromium.launch({ headless: true })
    try {
      const context = await browser.newContext({ viewport })
      const page = await context.newPage()
      await page.addInitScript(() => {
        window.__wikibridgeSystemTestOpenCalls = []
        window.__wikibridgeSystemTestConfirmResult = true
        window.__wikibridgeSystemTestClipboardText = ""
        window.open = (url, target) => {
          window.__wikibridgeSystemTestOpenCalls.push({ url: String(url || ""), target: String(target || "") })
          return null
        }
        window.confirm = () => window.__wikibridgeSystemTestConfirmResult
        Object.defineProperty(window.navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (text) => {
              window.__wikibridgeSystemTestClipboardText = text
            },
          },
        })
      })
      await page.goto("http://127.0.0.1:1421/", { waitUntil: "domcontentloaded" })
      await page.getByText("WikiBridge", { exact: true }).waitFor({ state: "visible", timeout: 10_000 })
      await page.getByRole("heading", { name: "知识库项目" }).waitFor({ state: "visible", timeout: 10_000 })
      await screenshot(page, "T-09-desktop-project-dashboard.png", {
        task: "T-09",
        title: "桌面端知识库项目面板",
        mode: "real-ui",
        note: "桌面端发布端项目仪表盘可见。",
      })

      await expectText(page, /DeepSeek|LLM Wiki|知识库项目/)
      await screenshot(page, "T-09-desktop-compile-ready.png", {
        task: "T-09",
        title: "桌面端编译准备状态",
        mode: "real-ui",
        note: "桌面端显示 LLM Wiki 配置和项目构建入口。",
      })

      await page.getByRole("button", { name: /访问连接|登录连接/ }).first().click()
      await page
        .getByText(/访问连接|登录连接|登录|知识库 API 分享连接/)
        .first()
        .waitFor({ state: "visible", timeout: 10_000 })
      await screenshot(page, "T-09-desktop-link-report-ready.png", {
        task: "T-09",
        title: "桌面端访问连接状态",
        mode: "real-ui",
        note: "桌面端显示知识库 API 分享连接入口或登录态连接入口。",
      })

      await page.getByRole("button", { name: /消费端/ }).click()
      await page.getByRole("heading", { name: "添加远程知识库" }).waitFor({ state: "visible", timeout: 10_000 })
      await screenshot(page, "T-09-desktop-local-wiki-reader.png", {
        task: "T-09",
        title: "桌面端本地 Wiki Reader / 消费端",
        mode: "real-ui",
        note: "桌面端消费端远程知识库入口可见。",
      })
      await context.close()
    } finally {
      await browser.close()
    }
  } finally {
    server.kill()
  }
}

async function openApp(page, root, path) {
  const url = `${root}${path}`
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 })
      await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => undefined)
      await page.waitForTimeout(1_000)
      return { url, response }
    } catch (error) {
      lastError = error
      if (attempt === 3 || !isRetryableNavigationError(error)) throw error
      await page.waitForTimeout(1_000 * attempt)
    }
  }
  throw lastError
}

async function assertStatus(response, expected, url) {
  if (!response) throw new Error(`No response for ${url}`)
  if (response.status() !== expected) throw new Error(`${url} returned HTTP ${response.status()}, expected ${expected}`)
}

async function expectMeta(page, name, expected) {
  const actual = await page.locator(`meta[name="${name}"]`).getAttribute("content", { timeout: 5_000 })
  if (actual !== expected) throw new Error(`Expected meta ${name}=${expected}, got ${actual}`)
}

async function expectText(page, pattern) {
  const text = await page.locator("body").innerText({ timeout: 8_000 })
  if (!pattern.test(text)) throw new Error(`Missing body text matching ${pattern}`)
}

async function screenshot(page, file, result) {
  const target = resolve(screenshotDir, file)
  await page.screenshot({ path: target, fullPage: true })
  const info = statSync(target)
  if (info.size <= 0) throw new Error(`Screenshot ${target} is empty`)
  results.push({ ...result, file, status: "pass", size: info.size })
  console.log(`PASS ${result.task} ${file}`)
}

function runPrepareBlackboxData() {
  const result = spawnSync(process.execPath, ["scripts/test-tasks.mjs", "--prepare-blackbox-data"], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  })
  if (result.error) fail(`Failed to prepare black-box data: ${result.error.message}`)
  if (result.status !== 0) {
    fail(`Failed to prepare black-box data:\n${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`)
  }
  console.log((result.stdout || "").trim())
}

async function waitForSelectValue(locator, expected) {
  const started = Date.now()
  while (Date.now() - started < 10_000) {
    if ((await locator.inputValue().catch(() => undefined)) === expected) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Expected project select value ${expected}`)
}

function spawnNpm(args, config) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm"
  const npmCheck = spawnSync(command, ["--version"], {
    cwd: config.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  })
  if (npmCheck.error || npmCheck.status !== 0) fail("npm is required for Node 20.19+ desktop screenshot capture")
  const child = spawn(command, args, {
    cwd: config.cwd,
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  })
  child.stdout?.on("data", (chunk) => process.stdout.write(`[desktop-server] ${chunk}`))
  child.stderr?.on("data", (chunk) => process.stderr.write(`[desktop-server] ${chunk}`))
  return child
}

async function waitForHttp(url, timeoutMs) {
  const started = Date.now()
  let lastError = ""
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = errorMessage(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`)
}

function writeReport() {
  const date = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "short",
    timeStyle: "medium",
    hour12: false,
  }).format(new Date())
  const lines = [
    "# Playwright 人工测试截图说明",
    "",
    `生成时间：${date} Asia/Shanghai`,
    "",
    "## 执行命令",
    "",
    "```bash",
    "cd /root/SE/wikibridge",
    "node scripts/capture-manual-ui-screenshots.mjs",
    "```",
    "",
    "可选环境变量：",
    "",
    "```bash",
    "WIKIBRIDGE_BASE_URL=http://127.0.0.1:18080",
    "WIKIBRIDGE_BEARFRP_PUBLIC_URL=http://127.0.0.1:52600",
    "WIKIBRIDGE_SCREENSHOT_DIR=/root/SE/doc/软件测试报告/screen-shot",
    "```",
    "",
    "## 当前环境",
    "",
    `- Node：${process.versions.node}`,
    `- 本地入口：${baseUrl}`,
    `- BearFRP 发布入口：${bearfrpPublicUrl}`,
    `- 截图目录：${screenshotDir}`,
    `- Playwright 依赖：${relativePath(playwrightPackage)}`,
    "",
    "## 截图清单",
    "",
    "| 测试项 | 文件 | 结果 | 证据来源 | 说明 |",
    "| --- | --- | --- | --- | --- |",
    ...results.map(
      (result) =>
        `| ${result.task} | ${result.file} | ${result.status.toUpperCase()} | ${result.mode} | ${escapeMarkdown(result.note ?? result.title)} |`,
    ),
    "",
    "## T-09 跳过说明",
    "",
    nodeAtLeast("20.19.0")
      ? "T-09 已在当前 Node 环境下尝试执行桌面端截图路径。"
      : `当前 Node 为 ${process.versions.node}，低于桌面端 Playwright/Vite 要求的 20.19.0，因此本次未执行 T-09 桌面端截图。升级 Node 后补跑命令：`,
    "",
  ]
  if (!nodeAtLeast("20.19.0")) {
    lines.push("```bash", "cd /root/SE/wikibridge", "node scripts/capture-manual-ui-screenshots.mjs", "```", "")
    lines.push("预留截图文件名：", "")
    for (const name of desktopScreenshotNames) lines.push(`- ${name}`)
    lines.push("")
  }
  lines.push(
    "## 备注",
    "",
    "脚本会先执行 `node scripts/test-tasks.mjs --prepare-blackbox-data`，确保 `sample-wiki` 测试项目存在。",
    "T-03、T-07、T-08 的截图均要求真实浏览器 UI 断言先通过；若 `/llm-wiki` 页面、文件点击、搜索结果或 XSS dialog 监听失败，脚本会直接失败退出。",
    "",
  )
  writeFile(reportPath, lines.join("\n"))
}

function printSummary() {
  console.log("")
  console.log(`Screenshots: ${screenshotDir}`)
  console.log(`Report: ${reportPath}`)
  for (const result of results) {
    console.log(`${result.status.toUpperCase()} ${result.task} ${result.file} (${result.mode})`)
  }
}

function writeFile(path, content) {
  writeFileSync(path, content, "utf8")
}

function nodeAtLeast(required) {
  const current = process.versions.node.split(".").map(Number)
  const minimum = required.split(".").map(Number)
  for (let i = 0; i < minimum.length; i += 1) {
    if ((current[i] ?? 0) > minimum[i]) return true
    if ((current[i] ?? 0) < minimum[i]) return false
  }
  return true
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "")
}

function errorMessage(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
}

function isRetryableNavigationError(error) {
  const message = errorMessage(error)
  return /ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET|ERR_CONNECTION_REFUSED|Timeout/i.test(message)
}

function relativePath(path) {
  return path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path
}

function escapeMarkdown(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ")
}

#!/usr/bin/env node

import { existsSync, mkdirSync, copyFileSync, chmodSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import os from "node:os"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(__dirname, "..")
const repoRoot = path.resolve(desktopDir, "..")
const platform = platformKey()
const opencodePackage = opencodePackageKey()
const exe = process.platform === "win32" ? ".exe" : ""
const args = new Set(process.argv.slice(2))
const target = [...args].find((arg) => !arg.startsWith("--")) ?? "all"
const skipBuild = args.has("--skip-build")

if (!["all", "frpc", "opencode", "llm-wiki"].includes(target)) {
  fail(`Unknown target "${target}". Use all, frpc, opencode, or llm-wiki.`)
}

if (target === "all" || target === "frpc") prepareFrpc()
if (target === "all" || target === "llm-wiki") prepareLlmWiki()
if (target === "all" || target === "opencode") prepareOpenCode()

function prepareFrpc() {
  const dest = path.join(desktopDir, "src-tauri", "binaries", "frpc", platform, `frpc${exe}`)
  if (skipBuild) {
    if (existsSync(dest)) {
      console.log(`Using existing frpc -> ${path.relative(repoRoot, dest)}`)
      return
    }
    fail(`frpc binary was not found at ${dest}. Rerun without --skip-build to download it.`)
  }

  const version = process.env.FRP_VERSION || "v0.58.1"
  const versionNoV = version.startsWith("v") ? version.slice(1) : version
  const osName = process.platform === "win32" ? "windows" : process.platform
  const arch = process.arch === "x64" ? "amd64" : process.arch
  const archive = `frp_${versionNoV}_${osName}_${arch}.tar.gz`
  const url = `https://github.com/fatedier/frp/releases/download/${version}/${archive}`
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wikibridge-frpc-"))
  try {
    const archivePath = path.join(tempDir, archive)
    run("curl", ["-L", "-o", archivePath, url], repoRoot)
    run("tar", ["xzf", archivePath, "-C", tempDir], repoRoot)
    const source = findFile(tempDir, `frpc${exe}`)
    if (!source) fail(`Downloaded ${archive}, but frpc${exe} was not found inside it.`)
    copyBinary(source, dest, "frpc")
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

function prepareLlmWiki() {
  const manifest = path.join(repoRoot, "llm_wiki", "src-tauri", "Cargo.toml")
  const source = path.join(repoRoot, "llm_wiki", "src-tauri", "target", "release", `llm-wiki-server${exe}`)
  const dest = path.join(
    desktopDir,
    "src-tauri",
    "binaries",
    "llm-wiki-server",
    platform,
    `llm-wiki-server${exe}`,
  )

  if (!skipBuild) {
    run("cargo", ["build", "--release", "--bin", "llm-wiki-server", "--manifest-path", manifest], repoRoot, {
      LLM_WIKI_SKIP_TAURI_BUILD: "1",
    })
  }
  copyBinary(source, dest, "llm-wiki-server")
}

function prepareOpenCode() {
  const opencodeRoot = path.join(repoRoot, "opencode")
  const source = path.join(
    opencodeRoot,
    "packages",
    "opencode",
    "dist",
    opencodePackage,
    "bin",
    `opencode${exe}`,
  )
  const dest = path.join(desktopDir, "src-tauri", "binaries", "opencode", platform, `opencode${exe}`)

  if (!skipBuild) {
    run("bun", ["install"], opencodeRoot)
    run("bun", ["run", "--cwd", "packages/opencode", "build", "--single"], opencodeRoot)
  }
  copyBinary(source, dest, "opencode")
}

function copyBinary(source, dest, label) {
  if (!existsSync(source)) {
    fail(`${label} binary was not found at ${source}. Build it first or rerun without --skip-build.`)
  }
  mkdirSync(path.dirname(dest), { recursive: true })
  copyFileSync(source, dest)
  if (process.platform !== "win32") chmodSync(dest, 0o755)
  console.log(`Copied ${label} -> ${path.relative(repoRoot, dest)}`)
}

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32",
  })
  if (result.error) fail(`Failed to run ${command}: ${result.error.message}`)
  if (result.status !== 0) fail(`${command} exited with status ${result.status}`)
}

function platformKey() {
  const os =
    process.platform === "darwin"
      ? "darwin"
      : process.platform === "win32"
        ? "windows"
        : process.platform === "linux"
          ? "linux"
          : fail(`Unsupported OS: ${process.platform}`)
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : fail(`Unsupported arch: ${process.arch}`)
  if (os === "windows") return "windows-amd64"
  return `${os}-${arch}`
}

function opencodePackageKey() {
  const os = process.platform === "win32" ? "windows" : process.platform
  const arch = process.arch
  if (!["darwin", "linux", "windows"].includes(os)) fail(`Unsupported OpenCode OS: ${process.platform}`)
  if (!["arm64", "x64"].includes(arch)) fail(`Unsupported OpenCode arch: ${process.arch}`)
  return `opencode-${os}-${arch}`
}

function findFile(root, filename) {
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry)
    const stats = statSync(full)
    if (stats.isFile() && entry === filename) return full
    if (stats.isDirectory()) {
      const found = findFile(full, filename)
      if (found) return found
    }
  }
  return undefined
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

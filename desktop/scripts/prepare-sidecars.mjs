#!/usr/bin/env node

import { existsSync, mkdirSync, copyFileSync, chmodSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import {
  executableName,
  hostPlatformKey,
  opencodePackageKey,
  parsePlatformArg,
  rustTargetTriple,
  supportedPlatforms,
} from "./platforms.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(__dirname, "..")
const repoRoot = path.resolve(desktopDir, "..")
const parsed = parseArgs(process.argv.slice(2))
const platform = parsed.platform
const hostPlatform = hostPlatformKey()
const args = new Set(parsed.args)
const target = parsed.target
const skipBuild = args.has("--skip-build")

if (!["all", "opencode", "llm-wiki"].includes(target)) {
  fail(`Unknown target "${target}". Use all, opencode, or llm-wiki.`)
}

if (target === "all" || target === "llm-wiki") prepareLlmWiki()
if (target === "all" || target === "opencode") prepareOpenCode()

function prepareLlmWiki() {
  const manifest = path.join(repoRoot, "llm_wiki", "src-tauri", "Cargo.toml")
  const executable = executableName(platform, "llm-wiki-server")
  const source = llmWikiSourcePath(executable)
  const dest = path.join(
    desktopDir,
    "src-tauri",
    "binaries",
    "llm-wiki-server",
    platform,
    executable,
  )

  if (!skipBuild) {
    assertNativeBuild("llm-wiki-server")
    const env = { LLM_WIKI_SKIP_TAURI_BUILD: "1", ...protocEnv() }
    run("cargo", ["build", "--release", "--bin", "llm-wiki-server", "--manifest-path", manifest], repoRoot, {
      ...env,
    })
  }
  copyBinary(source, dest, "llm-wiki-server")
}

function prepareOpenCode() {
  const opencodeRoot = path.join(repoRoot, "opencode")
  const executable = executableName(platform, "opencode")
  const source = opencodeSourcePaths(opencodeRoot, executable)
  const dest = path.join(desktopDir, "src-tauri", "binaries", "opencode", platform, executable)

  if (!skipBuild) {
    assertNativeBuild("opencode")
    const bun = bunCommand()
    run(bun, ["install"], opencodeRoot)
    run(bun, ["run", "--cwd", "packages/opencode", "build", "--single", "--skip-install"], opencodeRoot)
  }
  copyBinary(source, dest, "opencode")
}

function copyBinary(sourceCandidates, dest, label) {
  const candidates = Array.isArray(sourceCandidates) ? sourceCandidates : [sourceCandidates]
  const source = candidates.find((candidate) => existsSync(candidate))

  if (!source) {
    fail(
      [
        `${label} binary was not found for ${platform}.`,
        "Checked:",
        ...candidates.map((candidate) => `  ${candidate}`),
        `Build it on ${platform}, or provide a prebuilt artifact in the expected output path and rerun with --skip-build --platform ${platform}.`,
      ].join("\n"),
    )
  }
  mkdirSync(path.dirname(dest), { recursive: true })
  copyFileSync(source, dest)
  if (!platform.startsWith("windows-")) chmodSync(dest, 0o755)
  console.log(`Copied ${label} -> ${path.relative(repoRoot, dest)}`)
}

function parseArgs(rawArgs) {
  let parsed
  try {
    parsed = parsePlatformArg(rawArgs)
  } catch (error) {
    fail(error.message)
  }

  const allowedFlags = new Set(["--skip-build"])
  const unknownFlag = parsed.args.find((arg) => arg.startsWith("--") && !allowedFlags.has(arg))
  if (unknownFlag) {
    fail(`Unknown option "${unknownFlag}". Use --platform <${supportedPlatforms.join("|")}> or --skip-build.`)
  }

  const positional = parsed.args.filter((arg) => !arg.startsWith("--"))
  if (positional.length > 1) {
    fail(`Too many targets: ${positional.join(", ")}. Use one of all, opencode, or llm-wiki.`)
  }

  return {
    platform: parsed.platform,
    args: parsed.args,
    target: positional[0] ?? "all",
  }
}

function llmWikiSourcePath(executable) {
  const targetDir =
    platform === hostPlatform
      ? path.join(repoRoot, "llm_wiki", "src-tauri", "target", "release")
      : path.join(repoRoot, "llm_wiki", "src-tauri", "target", rustTargetTriple(platform), "release")
  return path.join(targetDir, executable)
}

function opencodeSourcePaths(opencodeRoot, executable) {
  const packageKey = opencodePackageKey(platform)
  const binDir = path.join(opencodeRoot, "packages", "opencode", "dist", packageKey, "bin")
  const candidates = [path.join(binDir, executable)]
  if (platform.startsWith("windows-")) candidates.push(path.join(binDir, "opencode"))
  return candidates
}

function assertNativeBuild(label) {
  if (platform === hostPlatform) return
  fail(
    [
      `${label} native build requested for ${platform}, but this host is ${hostPlatform}.`,
      "Run this command on the target platform, or prebuild the target artifact and rerun with:",
      `  npm run sidecars -- ${target} --skip-build --platform ${platform}`,
    ].join("\n"),
  )
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

function protocEnv() {
  if (process.env.PROTOC) return {}

  const localProtoc = path.join(desktopDir, "node_modules", ".bin", process.platform === "win32" ? "protoc.cmd" : "protoc")
  if (existsSync(localProtoc)) return { PROTOC: localProtoc }

  if (findOnPath("protoc")) return {}

  fail(
    [
      "llm-wiki-server build requires protoc for the lancedb/prost build step.",
      "Run npm ci in desktop/ to install the local protoc devDependency, or install it system-wide:",
      "  Fedora: sudo dnf install protobuf-compiler",
      "  Debian/Ubuntu: sudo apt-get install protobuf-compiler",
      "  macOS: brew install protobuf",
      "  Windows: choco install protoc",
    ].join("\n"),
  )
}

function bunCommand() {
  const localBun = path.join(desktopDir, "node_modules", ".bin", process.platform === "win32" ? "bun.cmd" : "bun")
  if (existsSync(localBun)) return localBun
  if (findOnPath("bun")) return "bun"

  fail(
    [
      "OpenCode sidecar build requires Bun.",
      "Run npm ci in desktop/ to install the local bun devDependency, or install Bun system-wide:",
      "  https://bun.sh/docs/installation",
    ].join("\n"),
  )
}

function findOnPath(command) {
  const pathEnv = process.env.PATH ?? ""
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""]

  return pathEnv.split(path.delimiter).some((dir) =>
    extensions.some((ext) => existsSync(path.join(dir, `${command}${ext.toLowerCase()}`)) || existsSync(path.join(dir, `${command}${ext}`))),
  )
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, statSync } from "node:fs"
import { dirname, extname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..")
const args = new Set(process.argv.slice(2))
const checkMode = args.has("--check")
const condaEnvName = process.env.BEARFRP_CONDA_ENV || "bearfrp_test"

if (args.has("--help")) {
  console.log(`Usage: npm run format:owned [-- --check]

Formats only repository-owned source trees:
  - desktop/
  - bearfrp/

Environment:
  BEARFRP_CONDA_ENV  Python conda env name, default: bearfrp_test
`)
  process.exit(0)
}

for (const arg of args) {
  if (arg !== "--check" && arg !== "--help") {
    console.error(`Unknown argument: ${arg}`)
    process.exit(2)
  }
}

const ownedRoots = ["desktop", "bearfrp"]
const skippedDirNames = new Set([
  ".git",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".venv",
  "__pycache__",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "target",
  "test-results",
])
const skippedPrefixes = [
  "bearfrp/WHU-Beamer/",
  "bearfrp/reference/",
  "bearfrp/static/",
  "desktop/src-tauri/gen/",
  "desktop/src-tauri/binaries/",
  "bearfrp/desktop-frp/src-tauri/gen/",
  "bearfrp/desktop-frp/src-tauri/binaries/",
]
const skippedFiles = new Set([
  "desktop/package-lock.json",
  "bearfrp/desktop-frp/package-lock.json",
  "desktop/src-tauri/Cargo.lock",
  "bearfrp/desktop-frp/src-tauri/Cargo.lock",
  "bearfrp/SBOM.json",
])

const prettierExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
])

const files = collectOwnedFiles()
const prettierFiles = files.filter((file) => prettierExtensions.has(extname(file)))
const pythonFiles = files.filter((file) => extname(file) === ".py")
const goFiles = files.filter((file) => extname(file) === ".go")

let failures = 0

runPrettier(prettierFiles)
runRuffFormat(pythonFiles)
runCargoFmt("desktop/src-tauri/Cargo.toml")
runCargoFmt("bearfrp/desktop-frp/src-tauri/Cargo.toml")
runGoFmt(goFiles)

if (failures > 0) {
  console.error(`\nFormatting ${checkMode ? "check" : "run"} failed with ${failures} failed step(s).`)
  process.exit(1)
}

console.log(`\nFormatting ${checkMode ? "check" : "run"} completed.`)

function collectOwnedFiles() {
  const found = []
  for (const root of ownedRoots) {
    walk(resolve(repoRoot, root), found)
  }
  return found
}

function walk(absDir, found) {
  if (!existsSync(absDir)) return
  const entries = readdirSync(absDir, { withFileTypes: true })
  for (const entry of entries) {
    const absPath = resolve(absDir, entry.name)
    const relPath = toRepoPath(absPath)
    if (entry.isDirectory()) {
      if (skippedDirNames.has(entry.name) || isSkippedPath(relPath)) continue
      walk(absPath, found)
      continue
    }
    if (!entry.isFile() || isSkippedPath(relPath) || skippedFiles.has(relPath)) continue
    found.push(absPath)
  }
}

function isSkippedPath(relPath) {
  return skippedPrefixes.some((prefix) => relPath.startsWith(prefix))
}

function runPrettier(targets) {
  if (targets.length === 0) return
  const prettierCli = resolve(repoRoot, "node_modules", "prettier", "bin", "prettier.cjs")
  const modeArg = checkMode ? "--check" : "--write"
  const args = [
    modeArg,
    "--config",
    resolve(repoRoot, ".prettierrc.json"),
    "--ignore-path",
    resolve(repoRoot, ".prettierignore"),
    ...targets,
  ]
  const command = existsSync(prettierCli) ? process.execPath : "prettier"
  const commandArgs = existsSync(prettierCli) ? [prettierCli, ...args] : args
  runStep("Prettier", command, commandArgs, {
    missingHint: "Run `npm install` at the repository root before formatting.",
  })
}

function runRuffFormat(targets) {
  if (targets.length === 0) return
  const args = ["run", "-n", condaEnvName, "python", "-m", "ruff", "format"]
  if (checkMode) args.push("--check")
  args.push(...targets)
  runStep("Ruff format", condaBin(), args, {
    missingHint:
      "Install conda and refresh the documented environment with `conda run -n bearfrp_test python -m pip install -r bearfrp/requirements.txt`.",
  })
}

function runCargoFmt(manifestRelPath) {
  const manifest = resolve(repoRoot, manifestRelPath)
  if (!existsSync(manifest)) return
  const args = ["fmt", "--manifest-path", manifest]
  if (checkMode) args.push("--", "--check")
  runStep(`cargo fmt ${manifestRelPath}`, "cargo", args, {
    missingHint: "Install the Rust toolchain with rustfmt available on PATH.",
  })
}

function runGoFmt(targets) {
  if (targets.length === 0) return
  if (!isOnPath("gofmt")) {
    console.warn("\nSkipping gofmt: `gofmt` is not on PATH. Install the Go toolchain to format Go files.")
    return
  }
  if (checkMode) {
    const result = spawnSync("gofmt", ["-l", ...targets], {
      cwd: repoRoot,
      encoding: "utf8",
    })
    if (result.error) {
      failures += 1
      console.error(`gofmt failed to start: ${result.error.message}`)
      return
    }
    if (result.stdout.trim().length > 0) {
      failures += 1
      console.error("\ngofmt check failed for:")
      console.error(result.stdout.trim())
      return
    }
    if (result.status !== 0) {
      failures += 1
      console.error(result.stderr || "gofmt check failed.")
    }
    return
  }
  runStep("gofmt", "gofmt", ["-w", ...targets])
}

function runStep(label, command, commandArgs, options = {}) {
  console.log(`\n${label}`)
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: "inherit",
  })
  if (result.error) {
    failures += 1
    console.error(`Failed to start ${label}: ${result.error.message}`)
    if (options.missingHint) console.error(options.missingHint)
    return
  }
  if (result.status !== 0) failures += 1
}

function condaBin() {
  return process.platform === "win32" ? "conda.exe" : "conda"
}

function isOnPath(command) {
  const lookup = process.platform === "win32" ? "where" : "which"
  const result = spawnSync(lookup, [command], { stdio: "ignore" })
  return result.status === 0
}

function toRepoPath(absPath) {
  return relative(repoRoot, absPath).split("\\").join("/")
}

#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(__dirname, "..")
const cargoManifest = path.join(desktopDir, "src-tauri", "Cargo.toml")
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm"
const cargoBin = process.platform === "win32" ? "cargo.exe" : "cargo"

const options = parseArgs(process.argv.slice(2))

const steps = [
  {
    name: "BearFRP backend tests",
    command: npmBin,
    args: ["run", "test:backend"],
  },
  {
    name: "frontend build",
    command: npmBin,
    args: ["run", "build"],
  },
  {
    name: "sidecar binaries",
    command: npmBin,
    args: ["run", "sidecars:check", "--", ...options.sidecarArgs],
  },
  {
    name: "tauri rust tests",
    command: npmBin,
    args: ["run", "test:contracts"],
  },
]

if (options.includeSystem) {
  steps.push({
    name: "desktop system tests",
    command: npmBin,
    args: ["run", "test:system"],
  })
}

if (options.includeIntegration) {
  steps.push({
    name: "desktop integration tests",
    command: npmBin,
    args: ["run", "test:integration:desktop"],
  })
}

if (options.includeFakeStack) {
  steps.push({
    name: "desktop fake stack integration tests",
    command: npmBin,
    args: ["run", "test:integration:fake-stack"],
  })
}

const startedAt = Date.now()

for (const [index, step] of steps.entries()) {
  const label = `[${index + 1}/${steps.length}] ${step.name}`
  console.log(`\n${label}`)
  console.log(`${step.command} ${step.args.join(" ")}`)

  const result = spawnSync(step.command, step.args, {
    cwd: desktopDir,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  })

  if (result.error) {
    console.error(`\n${label} failed to start: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`\n${label} failed with exit code ${result.status}`)
    process.exit(result.status ?? 1)
  }
}

const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1)
console.log(`\nManual CI checks passed in ${elapsedSeconds}s.`)

function parseArgs(rawArgs) {
  const sidecarArgs = []
  let includeSystem = false
  let includeIntegration = false
  let includeFakeStack = false

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]
    if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    }
    if (arg === "--include-system") {
      includeSystem = true
      continue
    }
    if (arg === "--include-integration") {
      includeIntegration = true
      includeSystem = true
      continue
    }
    if (arg === "--include-fake-stack") {
      includeFakeStack = true
      continue
    }
    if (arg === "--platform") {
      const value = rawArgs[index + 1]
      if (!value) fail("--platform requires a value")
      sidecarArgs.push(arg, value)
      index += 1
      continue
    }
    if (arg.startsWith("--platform=")) {
      sidecarArgs.push(arg)
      continue
    }
    fail(`Unknown option "${arg}"`)
  }

  return { sidecarArgs, includeSystem, includeIntegration, includeFakeStack }
}

function printHelp() {
  console.log(`Usage: npm run ci:check -- [--platform <platform>] [--include-system] [--include-integration] [--include-fake-stack]

Runs the minimal manual CI checks for the desktop app:
  1. BearFRP backend pytest
  2. frontend TypeScript/Vite build
  3. required sidecar binary layout check
  4. Tauri Rust tests

Use --platform when checking sidecars for a non-host packaging target.
Use --include-system to also run Playwright system tests.
Use --include-integration to also run real desktop integration tests.
Use --include-fake-stack to run real app processes against fake BearFRP/frps/LLM services.`)
}

function fail(message) {
  console.error(message)
  console.error("Run npm run ci:check -- --help for usage.")
  process.exit(1)
}

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
    command: cargoBin,
    args: ["test", "--manifest-path", cargoManifest, "--locked"],
  },
]

const startedAt = Date.now()

for (const [index, step] of steps.entries()) {
  const label = `[${index + 1}/${steps.length}] ${step.name}`
  console.log(`\n${label}`)
  console.log(`${step.command} ${step.args.join(" ")}`)

  const result = spawnSync(step.command, step.args, {
    cwd: desktopDir,
    env: process.env,
    stdio: "inherit",
    shell: false,
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

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]
    if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
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

  return { sidecarArgs }
}

function printHelp() {
  console.log(`Usage: npm run ci:check -- [--platform <platform>]

Runs the minimal manual CI checks for the desktop app:
  1. frontend TypeScript/Vite build
  2. required sidecar binary layout check
  3. Tauri Rust tests

Use --platform when checking sidecars for a non-host packaging target.`)
}

function fail(message) {
  console.error(message)
  console.error("Run npm run ci:check -- --help for usage.")
  process.exit(1)
}

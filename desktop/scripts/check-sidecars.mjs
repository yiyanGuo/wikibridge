#!/usr/bin/env node

import { existsSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { executableName, parsePlatformArg, supportedPlatforms } from "./platforms.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(__dirname, "..")
const parsed = parseArgs(process.argv.slice(2))
const platform = parsed.platform

const required = [
  ["frpc", "frpc"],
  ["opencode", "opencode"],
  ["llm-wiki-server", "llm-wiki-server"],
]
const requiredResources = [
  path.join(desktopDir, "src-tauri", "binaries", "pdfium", platform, pdfiumDestName(platform)),
  path.join(desktopDir, "..", "llm_wiki", "mcp-server", "dist", "src", "index.js"),
]

const missing = []
const notExecutable = []

for (const [group, name] of required) {
  const executable = executableName(platform, name)
  const file = path.join(desktopDir, "src-tauri", "binaries", group, platform, executable)
  if (!existsSync(file)) {
    missing.push(file)
    continue
  }
  if (!platform.startsWith("windows-") && (statSync(file).mode & 0o111) === 0) {
    notExecutable.push(file)
  }
}

for (const file of requiredResources) {
  if (!existsSync(file)) missing.push(file)
}

if (missing.length > 0 || notExecutable.length > 0) {
  if (missing.length > 0) {
    console.error(`Missing sidecar binaries for ${platform}:`)
    for (const file of missing) console.error(`  ${file}`)
  }
  if (notExecutable.length > 0) {
    console.error(`Sidecar binaries are not executable for ${platform}:`)
    for (const file of notExecutable) console.error(`  ${file}`)
  }
  console.error("Run npm run sidecars before packaging.")
  process.exit(1)
}

console.log(`Sidecar binaries are ready for ${platform}.`)

function parseArgs(rawArgs) {
  let parsedArgs
  try {
    parsedArgs = parsePlatformArg(rawArgs)
  } catch (error) {
    fail(error.message)
  }

  if (parsedArgs.args.length > 0) {
    fail(`Unknown option "${parsedArgs.args[0]}". Use --platform <${supportedPlatforms.join("|")}>.`)
  }

  return parsedArgs
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function pdfiumDestName(targetPlatform) {
  if (targetPlatform.startsWith("windows-")) return "pdfium.dll"
  if (targetPlatform.startsWith("darwin-")) return "libpdfium.dylib"
  return "libpdfium.so"
}

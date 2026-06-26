#!/usr/bin/env node

import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { executableName, parsePlatformArg } from "./platforms.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(__dirname, "..")
const parsed = parsePlatformArg(process.argv.slice(2))
const platform = parsed.platform
const version = process.env.FRPC_VERSION || "0.58.1"
const archive = archiveName(platform, version)
const url = `https://github.com/fatedier/frp/releases/download/v${version}/${archive}`
const tmpRoot = path.join(tmpdir(), `wikibridge-frpc-${platform}-${Date.now()}`)
const archivePath = path.join(tmpRoot, archive)
const executable = executableName(platform, "frpc")
const dest = path.join(desktopDir, "src-tauri", "binaries", "frpc", platform, executable)

if (parsed.args.length > 0) {
  fail(`Unknown option "${parsed.args[0]}". Use --platform <platform>.`)
}

mkdirSync(tmpRoot, { recursive: true })
mkdirSync(path.dirname(dest), { recursive: true })

try {
  console.log(`Downloading frpc ${version} for ${platform}`)
  await download(url, archivePath)
  extract(archivePath, tmpRoot)
  const source = findExtractedFrpc(tmpRoot, executable)
  if (!source) fail(`Downloaded archive did not contain ${executable}`)
  copy(source, dest)
  console.log(`frpc ready at ${path.relative(desktopDir, dest)}`)
} finally {
  rmSync(tmpRoot, { recursive: true, force: true })
}

function archiveName(targetPlatform, frpVersion) {
  const suffixes = {
    "darwin-arm64": "darwin_arm64.tar.gz",
    "darwin-amd64": "darwin_amd64.tar.gz",
    "linux-arm64": "linux_arm64.tar.gz",
    "linux-amd64": "linux_amd64.tar.gz",
    "windows-amd64": "windows_amd64.zip",
  }
  const suffix = suffixes[targetPlatform]
  if (!suffix) fail(`Unsupported frpc platform: ${targetPlatform}`)
  return `frp_${frpVersion}_${suffix}`
}

async function download(sourceUrl, targetPath) {
  const response = await fetch(sourceUrl)
  if (!response.ok || !response.body) {
    fail(`Failed to download ${sourceUrl}: HTTP ${response.status}`)
  }
  await new Promise((resolve, reject) => {
    const file = createWriteStream(targetPath)
    response.body
      .pipeTo(
        new WritableStream({
          write(chunk) {
            file.write(Buffer.from(chunk))
          },
          close() {
            file.end(resolve)
          },
          abort(error) {
            file.destroy(error)
            reject(error)
          },
        }),
      )
      .catch(reject)
  })
}

function extract(file, cwd) {
  const result = spawnSync("tar", ["-xf", file, "-C", cwd], {
    stdio: "inherit",
    shell: process.platform === "win32",
  })
  if (result.error) fail(`Failed to run tar: ${result.error.message}`)
  if (result.status !== 0) fail(`tar exited with status ${result.status}`)
}

function findExtractedFrpc(root, name) {
  const candidates = [
    path.join(root, name),
    ...walk(root).filter((file) => path.basename(file).toLowerCase() === name.toLowerCase()),
  ]
  return candidates.find((file) => existsSync(file))
}

function walk(root) {
  const files = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    const entries = spawnSync(
      process.platform === "win32" ? "powershell.exe" : "find",
      process.platform === "win32"
        ? [
            "-NoProfile",
            "-Command",
            `Get-ChildItem -LiteralPath '${dir.replace(/'/g, "''")}' -Recurse -File | ForEach-Object { $_.FullName }`,
          ]
        : [dir, "-type", "f"],
      { encoding: "utf8" },
    )
    if (entries.status === 0) {
      files.push(...entries.stdout.split(/\r?\n/).filter(Boolean))
    }
    break
  }
  return files
}

function copy(source, target) {
  const result = spawnSync(
    process.platform === "win32" ? "cmd.exe" : "cp",
    process.platform === "win32" ? ["/c", "copy", "/Y", source, target] : [source, target],
    {
      stdio: "inherit",
      shell: false,
    },
  )
  if (result.error) fail(`Failed to copy frpc: ${result.error.message}`)
  if (result.status !== 0) fail(`copy exited with status ${result.status}`)
  if (!platform.startsWith("windows-")) {
    const chmod = spawnSync("chmod", ["755", target], { stdio: "inherit" })
    if (chmod.status !== 0) fail(`chmod exited with status ${chmod.status}`)
  }
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

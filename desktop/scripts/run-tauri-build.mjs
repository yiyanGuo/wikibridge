#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, readlinkSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(__dirname, "..")
const tauriBin = path.join(
  desktopDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tauri.cmd" : "tauri",
)
const buildArgs = ["build", ...process.argv.slice(2)]

if (!existsSync(tauriBin)) {
  fail(`Tauri CLI not found at ${tauriBin}. Run npm ci in desktop/ first.`)
}

if (process.platform === "linux") {
  checkLinuxInotifyCapacity()

  if (commandExists("prlimit")) {
    const nofile = linuxNoFileLimitArg(65536)
    console.log(`Running tauri build with open file limit ${nofile}`)
    run("prlimit", [`--nofile=${nofile}`, "--", tauriBin, ...buildArgs])
  }
}

run(tauriBin, buildArgs)

function linuxNoFileLimitArg(targetSoftLimit) {
  const hardLimit = readLinuxNoFileHardLimit()
  if (hardLimit === null) return `${targetSoftLimit}:${targetSoftLimit}`
  const softLimit = Math.min(targetSoftLimit, hardLimit)
  return `${softLimit}:${hardLimit}`
}

function readLinuxNoFileHardLimit() {
  try {
    const limits = readFileSync("/proc/self/limits", "utf8")
    const line = limits.split("\n").find((candidate) => candidate.startsWith("Max open files"))
    if (!line) return null
    const parts = line.trim().split(/\s+/)
    const hard = parts[4]
    if (!hard || hard === "unlimited") return null
    const parsed = Number.parseInt(hard, 10)
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

function checkLinuxInotifyCapacity() {
  const maxInstances = readLinuxIntegerFile("/proc/sys/fs/inotify/max_user_instances")
  if (maxInstances === null) return

  const usedInstances = countOpenInotifyFds()
  const reservedInstances = 4
  if (usedInstances <= maxInstances - reservedInstances) return

  fail(
    [
      `Linux inotify instances are nearly exhausted: ${usedInstances}/${maxInstances}.`,
      'Tauri CLI creates a file watcher even for release builds and may panic with "Too many open files".',
      "Close applications that hold inotify watchers, or ask the user to raise fs.inotify.max_user_instances.",
    ].join("\n"),
  )
}

function readLinuxIntegerFile(file) {
  try {
    const value = Number.parseInt(readFileSync(file, "utf8").trim(), 10)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function countOpenInotifyFds() {
  let count = 0
  for (const pid of readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue
    let fds
    try {
      fds = readdirSync(`/proc/${pid}/fd`)
    } catch {
      continue
    }
    for (const fd of fds) {
      try {
        if (readlinkSync(`/proc/${pid}/fd/${fd}`).includes("inotify")) count += 1
      } catch {
        // The process or fd may disappear while scanning /proc.
      }
    }
  }
  return count
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" })
  return !result.error && result.status === 0
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: desktopDir,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  })
  if (result.error) fail(`Failed to run ${command}: ${result.error.message}`)
  process.exit(result.status ?? 1)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

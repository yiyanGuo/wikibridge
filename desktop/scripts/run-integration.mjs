#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(__dirname, "..")
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm"

run(npmBin, ["run", "test:conda"])
run(npmBin, ["run", "sidecars:check"])

console.log("Desktop integration prerequisites are ready.")

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: desktopDir,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  })
  if (result.error) {
    console.error(`Failed to run ${command}: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

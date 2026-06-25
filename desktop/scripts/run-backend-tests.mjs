#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(__dirname, "..")
const repoRoot = path.resolve(desktopDir, "..")
const bearfrpDir = path.join(repoRoot, "bearfrp")
const condaBin = process.platform === "win32" ? "conda.exe" : "conda"
const envName = process.env.BEARFRP_CONDA_ENV || "bearfrp_test"
const pytestArgs = process.argv.slice(2)

run(process.execPath, [path.join(__dirname, "check-conda-env.mjs"), envName])
run(
  condaBin,
  ["run", "-n", envName, "python", "-m", "pytest", "-q", ...pytestArgs],
  bearfrpDir,
)

function run(command, args, cwd = desktopDir) {
  const result = spawnSync(command, args, {
    cwd,
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

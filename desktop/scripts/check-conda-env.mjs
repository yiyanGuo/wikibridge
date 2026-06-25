#!/usr/bin/env node

import { spawnSync } from "node:child_process"

const envName = process.argv[2] || "bearfrp_test"
const conda = process.platform === "win32" ? "conda.exe" : "conda"

const result = spawnSync(conda, ["run", "-n", envName, "python", "--version"], {
  encoding: "utf8",
  shell: process.platform === "win32",
})

if (result.error || result.status !== 0) {
  console.error(
    [
      `Required conda environment "${envName}" is not available.`,
      "Desktop integration tests start the BearFRP Python backend and must use the project-selected conda environment.",
      `Create or activate the existing environment, then install bearfrp/requirements.txt into "${envName}".`,
    ].join("\n"),
  )
  if (result.stderr) console.error(result.stderr.trim())
  process.exit(result.status || 1)
}

const version = `${result.stdout || result.stderr}`.trim()
console.log(`Conda environment "${envName}" is ready${version ? ` (${version})` : ""}.`)

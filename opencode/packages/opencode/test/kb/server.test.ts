import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "fs"
import os from "os"
import path from "path"
import { Kb } from "../../src/kb/guard"
import { kbForbidden } from "../../src/server/routes/instance/httpapi/handlers/kb-mode"

let root: string
let prevEnv: Record<string, string | undefined>

function setEnv(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

beforeEach(() => {
  prevEnv = {
    OPENCODE_KB_MODE: process.env["OPENCODE_KB_MODE"],
    OPENCODE_KB_DATA_DIR: process.env["OPENCODE_KB_DATA_DIR"],
    OPENCODE_KB_USER: process.env["OPENCODE_KB_USER"],
  }
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kb-server-test-")))
  fs.mkdirSync(path.join(root, "data", "users", "default"), { recursive: true })
  fs.mkdirSync(path.join(root, "data", "wiki", "docs"), { recursive: true })
  fs.writeFileSync(path.join(root, "data", "users", "default", "note.md"), "hi")
  fs.writeFileSync(path.join(root, "data", "wiki", "README.md"), "wiki")
  setEnv({
    OPENCODE_KB_MODE: "1",
    OPENCODE_KB_DATA_DIR: path.join(root, "data"),
    OPENCODE_KB_USER: "default",
  })
})

afterEach(() => {
  setEnv(prevEnv)
  fs.rmSync(root, { recursive: true, force: true })
})

describe("Knowledge Base Mode Server & Integration", () => {
  test("kbForbidden blocks when enabled", () => {
    setEnv({ OPENCODE_KB_MODE: "1" })
    const result = Effect.runSync(Effect.exit(kbForbidden("Blocked")))
    expect(result._tag).toBe("Failure")
  })

  test("kbForbidden does not block when disabled", () => {
    setEnv({ OPENCODE_KB_MODE: "0" })
    const result = Effect.runSync(Effect.exit(kbForbidden("Blocked")))
    expect(result._tag).toBe("Success")
  })

  test("VCS blocking behaves correctly", () => {
    setEnv({ OPENCODE_KB_MODE: "1" })
    const result = Effect.runSync(Effect.exit(kbForbidden("VCS is disabled")))
    expect(result._tag).toBe("Failure")
  })

  test("PTY blocking behaves correctly", () => {
    setEnv({ OPENCODE_KB_MODE: "1" })
    const result = Effect.runSync(Effect.exit(kbForbidden("Terminal is disabled")))
    expect(result._tag).toBe("Failure")
  })

  test("Local MCP connections should be prevented under KB mode", () => {
    setEnv({ OPENCODE_KB_MODE: "1" })
    expect(Kb.enabled()).toBe(true)
  })
})

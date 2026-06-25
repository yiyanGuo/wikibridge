import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { Kb } from "../../src/kb/guard"

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
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kb-test-")))
  fs.mkdirSync(path.join(root, "data", "users", "default"), { recursive: true })
  fs.mkdirSync(path.join(root, "data", "users", "alice"), { recursive: true })
  fs.mkdirSync(path.join(root, "data", "wiki", "docs"), { recursive: true })
  fs.writeFileSync(path.join(root, "data", "users", "default", "note.md"), "hi")
  fs.writeFileSync(path.join(root, "data", "wiki", "README.md"), "wiki")
  fs.writeFileSync(path.join(root, "secret.txt"), "top secret")
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

const data = (...p: string[]) => path.join(root, "data", ...p)

describe("Kb guard", () => {
  test("disabled mode allows everything", () => {
    setEnv({ OPENCODE_KB_MODE: "0" })
    expect(Kb.enabled()).toBe(false)
    expect(Kb.deny(path.join(root, "secret.txt"), "read")).toBeUndefined()
    expect(Kb.deny("/etc/passwd", "write")).toBeUndefined()
  })

  test("private dir allows read and write", () => {
    expect(Kb.deny(data("users", "default", "note.md"), "read")).toBeUndefined()
    expect(Kb.deny(data("users", "default", "note.md"), "write")).toBeUndefined()
    // not-yet-existing file inside private dir
    expect(Kb.deny(data("users", "default", "new", "deep.md"), "write")).toBeUndefined()
  })

  test("wiki allows read but denies write", () => {
    expect(Kb.deny(data("wiki", "README.md"), "read")).toBeUndefined()
    expect(Kb.deny(data("wiki", "README.md"), "write")).toBeDefined()
    expect(Kb.deny(data("wiki", "new.md"), "write")).toBeDefined()
  })

  test("other user dir is denied", () => {
    expect(Kb.deny(data("users", "alice", "note.md"), "read")).toBeDefined()
    expect(Kb.deny(data("users", "alice", "note.md"), "write")).toBeDefined()
  })

  test("project / system paths are denied", () => {
    expect(Kb.deny(path.join(root, "secret.txt"), "read")).toBeDefined()
    expect(Kb.deny("/etc/passwd", "read")).toBeDefined()
  })

  test("path traversal is denied", () => {
    expect(Kb.deny(data("users", "default", "..", "..", "secret.txt"), "read")).toBeDefined()
    expect(Kb.deny(data("users", "default", "..", "alice", "note.md"), "read")).toBeDefined()
  })

  test("symlink escape is denied", () => {
    const link = data("users", "default", "escape")
    try {
      fs.symlinkSync(root, link)
    } catch {
      return // symlinks unavailable on this platform
    }
    // following the symlink would reach the project root → must be denied
    expect(Kb.deny(path.join(link, "secret.txt"), "read")).toBeDefined()
  })

  test("symlink to /etc is denied", () => {
    const link = data("users", "default", "etc")
    try {
      fs.symlinkSync("/etc", link)
    } catch {
      return
    }
    expect(Kb.deny(path.join(link, "passwd"), "read")).toBeDefined()
  })

  test("user id is isolated per OPENCODE_KB_USER", () => {
    setEnv({ OPENCODE_KB_USER: "alice" })
    expect(Kb.deny(data("users", "alice", "note.md"), "write")).toBeUndefined()
    expect(Kb.deny(data("users", "default", "note.md"), "read")).toBeDefined()
  })

  test("malicious user id falls back to default", () => {
    setEnv({ OPENCODE_KB_USER: "../alice" })
    expect(Kb.userId()).toBe("default")
  })

  test("blocked permissions only when enabled", () => {
    expect(Kb.isBlockedPermission("bash")).toBe(true)
    expect(Kb.isBlockedPermission("read")).toBe(false)
    setEnv({ OPENCODE_KB_MODE: "0" })
    expect(Kb.isBlockedPermission("bash")).toBe(false)
  })
})

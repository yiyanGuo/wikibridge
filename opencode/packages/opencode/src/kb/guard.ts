import fs from "fs"
import path from "path"

/**
 * kbAccessGuard — knowledge base mode access control.
 *
 * When OPENCODE_KB_MODE is enabled, every file access (from the model's tools
 * or the web UI) must resolve to one of exactly two physical roots:
 *
 *   privateRoot = <dataDir>/users/<currentUserId>   (read + write)
 *   wikiRoot    = <dataDir>/wiki                     (read only)
 *
 * All other paths are denied. Paths are resolved with realpath (symlinks
 * followed, `../` collapsed) before the containment check, so neither path
 * traversal nor symlink escape can reach outside the allowed roots.
 */
export type Action = "read" | "write"

const TRUTHY = new Set(["1", "true", "yes", "on"])

export function enabled(): boolean {
  return TRUTHY.has((process.env["OPENCODE_KB_MODE"] ?? "").toLowerCase())
}

/** A user id must be a single path segment — never empty, `.`, `..`, or contain separators. */
function isSafeUserId(value: string): boolean {
  if (value === "." || value === "..") return false
  return !/[\\/]/.test(value)
}

export function userId(): string {
  const raw = process.env["OPENCODE_KB_USER"]?.trim()
  return raw && isSafeUserId(raw) ? raw : "default"
}

export function dataDir(): string {
  const raw = process.env["OPENCODE_KB_DATA_DIR"]?.trim() || "./data"
  return path.resolve(process.cwd(), raw)
}

export function privateRoot(): string {
  return path.join(dataDir(), "users", userId())
}

export function wikiRoot(): string {
  return path.join(dataDir(), "wiki")
}

/** Roots expressed relative to the process CWD (the served project directory). */
export function privateRelative(): string {
  return path.relative(process.cwd(), privateRoot())
}

export function wikiRelative(): string {
  return path.relative(process.cwd(), wikiRoot())
}

/** Virtual roots exposed to the web UI so it never sees the real project path. */
export const VIRTUAL = {
  private: "kb://private/",
  wiki: "kb://wiki/",
} as const

/**
 * Resolve a path to its real physical location, following symlinks. For a path
 * that does not exist yet (e.g. a file about to be written), the deepest
 * existing ancestor is realpath-resolved and the remaining, not-yet-created
 * segments are appended. Those trailing segments cannot themselves be symlinks
 * because they do not exist on disk.
 */
function resolveSafe(target: string): string {
  let current = path.resolve(target)
  const remainder: string[] = []
  while (true) {
    try {
      const real = fs.realpathSync(current)
      return remainder.length ? path.join(real, ...remainder) : real
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return path.join(current, ...remainder)
      remainder.unshift(path.basename(current))
      current = parent
    }
  }
}

function within(root: string, target: string): boolean {
  if (target === root) return true
  return target.startsWith(root + path.sep)
}

/**
 * Returns a human-readable denial reason if the access is NOT allowed, or
 * `undefined` if it is allowed (including when KB mode is disabled).
 */
export function deny(target: string, action: Action): string | undefined {
  if (!enabled()) return undefined

  const resolved = resolveSafe(target)
  const priv = resolveSafe(privateRoot())
  const wiki = resolveSafe(wikiRoot())

  if (within(priv, resolved)) return undefined

  if (within(wiki, resolved)) {
    if (action === "read") return undefined
    return "公开 Wiki 为全局只读，不能写入、修改或删除"
  }

  return "路径超出知识库允许范围（仅允许“我的知识库”与“公开 Wiki”）"
}

/** Throws a clear error when access is denied. No-op when KB mode is off. */
export function assert(target: string, action: Action): void {
  const reason = deny(target, action)
  if (reason) {
    throw new Error(`知识库模式：拒绝${action === "write" ? "写入" : "读取"} ${target}（${reason}）`)
  }
}

/** Permission keys that are always denied in KB mode (no local command execution). */
const BLOCKED_PERMISSIONS = new Set(["bash", "shell", "terminal", "pty", "command", "execute"])

export function isBlockedPermission(permission: string): boolean {
  if (!enabled()) return false
  return BLOCKED_PERMISSIONS.has(permission.toLowerCase())
}

export * as Kb from "./guard"

// Knowledge base mode flag, delivered by the opencode server as <meta> tags on
// the served HTML (see packages/opencode/src/server/shared/ui.ts#injectKbMeta).
// When enabled the web UI hides shell/terminal/MCP/config entry points and marks
// public wiki files read-only. The server enforces all of this regardless; these
// are purely UX affordances.

function meta(name: string): string | undefined {
  if (typeof document === "undefined") return undefined
  const el = document.querySelector(`meta[name="${name}"]`)
  return el?.getAttribute("content") ?? undefined
}

let cached: { enabled: boolean; user: string; privateRoot: string; wikiRoot: string } | undefined

function info() {
  if (cached) return cached
  cached = {
    enabled: meta("opencode-kb-mode") === "1",
    user: meta("opencode-kb-user") ?? "default",
    privateRoot: normalize(meta("opencode-kb-private") ?? "data/users/default"),
    wikiRoot: normalize(meta("opencode-kb-wiki") ?? "data/wiki"),
  }
  return cached
}

function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "")
}

export function kbMode(): boolean {
  return info().enabled
}

export function kbUser(): string {
  return info().user
}

function inRoot(filepath: string, root: string): boolean {
  const p = normalize(filepath)
  return p === root || p.startsWith(root + "/")
}

/** True when the path belongs to the read-only public wiki. */
export function isWikiPath(filepath: string): boolean {
  if (!filepath) return false
  return inRoot(filepath, info().wikiRoot)
}

/** True when the path belongs to the current user's private knowledge base. */
export function isPrivatePath(filepath: string): boolean {
  if (!filepath) return false
  return inRoot(filepath, info().privateRoot)
}

/** In KB mode, wiki files are read-only (no write API exists server-side either). */
export function isReadonlyPath(filepath: string): boolean {
  return kbMode() && isWikiPath(filepath)
}

export function isPrivateRoot(filepath: string): boolean {
  return normalize(filepath) === info().privateRoot
}

export function isWikiRoot(filepath: string): boolean {
  return normalize(filepath) === info().wikiRoot
}

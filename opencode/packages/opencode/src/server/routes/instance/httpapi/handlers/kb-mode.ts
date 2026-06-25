import { Effect } from "effect"
import { Kb } from "@/kb/guard"
import { ForbiddenError } from "../errors"

/**
 * Knowledge base mode server-side guard.
 *
 * Returns an Effect that fails with a 403 ForbiddenError when OPENCODE_KB_MODE
 * is enabled, and is a no-op otherwise. Used to reject high-risk endpoints
 * (shell execution, config mutation, MCP registration, terminal/PTY) even when
 * a client bypasses the web UI and calls the HTTP API directly.
 *
 * Endpoints using this MUST declare `ForbiddenError` in their error union.
 */
export const SHELL_DISABLED_MESSAGE = "Shell is disabled in knowledge base mode."

export function kbForbidden(message = SHELL_DISABLED_MESSAGE) {
  return Kb.enabled() ? Effect.fail(new ForbiddenError({ message })) : Effect.void
}

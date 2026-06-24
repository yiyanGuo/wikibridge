import * as InstanceState from "@/effect/instance-state"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { Effect, Layer, Option } from "effect"
import ignore from "ignore"
import path from "path"
import { Kb } from "@/kb/guard"
import fs from "node:fs/promises"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

// Synthetic top-level nodes for the knowledge base file tree. Each maps a
// friendly, project-path-free label onto a real directory the user is allowed
// to browse. Roots that do not live under the served directory are skipped so
// subsequent relative `list` calls keep resolving correctly.
function kbRoots(directory: string) {
  const entry = (name: string, root: string) => {
    const rel = path.relative(directory, root)
    if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined
    return { name, path: rel, absolute: root, type: "directory" as const, ignored: false }
  }
  return [entry("我的知识库", Kb.privateRoot()), entry("公开 Wiki", Kb.wikiRoot())].filter(
    (item): item is NonNullable<typeof item> => item !== undefined,
  )
}

export const fileHandlers = HttpApiBuilder.group(InstanceHttpApi, "file", (handlers) =>
  Effect.gen(function* () {
    const ripgrep = yield* Ripgrep.Service
    const locations = yield* LocationServiceMap

    const filesystem = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
      return yield* effect.pipe(
        Effect.provide(
          locations.get(Location.Ref.make({ directory: AbsolutePath.make((yield* InstanceState.context).directory) })),
        ),
      )
    })

    const findText = Effect.fn("FileHttpApi.findText")(function* (ctx: { query: { pattern: string } }) {
      if (Kb.enabled()) {
        const privSearch = ripgrep
          .grep({ cwd: Kb.privateRoot(), pattern: ctx.query.pattern, limit: 10 })
          .pipe(
            Effect.map((matches) =>
              matches.map((match) => ({
                path: { text: path.join(Kb.privateRelative(), match.entry.path).replaceAll("\\", "/") },
                lines: { text: match.text },
                line_number: match.line,
                absolute_offset: match.offset,
                submatches: match.submatches.map((submatch) => ({
                  match: { text: submatch.text },
                  start: submatch.start,
                  end: submatch.end,
                })),
              })),
            ),
          )
        const wikiSearch = ripgrep
          .grep({ cwd: Kb.wikiRoot(), pattern: ctx.query.pattern, limit: 10 })
          .pipe(
            Effect.map((matches) =>
              matches.map((match) => ({
                path: { text: path.join(Kb.wikiRelative(), match.entry.path).replaceAll("\\", "/") },
                lines: { text: match.text },
                line_number: match.line,
                absolute_offset: match.offset,
                submatches: match.submatches.map((submatch) => ({
                  match: { text: submatch.text },
                  start: submatch.start,
                  end: submatch.end,
                })),
              })),
            ),
          )
        const [privMatches, wikiMatches] = yield* Effect.all([privSearch, wikiSearch], { concurrency: "unbounded" }).pipe(Effect.orDie)
        return [...privMatches, ...wikiMatches].slice(0, 10)
      }
      return (yield* ripgrep
        .grep({ cwd: (yield* InstanceState.context).directory, pattern: ctx.query.pattern, limit: 10 })
        .pipe(Effect.orDie)).map((match) => ({
        path: { text: match.entry.path },
        lines: { text: match.text },
        line_number: match.line,
        absolute_offset: match.offset,
        submatches: match.submatches.map((submatch) => ({
          match: { text: submatch.text },
          start: submatch.start,
          end: submatch.end,
        })),
      }))
    })

    const findFile = Effect.fn("FileHttpApi.findFile")(function* (ctx: {
      query: { query: string; dirs?: "true" | "false"; type?: "file" | "directory"; limit?: number }
    }) {
      const directory = (yield* InstanceState.context).directory
      const limit = ctx.query.limit ?? 10
      const type = ctx.query.type ?? (ctx.query.dirs === "false" ? "file" : undefined)
      const started = performance.now()
      const searchLimit = Kb.enabled() ? Math.max(limit * 20, 200) : limit
      const found = yield* filesystem(FileSystem.Service.use((fs) => fs.find({ query: ctx.query.query, limit: searchLimit, type })))
      let filtered = found
      if (Kb.enabled()) {
        filtered = found.filter((item) => {
          const absolute = path.resolve(directory, item.path)
          return !Kb.deny(absolute, "read")
        })
      }
      const results = filtered.slice(0, limit)
      yield* Effect.logInfo("find file", {
        query: ctx.query.query,
        type,
        directory,
        limit,
        results: results.length,
        duration: Math.round(performance.now() - started),
      })
      return results.map((item) => item.path)
    })

    const findSymbol = Effect.fn("FileHttpApi.findSymbol")(function* () {
      return []
    })

    const list = Effect.fn("FileHttpApi.list")(function* (ctx: { query: { path: string } }) {
      const directory = (yield* InstanceState.context).directory
      // Knowledge base mode: the file tree only ever exposes two roots — the
      // current user's private knowledge base and the public (read-only) wiki.
      if (Kb.enabled()) {
        const requested = path.resolve(directory, ctx.query.path)
        const denied = Kb.deny(requested, "read")
        if (denied) {
          // The tree's top-level request (project root) is replaced by the two
          // synthetic KB roots; anything else outside the KB is simply empty.
          if (requested === directory) return kbRoots(directory)
          return []
        }
      }
      return yield* filesystem(
        Effect.gen(function* () {
          const fs = yield* FileSystem.Service
          const raw = yield* FSUtil.Service
          const location = yield* Location.Service
          const ignored = ignore()
          const gitignore = yield* raw
            .readFileString(path.join(location.project.directory, ".gitignore"))
            .pipe(Effect.catch(() => Effect.succeed("")))
          if (gitignore) ignored.add(gitignore)
          const ignorefile = yield* raw
            .readFileString(path.join(location.project.directory, ".ignore"))
            .pipe(Effect.catch(() => Effect.succeed("")))
          if (ignorefile) ignored.add(ignorefile)
          return (yield* fs.list({ path: RelativePath.make(ctx.query.path) })).map((item) => ({
            name: path.basename(item.path),
            path: item.path,
            absolute: path.resolve(location.directory, item.path),
            type: item.type,
            ignored: ignored.ignores(
              path.relative(location.project.directory, path.resolve(location.directory, item.path)) +
                (item.type === "directory" ? "/" : ""),
            ),
          }))
        }),
      )
    })

    const content = Effect.fn("FileHttpApi.content")(function* (ctx: { query: { path: string } }) {
      const directory = (yield* InstanceState.context).directory
      const file = path.resolve(directory, ctx.query.path)
      if (!FSUtil.contains(directory, file)) return yield* Effect.die(new Error("Path escapes the location"))
      // Knowledge base mode: only serve file content from the allowed KB roots.
      if (Kb.enabled() && Kb.deny(file, "read")) return yield* Effect.die(new Error("Access denied (knowledge base mode)"))
      if (!(yield* FSUtil.Service.use((fs) => fs.existsSafe(file)))) return { type: "text" as const, content: "" }
      return yield* filesystem(
        FileSystem.Service.use((fs) => fs.read({ path: RelativePath.make(ctx.query.path) })),
      ).pipe(
        Effect.flatMap((item) =>
          Effect.gen(function* () {
            const text = item.content.includes(0)
              ? Option.none<string>()
              : yield* Effect.sync(() => new TextDecoder("utf-8", { fatal: true }).decode(item.content)).pipe(
                  Effect.option,
                )
            return { item, text }
          }),
        ),
        Effect.map(({ item, text }) =>
          Option.isSome(text)
            ? { type: "text" as const, content: text.value.trim() }
            : {
                type: "binary" as const,
                content: Buffer.from(item.content).toString("base64"),
                encoding: "base64" as const,
                mimeType: item.mime,
              },
        ),
      )
    })

    const status = Effect.fn("FileHttpApi.status")(function* () {
      return []
    })

    const write = Effect.fn("FileHttpApi.write")(function* (ctx: {
      payload: { path: string; content: string }
    }) {
      const directory = (yield* InstanceState.context).directory
      const file = path.resolve(directory, ctx.payload.path)
      if (Kb.enabled()) {
        Kb.assert(file, "write")
      }
      yield* Effect.promise(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true })
        await fs.writeFile(file, ctx.payload.content, "utf8")
      })
      return true
    })

    const create = Effect.fn("FileHttpApi.create")(function* (ctx: {
      payload: { path: string }
    }) {
      const directory = (yield* InstanceState.context).directory
      const file = path.resolve(directory, ctx.payload.path)
      if (Kb.enabled()) {
        Kb.assert(file, "write")
      }
      yield* Effect.promise(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true })
        await fs.writeFile(file, "", "utf8")
      })
      return true
    })

    const mkdir = Effect.fn("FileHttpApi.mkdir")(function* (ctx: {
      payload: { path: string }
    }) {
      const directory = (yield* InstanceState.context).directory
      const dir = path.resolve(directory, ctx.payload.path)
      if (Kb.enabled()) {
        Kb.assert(dir, "write")
      }
      yield* Effect.promise(() => fs.mkdir(dir, { recursive: true }))
      return true
    })

    const remove = Effect.fn("FileHttpApi.remove")(function* (ctx: { query: { path: string } }) {
      const directory = (yield* InstanceState.context).directory
      const file = path.resolve(directory, ctx.query.path)
      if (Kb.enabled()) {
        Kb.assert(file, "write")
      }
      yield* Effect.promise(() => fs.rm(file, { recursive: true, force: true }))
      return true
    })

    const rename = Effect.fn("FileHttpApi.rename")(function* (ctx: {
      payload: { oldPath: string; newPath: string }
    }) {
      const directory = (yield* InstanceState.context).directory
      const oldFile = path.resolve(directory, ctx.payload.oldPath)
      const newFile = path.resolve(directory, ctx.payload.newPath)
      if (Kb.enabled()) {
        Kb.assert(oldFile, "write")
        Kb.assert(newFile, "write")
      }
      yield* Effect.promise(async () => {
        await fs.mkdir(path.dirname(newFile), { recursive: true })
        await fs.rename(oldFile, newFile)
      })
      return true
    })

    return handlers
      .handle("findText", findText)
      .handle("findFile", findFile)
      .handle("findSymbol", findSymbol)
      .handle("list", list)
      .handle("content", content)
      .handle("status", status)
      .handle("write", write)
      .handle("create", create)
      .handle("mkdir", mkdir)
      .handle("remove", remove)
      .handle("rename", rename)
  }),
).pipe(Layer.provide(LocationServiceMap.layer))

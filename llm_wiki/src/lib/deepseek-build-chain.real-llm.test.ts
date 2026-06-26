/**
 * Focused real-DeepSeek build-chain test.
 *
 * Gated behind RUN_DEEPSEEK_BUILD_CHAIN=1 because it performs real LLM
 * calls using the WikiBridge Desktop app-state DeepSeek preset.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createTempProject, fileExists, readFileRaw, realFs, writeFileRaw } from "@/test-helpers/fs-temp"

vi.mock("@/commands/fs", () => realFs)

import { autoIngest } from "./ingest"
import { buildWikiGraph } from "./wiki-graph"
import { useWikiStore, type LlmConfig } from "@/stores/wiki-store"
import { useActivityStore } from "@/stores/activity-store"
import { useChatStore } from "@/stores/chat-store"
import { useReviewStore } from "@/stores/review-store"

const ENABLED = process.env.RUN_DEEPSEEK_BUILD_CHAIN === "1"
const TEST_TIMEOUT_MS = 10 * 60 * 1000

interface DeepSeekPreset {
  appStatePath: string
  activePresetId: string | null
  apiKey: string
  model: string
  baseUrl: string
  maxContextSize: number
  apiMode: "chat_completions"
}

let tmp: Awaited<ReturnType<typeof createTempProject>> | undefined

function appStateCandidates(): string[] {
  const home = os.homedir()
  const explicit = [
    process.env.WIKIBRIDGE_LLM_WIKI_APP_STATE,
    process.env.LLM_WIKI_APP_STATE_PATH,
    process.env.API_APP_STATE_PATH,
  ].filter(Boolean) as string[]

  const defaults =
    process.platform === "darwin"
      ? [
          path.join(home, "Library/Application Support/cn.wikibridge.desktop/llm-wiki/app-state.json"),
          path.join(home, "Library/Application Support/com.llmwiki.app/app-state.json"),
          path.join(home, "Library/Application Support/LLM Wiki/app-state.json"),
        ]
      : process.platform === "win32"
        ? [
            path.join(
              process.env.APPDATA ?? path.join(home, "AppData/Roaming"),
              "cn.wikibridge.desktop",
              "llm-wiki",
              "app-state.json",
            ),
            path.join(
              process.env.APPDATA ?? path.join(home, "AppData/Roaming"),
              "com.llmwiki.app",
              "app-state.json",
            ),
          ]
        : [
            path.join(
              process.env.XDG_DATA_HOME ?? path.join(home, ".local/share"),
              "cn.wikibridge.desktop",
              "llm-wiki",
              "app-state.json",
            ),
            path.join(
              process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"),
              "com.llmwiki.app",
              "app-state.json",
            ),
          ]

  return [...new Set([...explicit, ...defaults])]
}

async function loadDeepSeekPreset(): Promise<DeepSeekPreset> {
  for (const candidate of appStateCandidates()) {
    let raw = ""
    try {
      raw = await fs.readFile(candidate, "utf-8")
    } catch {
      continue
    }

    const state = JSON.parse(raw) as Record<string, any>
    const provider = state.providerConfigs?.deepseek ?? {}
    const llmConfig = state.llmConfig ?? {}
    const apiKey = String(provider.apiKey ?? llmConfig.apiKey ?? "")
    const model = String(provider.model ?? llmConfig.model ?? "deepseek-v4-flash")
    const baseUrl = String(provider.baseUrl ?? llmConfig.customEndpoint ?? "https://api.deepseek.com/v1")
      .replace(/\/+$/, "")
    const maxContextSize = Number(provider.maxContextSize ?? llmConfig.maxContextSize ?? 64_000)
    const apiMode = String(provider.apiMode ?? llmConfig.apiMode ?? "chat_completions")

    return {
      appStatePath: candidate,
      activePresetId: typeof state.activePresetId === "string" ? state.activePresetId : null,
      apiKey,
      model,
      baseUrl,
      maxContextSize: Number.isFinite(maxContextSize) && maxContextSize > 0 ? maxContextSize : 64_000,
      apiMode: apiMode === "chat_completions" ? "chat_completions" : "chat_completions",
    }
  }

  throw new Error(
    `No app-state.json found. Checked: ${appStateCandidates().join(", ")}`,
  )
}

async function writeProjectLayout(projectPath: string): Promise<void> {
  await writeFileRaw(
    path.join(projectPath, ".llm-wiki/project.json"),
    JSON.stringify({ id: "deepseek-chain-test", createdAt: Date.now() }, null, 2),
  )
  await writeFileRaw(
    path.join(projectPath, "purpose.md"),
    "# Purpose\n\nValidate a small generated knowledge graph from source documents.\n",
  )
  await writeFileRaw(
    path.join(projectPath, "schema.md"),
    [
      "# Wiki Schema",
      "",
      "Use wiki/concepts/ for reusable ideas and wiki/entities/ for named things.",
      "Use [[wikilinks]] between related pages.",
    ].join("\n"),
  )
  await writeFileRaw(
    path.join(projectPath, "wiki/index.md"),
    "# Wiki Index\n\n## Concepts\n\n## Entities\n",
  )
  await writeFileRaw(
    path.join(projectPath, "wiki/overview.md"),
    "---\ntype: overview\ntitle: Project Overview\ntags: []\nrelated: []\n---\n\n# Overview\n",
  )
  await writeFileRaw(
    path.join(projectPath, "wiki/log.md"),
    "# Research Log\n",
  )
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(full.replace(/\\/g, "/"))
      }
    }
  }
  await walk(path.join(root, "wiki"))
  return out
}

async function pagesContaining(root: string, query: string): Promise<string[]> {
  const needle = query.toLowerCase()
  const hits: string[] = []
  for (const file of await listMarkdownFiles(root)) {
    const content = await fs.readFile(file, "utf-8")
    if (content.toLowerCase().includes(needle)) {
      hits.push(file.slice(root.length + 1))
    }
  }
  return hits
}

function resetStores(projectPath: string, llmConfig: LlmConfig): void {
  useReviewStore.setState({ items: [] })
  useActivityStore.setState({ items: [] })
  useChatStore.setState({
    conversations: [],
    messages: [],
    activeConversationId: null,
    mode: "chat",
    ingestSource: null,
    isStreaming: false,
    streamingContent: "",
  })
  useWikiStore.getState().setProject({
    id: "deepseek-chain-test",
    name: "DeepSeek Chain Test",
    path: projectPath,
    createdAt: Date.now(),
    purposeText: "",
    fileTree: [],
  } as never)
  useWikiStore.getState().setLlmConfig(llmConfig)
  useWikiStore.getState().setActivePresetId("deepseek")
  useWikiStore.getState().setOutputLanguage("English")
  useWikiStore.getState().setEmbeddingConfig({
    enabled: false,
    endpoint: "",
    apiKey: "",
    model: "",
  })
  useWikiStore.getState().setMultimodalConfig({
    enabled: false,
    useMainLlm: true,
    provider: "custom",
    apiKey: "",
    model: "",
    ollamaUrl: "http://localhost:11434",
    customEndpoint: "",
    apiMode: "chat_completions",
    concurrency: 1,
  })
}

afterEach(async () => {
  if (!tmp) return
  if (process.env.KEEP_DEEPSEEK_BUILD_CHAIN_OUTPUT === "1") {
    // eslint-disable-next-line no-console
    console.log(`[deepseek-chain] preserved temp project: ${tmp.path}`)
  } else {
    await tmp.cleanup()
  }
  tmp = undefined
})

describe("DeepSeek LLM Wiki build chain", () => {
  it.skipIf(!ENABLED)(
    "creates a temp wiki from markdown/txt sources and can read/search/graph it",
    async () => {
      const preset = await loadDeepSeekPreset()
      const redacted = {
        appStatePath: preset.appStatePath,
        activePresetId: preset.activePresetId,
        configured: preset.apiKey.trim().length > 0 && preset.activePresetId === "deepseek",
        model: preset.model,
        baseUrl: preset.baseUrl,
        apiMode: preset.apiMode,
      }
      // eslint-disable-next-line no-console
      console.log(`[deepseek-chain] config ${JSON.stringify(redacted)}`)

      expect(preset.activePresetId).toBe("deepseek")
      expect(preset.apiKey.trim(), "DeepSeek API key is missing").not.toBe("")
      expect(preset.baseUrl).toMatch(/^https?:\/\//)

      tmp = await createTempProject("deepseek-build-chain")
      await writeProjectLayout(tmp.path)
      await writeFileRaw(
        path.join(tmp.path, "raw/sources/overview.md"),
        [
          "# Atlas Protocol Overview",
          "",
          "Atlas Protocol coordinates Bridge Relay teams that publish Meridian Index updates.",
          "Bridge Relay depends on the Meridian Index to decide which handoff path is active.",
          "Atlas Protocol treats Beacon Node telemetry as a confirmation signal.",
        ].join("\n"),
      )
      await writeFileRaw(
        path.join(tmp.path, "raw/sources/notes.txt"),
        [
          "Beacon Node field notes",
          "",
          "Beacon Node is operated by the Bridge Relay team.",
          "On 2026-06-24, Beacon Node confirmed the Meridian Index handoff for Atlas Protocol.",
          "This creates a cross-reference between Beacon Node, Bridge Relay, Meridian Index, and Atlas Protocol.",
        ].join("\n"),
      )

      const llmConfig: LlmConfig = {
        provider: "custom",
        apiKey: preset.apiKey,
        model: preset.model,
        ollamaUrl: "http://localhost:11434",
        customEndpoint: preset.baseUrl,
        apiMode: "chat_completions",
        maxContextSize: preset.maxContextSize,
        reasoning: { mode: "off" },
        localCliIsolation: false,
      }
      resetStores(tmp.path, llmConfig)

      const written = [
        ...(await autoIngest(tmp.path, path.join(tmp.path, "raw/sources/overview.md"), llmConfig)),
        ...(await autoIngest(tmp.path, path.join(tmp.path, "raw/sources/notes.txt"), llmConfig)),
      ]
      const uniqueWritten = [...new Set(written)]

      expect(await fileExists(path.join(tmp.path, ".llm-wiki/project.json"))).toBe(true)
      expect(await fileExists(path.join(tmp.path, "raw/sources/overview.md"))).toBe(true)
      expect(await fileExists(path.join(tmp.path, "raw/sources/notes.txt"))).toBe(true)
      expect(
        uniqueWritten.filter((p) => p.startsWith("wiki/") && p.endsWith(".md")).length,
        `written paths: ${uniqueWritten.join(", ")}`,
      ).toBeGreaterThanOrEqual(2)

      const wikiFiles = await listMarkdownFiles(tmp.path)
      expect(wikiFiles.length).toBeGreaterThanOrEqual(2)

      const generatedText = (
        await Promise.all(uniqueWritten.map((p) => readFileRaw(path.join(tmp!.path, p)).catch(() => "")))
      ).join("\n").toLowerCase()
      const keywordHits = ["atlas protocol", "bridge relay", "meridian index", "beacon node"]
        .filter((keyword) => generatedText.includes(keyword))
      expect(keywordHits.length, `keyword hits: ${keywordHits.join(", ")}`).toBeGreaterThanOrEqual(2)

      const graph = await buildWikiGraph(tmp.path)
      expect(graph.nodes.length, "graph should have nodes").toBeGreaterThan(0)
      expect(graph.edges.length, "cross-linked source should produce graph edges").toBeGreaterThan(0)

      const atlasHits = await pagesContaining(tmp.path, "Atlas Protocol")
      const beaconHits = await pagesContaining(tmp.path, "Beacon Node")
      expect(atlasHits.length, "local search/read should find Atlas Protocol").toBeGreaterThan(0)
      expect(beaconHits.length, "local search/read should find Beacon Node").toBeGreaterThan(0)
    },
    TEST_TIMEOUT_MS,
  )
})

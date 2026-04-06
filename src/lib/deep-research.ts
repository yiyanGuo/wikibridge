import { webSearch, type WebSearchResult } from "./web-search"
import { streamChat } from "./llm-client"
import { writeFile } from "@/commands/fs"
import { useWikiStore, type LlmConfig, type SearchApiConfig } from "@/stores/wiki-store"
import { useActivityStore } from "@/stores/activity-store"
import { useChatStore } from "@/stores/chat-store"
import { listDirectory } from "@/commands/fs"

export interface ResearchResult {
  query: string
  webResults: WebSearchResult[]
  synthesis: string
  savedPath: string | null
}

/**
 * Deep Research: search the web for a topic, synthesize findings with LLM, save to wiki.
 * Shows the entire process in the Chat panel.
 */
export async function deepResearch(
  projectPath: string,
  topic: string,
  llmConfig: LlmConfig,
  searchConfig: SearchApiConfig,
): Promise<ResearchResult> {
  const activity = useActivityStore.getState()
  const chat = useChatStore.getState()

  const activityId = activity.addItem({
    type: "query",
    title: `Research: ${topic.slice(0, 50)}`,
    status: "running",
    detail: "Searching the web...",
    filesWritten: [],
  })

  // Switch chat to show the research process
  chat.setMode("chat")
  chat.clearMessages()
  chat.addMessage("system", `🔍 Deep Research: ${topic}`)

  // Make sure chat is visible
  useWikiStore.getState().setActiveView("wiki")

  let webResults: WebSearchResult[] = []
  let synthesis = ""
  let savedPath: string | null = null

  try {
    // Step 1: Web search
    chat.addMessage("system", "Searching the web...")
    webResults = await webSearch(topic, searchConfig, 8)

    if (webResults.length === 0) {
      chat.addMessage("system", "No web results found for this topic.")
      activity.updateItem(activityId, { status: "done", detail: "No results found" })
      return { query: topic, webResults, synthesis: "", savedPath: null }
    }

    // Show search results in chat
    const resultsText = webResults
      .map((r, i) => `**${i + 1}. [${r.title}](${r.url})**\n> ${r.snippet}\n> _${r.source}_`)
      .join("\n\n")

    chat.addMessage("assistant", `Found **${webResults.length} sources**:\n\n${resultsText}`)

    activity.updateItem(activityId, {
      detail: `Found ${webResults.length} results, synthesizing...`,
    })

    // Step 2: LLM synthesizes findings (streamed to chat)
    chat.addMessage("system", "Synthesizing findings...")

    const searchContext = webResults
      .map((r, i) => `[${i + 1}] **${r.title}** (${r.source})\n${r.snippet}`)
      .join("\n\n")

    const systemPrompt = [
      "You are a research assistant. Synthesize the web search results below into a comprehensive wiki page.",
      "",
      "Rules:",
      "- Organize findings into clear sections with headings",
      "- Cite sources using [N] notation matching the search result numbers",
      "- Note any contradictions or gaps in the findings",
      "- Suggest what additional sources might be valuable",
      "- Write in a neutral, encyclopedic tone",
      "- Use [[wikilink]] syntax if referencing concepts that might exist in the wiki",
    ].join("\n")

    const userMessage = [
      `Research topic: **${topic}**`,
      "",
      "## Web Search Results",
      "",
      searchContext,
      "",
      "Please synthesize these findings into a comprehensive wiki page.",
    ].join("\n")

    let accumulated = ""
    chat.setStreaming(true)

    await streamChat(
      llmConfig,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      {
        onToken: (token) => {
          accumulated += token
          useChatStore.getState().appendStreamToken(token)
        },
        onDone: () => {
          useChatStore.getState().finalizeStream(accumulated)
        },
        onError: (err) => {
          useChatStore.getState().finalizeStream(`Research synthesis error: ${err.message}`)
        },
      },
    )

    synthesis = accumulated

    // Step 3: Save to wiki
    if (synthesis && !synthesis.startsWith("Research synthesis error")) {
      activity.updateItem(activityId, { detail: "Saving to wiki..." })

      const date = new Date().toISOString().slice(0, 10)
      const slug = topic
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 50)
      const fileName = `research-${slug}-${date}.md`
      const filePath = `${projectPath}/wiki/queries/${fileName}`

      const references = webResults
        .map((r, i) => `${i + 1}. [${r.title}](${r.url}) — ${r.source}`)
        .join("\n")

      const pageContent = [
        "---",
        `type: query`,
        `title: "Research: ${topic.replace(/"/g, '\\"')}"`,
        `created: ${date}`,
        `origin: deep-research`,
        `tags: [research]`,
        "---",
        "",
        `# Research: ${topic}`,
        "",
        synthesis,
        "",
        "## References",
        "",
        references,
        "",
      ].join("\n")

      await writeFile(filePath, pageContent)
      savedPath = `wiki/queries/${fileName}`

      // Show save confirmation in chat
      useChatStore.getState().addMessage("system", `✅ Saved to wiki: \`${savedPath}\`\n\nReferences:\n${references}`)

      // Refresh tree
      try {
        const tree = await listDirectory(projectPath)
        useWikiStore.getState().setFileTree(tree)
        useWikiStore.getState().bumpDataVersion()
      } catch {
        // ignore
      }
    }

    activity.updateItem(activityId, {
      status: "done",
      detail: `${webResults.length} sources found${savedPath ? ", saved to wiki" : ""}`,
      filesWritten: savedPath ? [savedPath] : [],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    activity.updateItem(activityId, { status: "error", detail: message })
    useChatStore.getState().addMessage("system", `❌ Research failed: ${message}`)
  }

  return { query: topic, webResults, synthesis, savedPath }
}

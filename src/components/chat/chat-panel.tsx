import { useRef, useEffect, useCallback } from "react"
import { BookOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChatMessage, StreamingMessage, useSourceFiles } from "./chat-message"
import { ChatInput } from "./chat-input"
import { useChatStore, chatMessagesToLLM } from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { streamChat, type ChatMessage as LLMMessage } from "@/lib/llm-client"
import { executeIngestWrites } from "@/lib/ingest"
import { listDirectory, readFile } from "@/commands/fs"
import { searchWiki } from "@/lib/search"
import type { FileNode } from "@/types/wiki"

export function ChatPanel() {
  useSourceFiles() // Keep source file cache warm
  const messages = useChatStore((s) => s.messages)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const mode = useChatStore((s) => s.mode)
  const addMessage = useChatStore((s) => s.addMessage)
  const setStreaming = useChatStore((s) => s.setStreaming)
  const appendStreamToken = useChatStore((s) => s.appendStreamToken)
  const finalizeStream = useChatStore((s) => s.finalizeStream)

  const project = useWikiStore((s) => s.project)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const setFileTree = useWikiStore((s) => s.setFileTree)

  const abortRef = useRef<AbortController | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when messages change or streaming content updates
  useEffect(() => {
    const container = scrollContainerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [messages, streamingContent])

  const handleSend = useCallback(
    async (text: string) => {
      addMessage("user", text)
      setStreaming(true)

      // Build system prompt with wiki context: search for relevant pages and include their content
      const systemMessages: LLMMessage[] = []
      if (project) {
        const [index, purpose] = await Promise.all([
          readFile(`${project.path}/wiki/index.md`).catch(() => ""),
          readFile(`${project.path}/purpose.md`).catch(() => ""),
        ])

        // Search wiki using current question + recent conversation context
        const recentContext = useChatStore.getState().messages
          .filter((m) => m.role === "user")
          .slice(-3)
          .map((m) => m.content)
          .join(" ")
        const searchQuery = `${text} ${recentContext}`.slice(0, 500)
        const searchResults = await searchWiki(project.path, searchQuery)

        // Also search with just the current question for precision
        const directResults = await searchWiki(project.path, text)

        // Merge and deduplicate results
        const seenPaths = new Set<string>()
        const mergedResults = [...directResults, ...searchResults].filter((r) => {
          if (seenPaths.has(r.path)) return false
          seenPaths.add(r.path)
          return true
        })

        // Read the full content of top relevant pages (max 10 to fit context)
        const relevantPages: { title: string; path: string; content: string }[] = []
        for (const result of mergedResults.slice(0, 10)) {
          try {
            const content = await readFile(result.path)
            const relativePath = result.path.replace(project.path + "/", "")
            relevantPages.push({ title: result.title, path: relativePath, content })
          } catch {
            // skip unreadable pages
          }
        }

        // If search found nothing, read all wiki pages + raw sources (for small wikis)
        if (relevantPages.length === 0) {
          // Read all wiki pages
          try {
            const wikiTree = await listDirectory(`${project.path}/wiki`)
            const allFiles = flattenMdFiles(wikiTree)
            for (const file of allFiles.slice(0, 15)) {
              try {
                const content = await readFile(file.path)
                const relativePath = file.path.replace(project.path + "/", "")
                const title = file.name.replace(".md", "")
                relevantPages.push({ title, path: relativePath, content })
              } catch {
                // skip
              }
            }
          } catch {
            // ignore
          }
          // Also read raw sources
          try {
            const rawTree = await listDirectory(`${project.path}/raw/sources`)
            const rawFiles = flattenAllFiles(rawTree)
            for (const file of rawFiles.slice(0, 5)) {
              try {
                const content = await readFile(file.path)
                // Truncate large source files to avoid overwhelming context
                const truncated = content.length > 20000
                  ? content.slice(0, 20000) + "\n\n[...truncated...]"
                  : content
                relevantPages.push({
                  title: `[Source] ${file.name}`,
                  path: `raw/sources/${file.name}`,
                  content: truncated,
                })
              } catch {
                // skip
              }
            }
          } catch {
            // ignore
          }
        }

        // Always include matching raw sources in context (search results may include them)
        const rawSourcePaths = relevantPages
          .filter((p) => p.path.startsWith("raw/"))
          .map((p) => p.path)

        // If no raw sources found via search, add them for context
        if (rawSourcePaths.length === 0) {
          try {
            const rawTree = await listDirectory(`${project.path}/raw/sources`)
            const rawFiles = flattenAllFiles(rawTree)
            for (const file of rawFiles.slice(0, 3)) {
              try {
                const content = await readFile(file.path)
                const truncated = content.length > 15000
                  ? content.slice(0, 15000) + "\n\n[...truncated...]"
                  : content
                relevantPages.push({
                  title: `[Source] ${file.name}`,
                  path: `raw/sources/${file.name}`,
                  content: truncated,
                })
              } catch {
                // skip
              }
            }
          } catch {
            // ignore
          }
        }

        // Get source file list
        let sourceFileList = ""
        try {
          const sourceTree = await listDirectory(`${project.path}/raw/sources`)
          const sourceNames = flattenFileNames(sourceTree)
          sourceFileList = sourceNames.length > 0
            ? sourceNames.map((n) => `- ${n}`).join("\n")
            : "(No source files yet)"
        } catch {
          sourceFileList = "(No source files yet)"
        }

        // Build the wiki context with actual page content
        const pagesContext = relevantPages.length > 0
          ? relevantPages.map((p) =>
              `### ${p.title} (${p.path})\n\n${p.content}`
            ).join("\n\n---\n\n")
          : "(No wiki pages found)"

        systemMessages.push({
          role: "system",
          content: [
            "You are a knowledgeable wiki assistant. Answer questions based on the wiki pages and source documents provided below.",
            "",
            "## Rules",
            "- Answer based on the wiki pages AND raw source documents provided below.",
            "- Pages marked [Source] are the user's original uploaded documents — they contain the full detail.",
            "- If the provided pages don't contain enough information, say so honestly.",
            "- Use [[wikilink]] syntax to reference wiki pages you cite.",
            "- At the VERY END of your response, add a hidden comment listing source files used:",
            "  <!-- sources: file1.pdf, file2.md -->",
            "- Use EXACT file names from the Source Files list below.",
            "",
            "Use markdown formatting for clarity.",
            "",
            purpose ? `## Wiki Purpose\n${purpose}` : "",
            `## Source Files\n${sourceFileList}`,
            index ? `## Wiki Index\n${index}` : "",
            `## Relevant Pages & Source Documents (use these to answer)\n\n${pagesContext}`,
          ].filter(Boolean).join("\n"),
        })
      }

      // Only include user and assistant messages in conversation history (not internal system messages)
      const allMessages = useChatStore.getState().messages
        .filter((m) => m.role === "user" || m.role === "assistant")
      const llmMessages = [...systemMessages, ...chatMessagesToLLM(allMessages)]

      const controller = new AbortController()
      abortRef.current = controller

      let accumulated = ""

      await streamChat(
        llmConfig,
        llmMessages,
        {
          onToken: (token) => {
            accumulated += token
            appendStreamToken(token)
          },
          onDone: () => {
            finalizeStream(accumulated)
            abortRef.current = null
          },
          onError: (err) => {
            finalizeStream(`Error: ${err.message}`)
            abortRef.current = null
          },
        },
        controller.signal,
      )
    },
    [llmConfig, addMessage, setStreaming, appendStreamToken, finalizeStream],
  )

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const handleWriteToWiki = useCallback(async () => {
    if (!project) return
    try {
      await executeIngestWrites(project.path, llmConfig, undefined, undefined)
      try {
        const tree = await listDirectory(project.path)
        setFileTree(tree)
      } catch {
        // ignore
      }
    } catch (err) {
      console.error("Failed to write to wiki:", err)
    }
  }, [project, llmConfig, setFileTree])

  const hasAssistantMessages = messages.some((m) => m.role === "assistant")
  const showWriteButton = mode === "ingest" && !isStreaming && hasAssistantMessages

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-3 py-2"
      >
        <div className="flex flex-col gap-3">
          {messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
          {isStreaming && <StreamingMessage content={streamingContent} />}
          <div ref={bottomRef} />
        </div>
      </div>

      {showWriteButton && (
        <div className="border-t px-3 py-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleWriteToWiki}
            className="w-full gap-2"
          >
            <BookOpen className="h-4 w-4" />
            Write to Wiki
          </Button>
        </div>
      )}

      <ChatInput
        onSend={handleSend}
        onStop={handleStop}
        isStreaming={isStreaming}
        placeholder={
          mode === "ingest"
            ? "Discuss the source or ask follow-up questions..."
            : "Type a message..."
        }
      />
    </div>
  )
}

function flattenFileNames(nodes: FileNode[]): string[] {
  const names: string[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      names.push(...flattenFileNames(node.children))
    } else if (!node.is_dir) {
      names.push(node.name)
    }
  }
  return names
}

function flattenMdFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMdFiles(node.children))
    } else if (!node.is_dir && node.name.endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}

function flattenAllFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenAllFiles(node.children))
    } else if (!node.is_dir) {
      files.push(node)
    }
  }
  return files
}

import { writeFile, readFile, createDirectory } from "@/commands/fs"
import type { ReviewItem } from "@/stores/review-store"
import type { DisplayMessage, Conversation } from "@/stores/chat-store"

async function ensureDir(projectPath: string): Promise<void> {
  await createDirectory(`${projectPath}/.llm-wiki`).catch(() => {})
}

export async function saveReviewItems(projectPath: string, items: ReviewItem[]): Promise<void> {
  await ensureDir(projectPath)
  await writeFile(`${projectPath}/.llm-wiki/review.json`, JSON.stringify(items, null, 2))
}

export async function loadReviewItems(projectPath: string): Promise<ReviewItem[]> {
  try {
    const content = await readFile(`${projectPath}/.llm-wiki/review.json`)
    return JSON.parse(content) as ReviewItem[]
  } catch {
    return []
  }
}

interface PersistedChatData {
  conversations: Conversation[]
  messages: DisplayMessage[]
}

export async function saveChatHistory(
  projectPath: string,
  conversations: Conversation[],
  messages: DisplayMessage[]
): Promise<void> {
  await ensureDir(projectPath)
  // Only save last 200 messages to keep file manageable
  const toSave: PersistedChatData = {
    conversations,
    messages: messages.slice(-200),
  }
  await writeFile(`${projectPath}/.llm-wiki/chat-history.json`, JSON.stringify(toSave, null, 2))
}

export async function loadChatHistory(projectPath: string): Promise<PersistedChatData> {
  try {
    const content = await readFile(`${projectPath}/.llm-wiki/chat-history.json`)
    const parsed = JSON.parse(content)

    // Backward compatibility: old format was just an array of messages
    if (Array.isArray(parsed)) {
      const legacyMessages = parsed as DisplayMessage[]
      // Migrate legacy messages into a default conversation
      const defaultConv: Conversation = {
        id: "default",
        title: "Previous Conversations",
        createdAt: legacyMessages[0]?.timestamp ?? Date.now(),
        updatedAt: legacyMessages[legacyMessages.length - 1]?.timestamp ?? Date.now(),
      }
      const migratedMessages = legacyMessages.map((m) => ({
        ...m,
        conversationId: "default",
      }))
      return { conversations: [defaultConv], messages: migratedMessages }
    }

    // New format
    return parsed as PersistedChatData
  } catch {
    return { conversations: [], messages: [] }
  }
}

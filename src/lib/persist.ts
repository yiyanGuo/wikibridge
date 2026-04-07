import { writeFile, readFile, createDirectory } from "@/commands/fs"
import type { ReviewItem } from "@/stores/review-store"
import type { DisplayMessage } from "@/stores/chat-store"

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

export async function saveChatHistory(projectPath: string, messages: DisplayMessage[]): Promise<void> {
  await ensureDir(projectPath)
  // Only save last 100 messages to keep file manageable
  const toSave = messages.slice(-100)
  await writeFile(`${projectPath}/.llm-wiki/chat-history.json`, JSON.stringify(toSave, null, 2))
}

export async function loadChatHistory(projectPath: string): Promise<DisplayMessage[]> {
  try {
    const content = await readFile(`${projectPath}/.llm-wiki/chat-history.json`)
    return JSON.parse(content) as DisplayMessage[]
  } catch {
    return []
  }
}

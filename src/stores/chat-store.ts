import { create } from "zustand"
import type { ChatMessage } from "@/lib/llm-client"

export interface DisplayMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
}

interface ChatState {
  messages: DisplayMessage[]
  isStreaming: boolean
  streamingContent: string
  mode: "chat" | "ingest"
  ingestSource: string | null

  addMessage: (role: DisplayMessage["role"], content: string) => void
  setMessages: (messages: DisplayMessage[]) => void
  setStreaming: (streaming: boolean) => void
  appendStreamToken: (token: string) => void
  finalizeStream: (content: string) => void
  setMode: (mode: ChatState["mode"]) => void
  setIngestSource: (path: string | null) => void
  clearMessages: () => void
}

let messageCounter = 0

function nextId(): string {
  messageCounter += 1
  return String(messageCounter)
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isStreaming: false,
  streamingContent: "",
  mode: "chat",
  ingestSource: null,

  addMessage: (role, content) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: nextId(),
          role,
          content,
          timestamp: Date.now(),
        },
      ],
    })),

  setMessages: (messages) => set({ messages }),

  setStreaming: (isStreaming) => set({ isStreaming }),

  appendStreamToken: (token) =>
    set((state) => ({
      streamingContent: state.streamingContent + token,
    })),

  finalizeStream: (content) =>
    set((state) => ({
      isStreaming: false,
      streamingContent: "",
      messages: [
        ...state.messages,
        {
          id: nextId(),
          role: "assistant" as const,
          content,
          timestamp: Date.now(),
        },
      ],
    })),

  setMode: (mode) => set({ mode }),

  setIngestSource: (ingestSource) => set({ ingestSource }),

  clearMessages: () => set({ messages: [] }),
}))

export function chatMessagesToLLM(messages: DisplayMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))
}

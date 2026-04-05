import { create } from "zustand"
import type { WikiProject, FileNode } from "@/types/wiki"

interface WikiState {
  project: WikiProject | null
  fileTree: FileNode[]
  selectedFile: string | null
  fileContent: string
  chatExpanded: boolean
  activeView: "wiki" | "sources" | "search" | "graph" | "lint" | "settings"

  setProject: (project: WikiProject | null) => void
  setFileTree: (tree: FileNode[]) => void
  setSelectedFile: (path: string | null) => void
  setFileContent: (content: string) => void
  setChatExpanded: (expanded: boolean) => void
  setActiveView: (view: WikiState["activeView"]) => void
}

export const useWikiStore = create<WikiState>((set) => ({
  project: null,
  fileTree: [],
  selectedFile: null,
  fileContent: "",
  chatExpanded: false,
  activeView: "wiki",

  setProject: (project) => set({ project }),
  setFileTree: (fileTree) => set({ fileTree }),
  setSelectedFile: (selectedFile) => set({ selectedFile }),
  setFileContent: (fileContent) => set({ fileContent }),
  setChatExpanded: (chatExpanded) => set({ chatExpanded }),
  setActiveView: (activeView) => set({ activeView }),
}))

export type { WikiState }

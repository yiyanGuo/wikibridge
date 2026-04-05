import { useCallback, useEffect } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { listDirectory } from "@/commands/fs"
import { IconSidebar } from "./icon-sidebar"
import { FileTree } from "./file-tree"
import { ContentArea } from "./content-area"

export function AppLayout() {
  const project = useWikiStore((s) => s.project)
  const setFileTree = useWikiStore((s) => s.setFileTree)

  const loadFileTree = useCallback(async () => {
    if (!project) return
    try {
      const tree = await listDirectory(project.path)
      setFileTree(tree)
    } catch (err) {
      console.error("Failed to load file tree:", err)
    }
  }, [project, setFileTree])

  useEffect(() => { loadFileTree() }, [loadFileTree])

  return (
    <div className="flex h-screen bg-background text-foreground">
      <IconSidebar />
      <div className="flex flex-1 overflow-hidden">
        <div className="w-60 border-r">
          <FileTree />
        </div>
        <div className="flex-1">
          <ContentArea />
        </div>
      </div>
    </div>
  )
}

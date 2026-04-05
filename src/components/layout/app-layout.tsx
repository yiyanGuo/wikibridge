import { useCallback, useEffect, useRef, useState } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { listDirectory } from "@/commands/fs"
import { IconSidebar } from "./icon-sidebar"
import { FileTree } from "./file-tree"
import { ContentArea } from "./content-area"
import { PreviewPanel } from "./preview-panel"
import { ActivityPanel } from "./activity-panel"

interface AppLayoutProps {
  onSwitchProject: () => void
}

export function AppLayout({ onSwitchProject }: AppLayoutProps) {
  const project = useWikiStore((s) => s.project)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const [leftWidth, setLeftWidth] = useState(220)
  const [rightWidth, setRightWidth] = useState(400)
  const isDraggingLeft = useRef(false)
  const isDraggingRight = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const loadFileTree = useCallback(async () => {
    if (!project) return
    try {
      const tree = await listDirectory(project.path)
      setFileTree(tree)
    } catch (err) {
      console.error("Failed to load file tree:", err)
    }
  }, [project, setFileTree])

  useEffect(() => {
    loadFileTree()
  }, [loadFileTree])

  const startDrag = useCallback(
    (side: "left" | "right") => (e: React.MouseEvent) => {
      e.preventDefault()
      if (side === "left") isDraggingLeft.current = true
      else isDraggingRight.current = true
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"

      const handleMouseMove = (e: MouseEvent) => {
        if (!containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()

        if (isDraggingLeft.current) {
          const newWidth = e.clientX - rect.left
          setLeftWidth(Math.max(150, Math.min(rect.width * 0.3, newWidth)))
        }
        if (isDraggingRight.current) {
          const newWidth = rect.right - e.clientX
          setRightWidth(Math.max(250, Math.min(rect.width * 0.5, newWidth)))
        }
      }

      const handleMouseUp = () => {
        isDraggingLeft.current = false
        isDraggingRight.current = false
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
      }

      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
    },
    []
  )

  return (
    <div className="flex h-screen bg-background text-foreground">
      <IconSidebar onSwitchProject={onSwitchProject} />
      <div ref={containerRef} className="flex min-w-0 flex-1 overflow-hidden">
        {/* Left: File tree + Activity */}
        <div
          className="flex shrink-0 flex-col overflow-hidden border-r"
          style={{ width: leftWidth }}
        >
          <div className="flex-1 overflow-hidden">
            <FileTree />
          </div>
          <ActivityPanel />
        </div>
        <div
          className="w-1.5 shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-primary/30 active:bg-primary/40"
          onMouseDown={startDrag("left")}
        />

        {/* Center: Chat or view (sources/settings/review) */}
        <div className="min-w-0 flex-1 overflow-hidden">
          <ContentArea />
        </div>

        {/* Right: File preview (shown when a file is selected) */}
        {selectedFile && (
          <>
            <div
              className="w-1.5 shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-primary/30 active:bg-primary/40"
              onMouseDown={startDrag("right")}
            />
            <div
              className="shrink-0 overflow-hidden border-l"
              style={{ width: rightWidth }}
            >
              <PreviewPanel />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { IconSidebar } from "./icon-sidebar"
import { SidebarPanel } from "./sidebar-panel"
import { ContentArea } from "./content-area"
import { PreviewPanel } from "./preview-panel"
import { ResearchPanel } from "./research-panel"
import { ActivityPanel } from "./activity-panel"
import { useResearchStore } from "@/stores/research-store"

interface AppLayoutProps {
  onSwitchProject: () => void
}

export function AppLayout({ onSwitchProject }: AppLayoutProps) {
  const project = useWikiStore((s) => s.project)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const researchPanelOpen = useResearchStore((s) => s.panelOpen)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const [leftWidth, setLeftWidth] = useState(220)
  const [rightWidth, setRightWidth] = useState(400)
  const isDraggingLeft = useRef(false)
  const isDraggingRight = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const loadFileTree = useCallback(async () => {
    if (!project) return
    try {
      const tree = await listDirectory(normalizePath(project.path))
      setFileTree(tree)
    } catch (err) {
      console.error("Failed to load file tree:", err)
    }
  }, [project, setFileTree])

  useEffect(() => {
    loadFileTree()
  }, [loadFileTree])

  // Use refs to track latest widths so drag handler always reads fresh values
  const leftWidthRef = useRef(leftWidth)
  const rightWidthRef = useRef(rightWidth)
  leftWidthRef.current = leftWidth
  rightWidthRef.current = rightWidth

  const startDrag = useCallback(
    (side: "left" | "right") => (e: React.MouseEvent) => {
      e.preventDefault()
      if (side === "left") isDraggingLeft.current = true
      else isDraggingRight.current = true
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"

      const handleMouseMove = (e: MouseEvent) => {
        if (!containerRef.current) return
        const totalWidth = containerRef.current.getBoundingClientRect().width
        const minCenter = 300
        // Account for drag handles (~6px total)
        const handles = 6

        if (isDraggingLeft.current) {
          const newWidth = e.clientX - containerRef.current.getBoundingClientRect().left
          const maxLeft = totalWidth - rightWidthRef.current - minCenter - handles
          setLeftWidth(Math.max(150, Math.min(maxLeft, newWidth)))
        }
        if (isDraggingRight.current) {
          const newWidth = containerRef.current.getBoundingClientRect().right - e.clientX
          const maxRight = totalWidth - leftWidthRef.current - minCenter - handles
          setRightWidth(Math.max(250, Math.min(maxRight, newWidth)))
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
            <SidebarPanel />
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

        {/* Right panels */}
        {(selectedFile || researchPanelOpen) && (
          <>
            <div
              className="w-1.5 shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-primary/30 active:bg-primary/40"
              onMouseDown={startDrag("right")}
            />
            <div
              className="flex shrink-0 flex-col overflow-hidden border-l"
              style={{ width: rightWidth }}
            >
              {/* File preview on top (if file selected) */}
              {selectedFile && (
                <div className={researchPanelOpen ? "flex-1 overflow-hidden border-b" : "flex-1 overflow-hidden"}>
                  <PreviewPanel />
                </div>
              )}
              {/* Research panel on bottom (if open) */}
              {researchPanelOpen && (
                <div className={selectedFile ? "h-1/2 shrink-0 overflow-hidden" : "flex-1 overflow-hidden"}>
                  <ResearchPanel />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

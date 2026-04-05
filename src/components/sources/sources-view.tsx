import { useState, useEffect, useCallback } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { Plus, FileText, RefreshCw, BookOpen, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useWikiStore } from "@/stores/wiki-store"
import { copyFile, listDirectory, readFile, writeFile, deleteFile, findRelatedWikiPages } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { startIngest, autoIngest } from "@/lib/ingest"

export function SourcesView() {
  const project = useWikiStore((s) => s.project)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const setChatExpanded = useWikiStore((s) => s.setChatExpanded)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const [sources, setSources] = useState<FileNode[]>([])
  const [importing, setImporting] = useState(false)
  const [ingestingPath, setIngestingPath] = useState<string | null>(null)

  const loadSources = useCallback(async () => {
    if (!project) return
    try {
      const tree = await listDirectory(`${project.path}/raw/sources`)
      const files = flattenFiles(tree)
      setSources(files)
    } catch {
      setSources([])
    }
  }, [project])

  useEffect(() => {
    loadSources()
  }, [loadSources])

  async function handleImport() {
    if (!project) return

    const selected = await open({
      multiple: true,
      title: "Import Source Files",
      filters: [
        {
          name: "Documents",
          extensions: [
            "md", "mdx", "txt", "rtf", "pdf",
            "html", "htm", "xml",
            "doc", "docx", "xls", "xlsx", "ppt", "pptx",
            "odt", "ods", "odp", "epub", "pages", "numbers", "key",
          ],
        },
        {
          name: "Data",
          extensions: ["json", "jsonl", "csv", "tsv", "yaml", "yml", "ndjson"],
        },
        {
          name: "Code",
          extensions: [
            "py", "js", "ts", "jsx", "tsx", "rs", "go", "java",
            "c", "cpp", "h", "rb", "php", "swift", "sql", "sh",
          ],
        },
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tiff", "avif", "heic"],
        },
        {
          name: "Media",
          extensions: ["mp4", "webm", "mov", "avi", "mkv", "mp3", "wav", "ogg", "flac", "m4a"],
        },
        { name: "All Files", extensions: ["*"] },
      ],
    })

    if (!selected || selected.length === 0) return

    setImporting(true)
    const paths = Array.isArray(selected) ? selected : [selected]

    for (const sourcePath of paths) {
      const fileName = sourcePath.split("/").pop() || sourcePath.split("\\").pop() || "unknown"
      const destPath = `${project.path}/raw/sources/${fileName}`
      try {
        await copyFile(sourcePath, destPath)
      } catch (err) {
        console.error(`Failed to import ${fileName}:`, err)
      }
    }

    setImporting(false)
    await loadSources()

    // Auto-ingest each imported file (runs in background, progress shown in activity panel)
    if (llmConfig.apiKey || llmConfig.provider === "ollama") {
      for (const sourcePath of paths) {
        const fileName = sourcePath.split("/").pop() || sourcePath.split("\\").pop() || "unknown"
        const destPath = `${project.path}/raw/sources/${fileName}`
        autoIngest(project.path, destPath, llmConfig).catch((err) =>
          console.error(`Failed to auto-ingest ${fileName}:`, err)
        )
      }
    }
  }

  async function handleOpenSource(node: FileNode) {
    setActiveView("wiki")
    setSelectedFile(node.path)
    try {
      const content = await readFile(node.path)
      setFileContent(content)
    } catch (err) {
      console.error("Failed to read source:", err)
    }
  }

  async function handleDelete(node: FileNode) {
    if (!project) return
    const fileName = node.name
    const confirmed = window.confirm(
      `Delete "${fileName}" and its related wiki pages?\n\nThis will:\n- Delete the source file\n- Delete wiki pages generated from this source\n- Update index.md`
    )
    if (!confirmed) return

    try {
      // Find related wiki pages before deleting
      const relatedPages = await findRelatedWikiPages(project.path, fileName)

      // Delete the source file
      await deleteFile(node.path)

      // Delete related wiki pages
      for (const pagePath of relatedPages) {
        try {
          await deleteFile(pagePath)
        } catch (err) {
          console.error(`Failed to delete wiki page ${pagePath}:`, err)
        }
      }

      // Remove entries from index.md that reference deleted pages
      if (relatedPages.length > 0) {
        try {
          const indexPath = `${project.path}/wiki/index.md`
          const indexContent = await readFile(indexPath)
          const deletedSlugs = relatedPages.map((p) => {
            const name = p.split("/").pop()?.replace(".md", "") ?? ""
            return name
          })
          const updatedIndex = indexContent
            .split("\n")
            .filter((line) => !deletedSlugs.some((slug) => slug && line.toLowerCase().includes(slug)))
            .join("\n")
          await writeFile(indexPath, updatedIndex)
        } catch {
          // index update failure is non-critical
        }
      }

      // Refresh
      await loadSources()
      const tree = await listDirectory(project.path)
      setFileTree(tree)

      // Clear selected file if it was the deleted one
      if (selectedFile === node.path || relatedPages.includes(selectedFile ?? "")) {
        setSelectedFile(null)
      }
    } catch (err) {
      console.error("Failed to delete source:", err)
      window.alert(`Failed to delete: ${err}`)
    }
  }

  async function handleIngest(node: FileNode) {
    if (!project || ingestingPath) return
    setIngestingPath(node.path)
    try {
      setChatExpanded(true)
      setActiveView("wiki")
      await startIngest(project.path, node.path, llmConfig)
    } catch (err) {
      console.error("Failed to start ingest:", err)
    } finally {
      setIngestingPath(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Raw Sources</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={loadSources} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={handleImport} disabled={importing}>
            <Plus className="mr-1 h-4 w-4" />
            {importing ? "Importing..." : "Import"}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
            <p>No sources yet</p>
            <p>Import documents to start building your wiki</p>
            <Button variant="outline" size="sm" onClick={handleImport}>
              <Plus className="mr-1 h-4 w-4" />
              Import Files
            </Button>
          </div>
        ) : (
          <div className="p-2">
            {sources.map((source) => (
              <div
                key={source.path}
                className="flex w-full items-center gap-1 rounded-md px-1 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <button
                  onClick={() => handleOpenSource(source)}
                  className="flex flex-1 items-center gap-2 truncate px-2 py-1 text-left"
                >
                  <FileText className="h-4 w-4 shrink-0" />
                  <span className="truncate">{source.name}</span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  title="Ingest into wiki"
                  disabled={ingestingPath === source.path}
                  onClick={() => handleIngest(source)}
                >
                  <BookOpen className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  title="Delete source and related wiki pages"
                  onClick={() => handleDelete(source)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="border-t px-4 py-2 text-xs text-muted-foreground">
        {sources.length} source{sources.length !== 1 ? "s" : ""}
      </div>
    </div>
  )
}

function flattenFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenFiles(node.children))
    } else if (!node.is_dir) {
      files.push(node)
    }
  }
  return files
}

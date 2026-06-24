/**
 * B端 Wiki 浏览视图
 * 显示知识库中的 Wiki 页面，支持阅读和导航
 */

import { useState, useEffect, useCallback } from "react"
import { FileText, Search, ChevronRight, BookOpen } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { listDirectory, readFile } from "@/commands/fs"
import { WikiReader } from "@/components/editor/wiki-reader"
import type { FileNode } from "@/types/wiki"

interface WikiPageInfo {
  path: string
  name: string
  title: string
  type: string
}

function flattenMd(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir) {
      files.push(...flattenMd(node.children ?? []))
    } else if (node.name.endsWith('.md')) {
      files.push(node)
    }
  }
  return files
}

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m)
  if (match) return match[1].trim()
  const fm = content.match(/^---\n[\s\S]*?\ntitle:\s*(.+?)\n/m)
  if (fm) return fm[1].trim()
  return ''
}

function extractType(content: string): string {
  const fm = content.match(/^---\n[\s\S]*?\ntype:\s*(.+?)\n/m)
  return fm ? fm[1].trim() : 'unknown'
}

const TYPE_LABELS: Record<string, string> = {
  overview: '概览',
  entity: '实体',
  concept: '概念',
  source: '来源',
  query: '问题',
  comparison: '对比',
  synthesis: '综合',
}

export function BWikiView() {
  const project = useWikiStore((s) => s.project)
  const [pages, setPages] = useState<WikiPageInfo[]>([])
  const [selectedPage, setSelectedPage] = useState<WikiPageInfo | null>(null)
  const [pageContent, setPageContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  const loadPages = useCallback(async () => {
    if (!project) return
    setLoading(true)
    try {
      const wikiTree = await listDirectory(`${project.path}/wiki`)
      const mdFiles = flattenMd(wikiTree)

      const pageInfos: WikiPageInfo[] = []
      for (const file of mdFiles) {
        try {
          const content = await readFile(file.path)
          pageInfos.push({
            path: file.path,
            name: file.name.replace('.md', ''),
            title: extractTitle(content) || file.name.replace('.md', ''),
            type: extractType(content),
          })
        } catch {
          pageInfos.push({
            path: file.path,
            name: file.name.replace('.md', ''),
            title: file.name.replace('.md', ''),
            type: 'unknown',
          })
        }
      }

      setPages(pageInfos)
      // Auto-select overview or first page
      const overview = pageInfos.find(p => p.type === 'overview')
      if (overview) {
        await selectPage(overview)
      } else if (pageInfos.length > 0) {
        await selectPage(pageInfos[0])
      }
    } catch (error) {
      console.error("加载 Wiki 页面失败:", error)
    } finally {
      setLoading(false)
    }
  }, [project])

  const selectPage = async (page: WikiPageInfo) => {
    setSelectedPage(page)
    try {
      const content = await readFile(page.path)
      setPageContent(content)
    } catch (error) {
      console.error("读取页面失败:", error)
      setPageContent('# 读取失败\n\n无法加载此页面内容。')
    }
  }

  useEffect(() => {
    loadPages()
  }, [loadPages])

  const filteredPages = pages.filter(p =>
    p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const groupedPages = filteredPages.reduce((acc, page) => {
    const type = page.type || 'other'
    if (!acc[type]) acc[type] = []
    acc[type].push(page)
    return acc
  }, {} as Record<string, WikiPageInfo[]>)

  const typeOrder = ['overview', 'entity', 'concept', 'source', 'query', 'comparison', 'synthesis', 'other']

  return (
    <div className="flex h-full">
      {/* 左侧页面列表 */}
      <div className="w-72 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-bold text-foreground mb-3 flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Wiki 页面
          </h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索页面..."
              className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              加载中...
            </div>
          ) : filteredPages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <FileText className="h-8 w-8 mb-2 opacity-50" />
              <div className="text-sm">暂无 Wiki 页面</div>
            </div>
          ) : (
            <div className="space-y-3">
              {typeOrder.map(type => {
                const typePages = groupedPages[type]
                if (!typePages || typePages.length === 0) return null
                return (
                  <div key={type}>
                    <div className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase">
                      {TYPE_LABELS[type] || type}
                    </div>
                    <div className="space-y-0.5">
                      {typePages.map(page => (
                        <button
                          key={page.path}
                          onClick={() => selectPage(page)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                            selectedPage?.path === page.path
                              ? 'bg-primary/10 text-primary font-medium'
                              : 'text-foreground hover:bg-accent'
                          }`}
                        >
                          <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="truncate">{page.title}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-border text-xs text-muted-foreground">
          共 {pages.length} 个页面
        </div>
      </div>

      {/* 右侧内容区 */}
      <div className="flex-1 overflow-auto">
        {selectedPage ? (
          <div className="p-8 max-w-4xl mx-auto">
            <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
              <BookOpen className="h-4 w-4" />
              <span>{selectedPage.title}</span>
              <ChevronRight className="h-3 w-3" />
              <span className="font-mono text-xs">{selectedPage.name}</span>
            </div>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <WikiReader body={pageContent} filePath={selectedPage.path} />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <div>选择一个页面开始阅读</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

import { readFile, listDirectory } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"

export interface SearchResult {
  path: string
  title: string
  snippet: string
  titleMatch: boolean
}

const MAX_RESULTS = 20
const SNIPPET_CONTEXT = 80

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

function extractTitle(content: string, fileName: string): string {
  // Try YAML frontmatter title
  const frontmatterMatch = content.match(/^---\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m)
  if (frontmatterMatch) return frontmatterMatch[1].trim()

  // Try first heading
  const headingMatch = content.match(/^#\s+(.+)$/m)
  if (headingMatch) return headingMatch[1].trim()

  // Fall back to filename
  return fileName.replace(/\.md$/, "").replace(/-/g, " ")
}

function buildSnippet(content: string, query: string): string {
  const lower = content.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const idx = lower.indexOf(lowerQuery)
  if (idx === -1) return content.slice(0, SNIPPET_CONTEXT * 2).replace(/\n/g, " ")

  const start = Math.max(0, idx - SNIPPET_CONTEXT)
  const end = Math.min(content.length, idx + query.length + SNIPPET_CONTEXT)
  let snippet = content.slice(start, end).replace(/\n/g, " ")
  if (start > 0) snippet = "..." + snippet
  if (end < content.length) snippet = snippet + "..."
  return snippet
}

export async function searchWiki(
  projectPath: string,
  query: string,
): Promise<SearchResult[]> {
  if (!query.trim()) return []

  const lowerQuery = query.toLowerCase()
  const titleMatches: SearchResult[] = []
  const contentMatches: SearchResult[] = []

  // Search wiki pages
  try {
    const wikiTree = await listDirectory(`${projectPath}/wiki`)
    const wikiFiles = flattenMdFiles(wikiTree)
    await searchFiles(wikiFiles, lowerQuery, query, titleMatches, contentMatches)
  } catch {
    // no wiki directory
  }

  // Also search raw sources (extracted text)
  try {
    const rawTree = await listDirectory(`${projectPath}/raw/sources`)
    const rawFiles = flattenAllFiles(rawTree)
    await searchFiles(rawFiles, lowerQuery, query, titleMatches, contentMatches)
  } catch {
    // no raw sources
  }

  return [...titleMatches, ...contentMatches].slice(0, MAX_RESULTS)
}

async function searchFiles(
  files: FileNode[],
  lowerQuery: string,
  query: string,
  titleMatches: SearchResult[],
  contentMatches: SearchResult[],
): Promise<void> {
  for (const file of files) {
    let content = ""
    try {
      content = await readFile(file.path)
    } catch {
      continue
    }

    const title = extractTitle(content, file.name)
    const titleLower = title.toLowerCase()
    const fileNameLower = file.name.toLowerCase()
    const contentLower = content.toLowerCase()

    const matchesTitle =
      titleLower.includes(lowerQuery) || fileNameLower.includes(lowerQuery)
    const matchesContent = contentLower.includes(lowerQuery)

    if (!matchesTitle && !matchesContent) continue

    const snippet = buildSnippet(content, query)
    const result: SearchResult = {
      path: file.path,
      title,
      snippet,
      titleMatch: matchesTitle,
    }

    if (matchesTitle) {
      titleMatches.push(result)
    } else {
      contentMatches.push(result)
    }
  }
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

import { useEffect, useCallback, useState } from "react"
import Graph from "graphology"
import { SigmaContainer, useLoadGraph, useRegisterEvents, useSigma } from "@react-sigma/core"
import "@react-sigma/core/lib/style.css"
import forceAtlas2 from "graphology-layout-forceatlas2"
import { Network, RefreshCw } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile } from "@/commands/fs"
import { buildWikiGraph, type GraphNode, type GraphEdge } from "@/lib/wiki-graph"

const NODE_TYPE_COLORS: Record<string, string> = {
  entity: "#3b82f6",    // blue
  concept: "#a855f7",   // purple
  source: "#f97316",    // orange
  query: "#22c55e",     // green
  synthesis: "#ef4444", // red
  overview: "#eab308",  // yellow
  other: "#9ca3af",     // gray
}

const NODE_TYPE_LABELS: Record<string, string> = {
  entity: "Entity",
  concept: "Concept",
  source: "Source",
  query: "Query",
  synthesis: "Synthesis",
  overview: "Overview",
  other: "Other",
}

const BASE_NODE_SIZE = 6
const MAX_NODE_SIZE = 24

function nodeColor(type: string): string {
  return NODE_TYPE_COLORS[type] ?? NODE_TYPE_COLORS.other
}

function nodeSize(linkCount: number, maxLinks: number): number {
  if (maxLinks === 0) return BASE_NODE_SIZE
  const ratio = linkCount / maxLinks
  return BASE_NODE_SIZE + ratio * (MAX_NODE_SIZE - BASE_NODE_SIZE)
}

// --- Inner components that use sigma hooks (must be children of SigmaContainer) ---

interface GraphLoaderProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

function GraphLoader({ nodes, edges }: GraphLoaderProps) {
  const loadGraph = useLoadGraph()

  useEffect(() => {
    const graph = new Graph()
    const maxLinks = Math.max(...nodes.map((n) => n.linkCount), 0)

    for (const node of nodes) {
      graph.addNode(node.id, {
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: nodeSize(node.linkCount, maxLinks),
        color: nodeColor(node.type),
        label: node.label,
        nodeType: node.type,
        nodePath: node.path,
      })
    }

    for (const edge of edges) {
      if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
        graph.addEdge(edge.source, edge.target, {
          color: "#e5e7eb",
          size: 1,
        })
      }
    }

    // Run ForceAtlas2 layout for positioning
    if (nodes.length > 1) {
      forceAtlas2.assign(graph, {
        iterations: 100,
        settings: forceAtlas2.inferSettings(graph),
      })
    }

    loadGraph(graph)
  }, [loadGraph, nodes, edges])

  return null
}

interface EventHandlerProps {
  onNodeClick: (nodeId: string) => void
}

function EventHandler({ onNodeClick }: EventHandlerProps) {
  const registerEvents = useRegisterEvents()
  const sigma = useSigma()

  useEffect(() => {
    registerEvents({
      clickNode: ({ node }) => {
        onNodeClick(node)
      },
      enterNode: ({ node }) => {
        const container = sigma.getContainer()
        container.style.cursor = "pointer"
        // Highlight node on hover
        sigma.getGraph().setNodeAttribute(node, "highlighted", true)
        sigma.refresh()
      },
      leaveNode: ({ node }) => {
        const container = sigma.getContainer()
        container.style.cursor = "default"
        sigma.getGraph().setNodeAttribute(node, "highlighted", false)
        sigma.refresh()
      },
    })
  }, [registerEvents, sigma, onNodeClick])

  return null
}

// --- Main GraphView component ---

export function GraphView() {
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setActiveView = useWikiStore((s) => s.setActiveView)

  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadGraph = useCallback(async () => {
    if (!project) return
    setLoading(true)
    setError(null)
    try {
      const result = await buildWikiGraph(project.path)
      setNodes(result.nodes)
      setEdges(result.edges)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to build graph"
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [project])

  // Always load fresh data when component mounts (user switches to Graph view)
  useEffect(() => {
    loadGraph()
  }, [loadGraph])

  const handleNodeClick = useCallback(
    async (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return
      try {
        const content = await readFile(node.path)
        setSelectedFile(node.path)
        setFileContent(content)
        setActiveView("wiki")
      } catch (err) {
        console.error("Failed to open wiki page:", err)
      }
    },
    [nodes, setSelectedFile, setFileContent, setActiveView],
  )

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Network className="h-10 w-10 opacity-30" />
        <p className="text-sm">Open a project to view the graph</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <RefreshCw className="h-8 w-8 animate-spin opacity-50" />
        <p className="text-sm">Building graph...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Network className="h-10 w-10 opacity-30" />
        <p className="text-sm text-destructive">{error}</p>
        <button
          type="button"
          onClick={loadGraph}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!loading && nodes.length === 0 && !error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Network className="h-10 w-10 opacity-30" />
        <p className="text-sm">No pages yet</p>
        <p className="text-xs">Create some wiki pages to see the graph</p>
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2 shrink-0">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Graph</span>
          <span className="text-xs text-muted-foreground">
            {nodes.length} node{nodes.length !== 1 ? "s" : ""},{" "}
            {edges.length} edge{edges.length !== 1 ? "s" : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={loadGraph}
          title="Reload graph"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Reload
        </button>
      </div>

      {/* Graph canvas */}
      <div className="relative flex-1 overflow-hidden">
        <SigmaContainer
          style={{ width: "100%", height: "100%", background: "transparent" }}
          settings={{
            renderEdgeLabels: false,
            defaultEdgeColor: "#e5e7eb",
            defaultNodeColor: "#9ca3af",
            labelSize: 12,
            labelWeight: "normal",
            labelColor: { color: "var(--foreground, #111827)" },
            nodeReducer: (_node, attrs) => ({
              ...attrs,
              highlighted: attrs.highlighted ?? false,
            }),
          }}
        >
          <GraphLoader nodes={nodes} edges={edges} />
          <EventHandler onNodeClick={handleNodeClick} />
        </SigmaContainer>

        {/* Legend */}
        <GraphLegend />
      </div>
    </div>
  )
}

function GraphLegend() {
  const usedTypes = Object.entries(NODE_TYPE_LABELS)

  return (
    <div className="absolute bottom-4 right-4 rounded-lg border bg-background/90 backdrop-blur-sm px-3 py-2 text-xs shadow-sm">
      <div className="mb-1.5 font-medium text-muted-foreground">Node types</div>
      <div className="flex flex-col gap-1">
        {usedTypes.map(([type, label]) => (
          <div key={type} className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: NODE_TYPE_COLORS[type] }}
            />
            <span className="text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

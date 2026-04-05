import {
  FileText, FolderOpen, Search, Network, ClipboardCheck, Settings,
} from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useWikiStore } from "@/stores/wiki-store"
import type { WikiState } from "@/stores/wiki-store"

const navItems: { view: WikiState["activeView"]; icon: typeof FileText; label: string }[] = [
  { view: "wiki", icon: FileText, label: "Wiki" },
  { view: "sources", icon: FolderOpen, label: "Sources" },
  { view: "search", icon: Search, label: "Search" },
  { view: "graph", icon: Network, label: "Graph" },
  { view: "lint", icon: ClipboardCheck, label: "Lint" },
  { view: "settings", icon: Settings, label: "Settings" },
]

export function IconSidebar() {
  const activeView = useWikiStore((s) => s.activeView)
  const setActiveView = useWikiStore((s) => s.setActiveView)

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full w-12 flex-col items-center gap-1 border-r bg-muted/50 py-2">
        {navItems.map(({ view, icon: Icon, label }) => (
          <Tooltip key={view}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setActiveView(view)}
                className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                  activeView === view
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  )
}

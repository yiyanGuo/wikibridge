import { FolderOpen, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"

interface WelcomeScreenProps {
  onCreateProject: () => void
  onOpenProject: () => void
}

export function WelcomeScreen({ onCreateProject, onOpenProject }: WelcomeScreenProps) {
  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6">
        <h1 className="text-3xl font-bold">LLM Wiki</h1>
        <p className="text-muted-foreground">
          Build and maintain your personal knowledge base with LLMs
        </p>
        <div className="flex gap-3">
          <Button onClick={onCreateProject}>
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Button>
          <Button variant="outline" onClick={onOpenProject}>
            <FolderOpen className="mr-2 h-4 w-4" />
            Open Project
          </Button>
        </div>
      </div>
    </div>
  )
}

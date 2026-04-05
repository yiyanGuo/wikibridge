import { useState } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { listDirectory, openProject } from "@/commands/fs"
import { AppLayout } from "@/components/layout/app-layout"
import { WelcomeScreen } from "@/components/project/welcome-screen"
import { CreateProjectDialog } from "@/components/project/create-project-dialog"
import type { WikiProject } from "@/types/wiki"

function App() {
  const project = useWikiStore((s) => s.project)
  const setProject = useWikiStore((s) => s.setProject)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const [showCreateDialog, setShowCreateDialog] = useState(false)

  async function handleProjectOpened(proj: WikiProject) {
    setProject(proj)
    try {
      const tree = await listDirectory(proj.path)
      setFileTree(tree)
    } catch (err) {
      console.error("Failed to load file tree:", err)
    }
  }

  async function handleOpenProject() {
    const path = window.prompt("Enter the path to an existing wiki project:")
    if (!path) return
    try {
      const proj = await openProject(path)
      await handleProjectOpened(proj)
    } catch (err) {
      window.alert(`Failed to open project: ${err}`)
    }
  }

  if (!project) {
    return (
      <>
        <WelcomeScreen
          onCreateProject={() => setShowCreateDialog(true)}
          onOpenProject={handleOpenProject}
        />
        <CreateProjectDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          onCreated={handleProjectOpened}
        />
      </>
    )
  }

  return <AppLayout />
}

export default App

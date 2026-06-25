/**
 * B端简化版主应用
 * 只保留核心功能：项目管理、资料添加、状态查看
 */

import { useState, useEffect } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { useWikiStore } from "@/stores/wiki-store"
import { listDirectory, openProject } from "@/commands/fs"
import { getLastProject, saveLastProject, loadLlmConfig } from "@/lib/project-store"
import { restoreQueue, pauseQueue } from "@/lib/ingest-queue"
import { BSimpleLayout } from "@/components/b-simple/b-simple-layout"
import { BWelcomeScreen } from "@/components/b-simple/b-welcome-screen"
import { BCreateProjectDialog } from "@/components/b-simple/b-create-project-dialog"
import type { WikiProject } from "@/types/wiki"

export function BApp() {
  const project = useWikiStore((s) => s.project)
  const setProject = useWikiStore((s) => s.setProject)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [loading, setLoading] = useState(true)

  // 启动时自动加载上次打开的项目
  useEffect(() => {
    async function init() {
      try {
        // 加载LLM配置
        const savedConfig = await loadLlmConfig()
        if (savedConfig) {
          useWikiStore.getState().setLlmConfig(savedConfig)
        }

        // 加载上次打开的项目
        const lastProject = await getLastProject()
        if (lastProject) {
          try {
            const project = await openProject(lastProject.path)
            setProject(project)
            const tree = await listDirectory(project.path)
            setFileTree(tree)
            await restoreQueue(project.id, project.path)
          } catch (error) {
            console.error("无法打开上次的项目:", error)
          }
        }
      } catch (error) {
        console.error("初始化失败:", error)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [setProject, setFileTree])

  // 打开项目
  const handleOpenProject = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择知识库文件夹",
      })

      if (selected && typeof selected === "string") {
        let projectPath = selected

        // 先尝试直接打开
        try {
          await openProject(selected)
          projectPath = selected
        } catch {
          // 如果不是有效项目，扫描子目录查找
          try {
            const subDirs = await listDirectory(selected)
            const validProjects: { name: string; path: string }[] = []

            for (const dir of subDirs) {
              if (dir.is_dir) {
                try {
                  await openProject(dir.path)
                  validProjects.push({ name: dir.name, path: dir.path })
                } catch {
                  // 不是有效项目，跳过
                }
              }
            }

            if (validProjects.length === 1) {
              // 只有一个有效项目，自动打开
              projectPath = validProjects[0].path
            } else if (validProjects.length > 1) {
              // 多个有效项目，让用户选择
              const choices = validProjects.map((p, i) => `${i + 1}. ${p.name}`).join("\n")
              const choice = prompt(
                `找到 ${validProjects.length} 个知识库项目，请输入编号选择:\n${choices}`,
              )
              const idx = parseInt(choice ?? "0", 10) - 1
              if (idx >= 0 && idx < validProjects.length) {
                projectPath = validProjects[idx].path
              } else {
                alert("无效选择")
                return
              }
            } else {
              alert(
                "所选目录不是有效的知识库项目，且未找到子目录中的有效项目。\n请选择包含 schema.md 和 wiki/ 目录的项目文件夹。",
              )
              return
            }
          } catch {
            alert("无法访问所选目录")
            return
          }
        }

        const project = await openProject(projectPath)
        setProject(project)
        const tree = await listDirectory(project.path)
        setFileTree(tree)
        await saveLastProject(project)
        await restoreQueue(project.id, project.path)
      }
    } catch (error) {
      console.error("打开项目失败:", error)
      const msg = error instanceof Error ? error.message : String(error)
      alert("打开失败: " + msg)
    }
  }

  // 创建新项目
  const handleCreateProject = () => {
    setShowCreateDialog(true)
  }

  // 项目创建完成
  const handleProjectCreated = async (project: WikiProject) => {
    setProject(project)
    const tree = await listDirectory(project.path)
    setFileTree(tree)
    await saveLastProject(project)
    await restoreQueue(project.id, project.path)
    setShowCreateDialog(false)
  }

  // 切换项目
  const handleSwitchProject = async () => {
    await pauseQueue()
    setProject(null)
    setFileTree([])
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mb-4 text-4xl">📚</div>
          <div className="text-lg text-muted-foreground">加载中...</div>
        </div>
      </div>
    )
  }

  // 没有项目时显示欢迎界面
  if (!project) {
    return (
      <>
        <BWelcomeScreen
          onOpenProject={handleOpenProject}
          onCreateProject={handleCreateProject}
        />
        {showCreateDialog && (
          <BCreateProjectDialog
            onClose={() => setShowCreateDialog(false)}
            onCreated={handleProjectCreated}
          />
        )}
      </>
    )
  }

  // 有项目时显示主界面
  return (
    <BSimpleLayout onSwitchProject={handleSwitchProject} />
  )
}

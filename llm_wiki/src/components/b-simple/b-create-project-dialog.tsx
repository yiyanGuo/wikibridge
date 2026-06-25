/**
 * B端创建项目对话框
 */

import { useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { X, FolderOpen } from "lucide-react"
import { createProject } from "@/commands/fs"
import type { WikiProject } from "@/types/wiki"

interface BCreateProjectDialogProps {
  onClose: () => void
  onCreated: (project: WikiProject) => void
}

type Template = 'research' | 'reading' | 'personal' | 'business' | 'generic'

const templates = [
  {
    id: 'research' as Template,
    name: '研究项目',
    description: '适合学术研究、论文整理',
    icon: '🔬',
  },
  {
    id: 'reading' as Template,
    name: '阅读笔记',
    description: '适合读书笔记、文章收藏',
    icon: '📖',
  },
  {
    id: 'personal' as Template,
    name: '个人知识',
    description: '适合学习笔记、工作经验',
    icon: '💡',
  },
  {
    id: 'business' as Template,
    name: '商业管理',
    description: '适合业务资料、客户管理',
    icon: '💼',
  },
  {
    id: 'generic' as Template,
    name: '通用知识库',
    description: '适合任意类型内容',
    icon: '📚',
  },
]

export function BCreateProjectDialog({ onClose, onCreated }: BCreateProjectDialogProps) {
  const [projectName, setProjectName] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [template, setTemplate] = useState<Template>('generic')
  const [creating, setCreating] = useState(false)

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择知识库保存位置",
      })

      if (selected && typeof selected === "string") {
        setProjectPath(selected)
      }
    } catch (error) {
      console.error("选择文件夹失败:", error)
    }
  }

  const handleCreate = async () => {
    if (!projectName.trim() || !projectPath) {
      return
    }

    setCreating(true)
    try {
      const project = await createProject({
        name: projectName,
        path: projectPath,
        template: template,
      })

      onCreated(project)
    } catch (error) {
      console.error("创建项目失败:", error)
      const msg = error instanceof Error ? error.message : String(error)
      alert("创建失败: " + msg)
    } finally {
      setCreating(false)
    }
  }

  const canCreate = projectName.trim() && projectPath

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-2xl bg-card p-8 shadow-2xl">
        {/* 标题栏 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">创建新知识库</h2>
            <p className="text-sm text-muted-foreground">
              几步即可完成，开始整理你的知识
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 hover:bg-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 表单 */}
        <div className="space-y-6">
          {/* 项目名称 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              知识库名称 *
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="例如: 我的研究笔记"
              className="w-full rounded-lg border border-border bg-background px-4 py-3 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              autoFocus
            />
          </div>

          {/* 保存位置 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              保存位置 *
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={projectPath}
                readOnly
                placeholder="点击右侧按钮选择文件夹"
                className="flex-1 rounded-lg border border-border bg-background px-4 py-3 text-foreground placeholder:text-muted-foreground"
              />
              <button
                onClick={handleSelectFolder}
                className="flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-primary-foreground hover:bg-primary/90"
              >
                <FolderOpen className="h-5 w-5" />
                选择
              </button>
            </div>
          </div>

          {/* 模板选择 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              选择模板
            </label>
            <div className="grid grid-cols-2 gap-3">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTemplate(t.id)}
                  className={`flex items-start gap-3 rounded-lg border-2 p-4 text-left transition-all ${
                    template === t.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-card hover:border-primary/50'
                  }`}
                >
                  <div className="text-2xl">{t.icon}</div>
                  <div className="flex-1">
                    <div className="font-medium text-foreground">{t.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 按钮栏 */}
        <div className="mt-8 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-border bg-background px-6 py-2 text-foreground hover:bg-accent"
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={!canCreate || creating}
            className={`rounded-lg px-6 py-2 font-medium ${
              canCreate && !creating
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'cursor-not-allowed bg-muted text-muted-foreground'
            }`}
          >
            {creating ? '创建中...' : '创建知识库'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * B端欢迎界面
 * 简化版，只显示核心操作
 */

import { FolderOpen, Plus, BookOpen } from "lucide-react"

interface BWelcomeScreenProps {
  onOpenProject: () => void
  onCreateProject: () => void
}

export function BWelcomeScreen({ onOpenProject, onCreateProject }: BWelcomeScreenProps) {
  return (
    <div className="flex h-screen flex-col items-center justify-center bg-background p-8">
      {/* Logo 和标题 */}
      <div className="mb-12 text-center">
        <div className="mb-4 text-6xl">📚</div>
        <h1 className="mb-2 text-4xl font-bold text-foreground">
          个人知识库管理系统
        </h1>
        <p className="text-lg text-muted-foreground">
          零代码构建你的结构化知识库
        </p>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-6">
        {/* 创建新项目 */}
        <button
          onClick={onCreateProject}
          className="group flex h-48 w-64 flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-border bg-card p-8 transition-all hover:border-primary hover:bg-accent hover:shadow-lg"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary transition-all group-hover:scale-110">
            <Plus className="h-8 w-8" />
          </div>
          <div className="text-center">
            <div className="mb-1 text-xl font-semibold text-foreground">
              创建新知识库
            </div>
            <div className="text-sm text-muted-foreground">
              从头开始构建知识体系
            </div>
          </div>
        </button>

        {/* 打开已有项目 */}
        <button
          onClick={onOpenProject}
          className="group flex h-48 w-64 flex-col items-center justify-center gap-4 rounded-2xl border-2 border-border bg-card p-8 transition-all hover:border-primary hover:bg-accent hover:shadow-lg"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary transition-all group-hover:scale-110">
            <FolderOpen className="h-8 w-8" />
          </div>
          <div className="text-center">
            <div className="mb-1 text-xl font-semibold text-foreground">
              打开知识库
            </div>
            <div className="text-sm text-muted-foreground">
              继续管理已有知识库
            </div>
          </div>
        </button>
      </div>

      {/* 底部提示 */}
      <div className="mt-16 flex items-center gap-2 text-sm text-muted-foreground">
        <BookOpen className="h-4 w-4" />
        <span>支持 Obsidian 兼容格式</span>
      </div>

      {/* 版本信息 */}
      <div className="absolute bottom-4 text-xs text-muted-foreground">
        B端版本 v1.0.0 | 基于 LLM-Wiki
      </div>
    </div>
  )
}

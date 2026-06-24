/**
 * B端简化版主界面布局
 * 只保留核心功能：资料管理、状态查看、基础设置
 */

import { useState } from "react"
import {
  FileText,
  Settings,
  FolderOpen,
  BarChart3,
  LogOut,
  BookOpen
} from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { BSourcesView } from "./b-sources-view"
import { BStatusView } from "./b-status-view"
import { BSettingsView } from "./b-settings-view"
import { BWikiView } from "./b-wiki-view"

interface BSimpleLayoutProps {
  onSwitchProject: () => void
}

type View = 'wiki' | 'sources' | 'status' | 'settings'

export function BSimpleLayout({ onSwitchProject }: BSimpleLayoutProps) {
  const project = useWikiStore((s) => s.project)
  const [activeView, setActiveView] = useState<View>('wiki')

  return (
    <div className="flex h-screen bg-background">
      {/* 左侧导航栏 */}
      <div className="flex w-20 flex-col items-center border-r border-border bg-card py-6">
        {/* Logo */}
        <div className="mb-8 text-3xl">📚</div>

        {/* 导航按钮 */}
        <div className="flex flex-1 flex-col gap-4">
          <NavButton
            icon={<BookOpen className="h-6 w-6" />}
            label="Wiki浏览"
            active={activeView === 'wiki'}
            onClick={() => setActiveView('wiki')}
          />

          <NavButton
            icon={<FileText className="h-6 w-6" />}
            label="资料管理"
            active={activeView === 'sources'}
            onClick={() => setActiveView('sources')}
          />

          <NavButton
            icon={<BarChart3 className="h-6 w-6" />}
            label="状态统计"
            active={activeView === 'status'}
            onClick={() => setActiveView('status')}
          />

          <NavButton
            icon={<Settings className="h-6 w-6" />}
            label="设置"
            active={activeView === 'settings'}
            onClick={() => setActiveView('settings')}
          />
        </div>

        {/* 底部：切换项目 */}
        <div className="mt-auto">
          <button
            onClick={onSwitchProject}
            className="flex flex-col items-center gap-1 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="切换项目"
          >
            <LogOut className="h-5 w-5" />
            <span className="text-[10px]">切换</span>
          </button>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="flex flex-1 flex-col">
        {/* 顶部标题栏 */}
        <div className="flex h-16 items-center justify-between border-b border-border bg-card px-6">
          <div className="flex items-center gap-3">
            <FolderOpen className="h-5 w-5 text-primary" />
            <div>
              <div className="font-semibold text-foreground">
                {project?.name || '知识库'}
              </div>
              <div className="text-xs text-muted-foreground">
                {project?.path}
              </div>
            </div>
          </div>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-auto">
          {activeView === 'wiki' && <BWikiView />}
          {activeView === 'sources' && <BSourcesView />}
          {activeView === 'status' && <BStatusView />}
          {activeView === 'settings' && <BSettingsView />}
        </div>
      </div>
    </div>
  )
}

interface NavButtonProps {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}

function NavButton({ icon, label, active, onClick }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded-lg p-3 transition-all ${active
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        }`}
      title={label}
    >
      {icon}
      <span className="text-[10px]">{label.slice(0, 4)}</span>
    </button>
  )
}

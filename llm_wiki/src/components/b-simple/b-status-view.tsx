/**
 * B端状态统计视图
 * 显示项目统计信息、磁盘使用、最近活动
 */

import { useState, useEffect } from "react"
import {
  FileText,
  Files,
  HardDrive,
  Activity,
  TrendingUp,
  Clock
} from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { listDirectory, getFileSize, readFile } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"

interface ProjectStats {
  totalSources: number
  totalWikiPages: number
  diskUsage: {
    raw: number
    wiki: number
    total: number
  }
  lastActivity: string
}

interface LogEntry {
  action: string
  target: string
  time: string
}

function flattenFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir) {
      files.push(...flattenFiles(node.children ?? []))
    } else {
      files.push(node)
    }
  }
  return files
}

function flattenMd(nodes: FileNode[]): FileNode[] {
  return flattenFiles(nodes).filter(f => f.name.endsWith('.md'))
}

function timeAgo(isoString: string): string {
  const now = Date.now()
  const then = new Date(isoString).getTime()
  if (isNaN(then)) return '未知'
  const diff = now - then
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 30) return `${days}天前`
  return new Date(then).toLocaleDateString('zh-CN')
}

function parseLogEntries(content: string): LogEntry[] {
  const entries: LogEntry[] = []
  const lines = content.split('\n')
  let currentDate = ''

  for (const line of lines) {
    const dateMatch = line.match(/^## \[(\d{4}-\d{2}-\d{2})\]\s+(.+)$/)
    if (dateMatch) {
      currentDate = dateMatch[1]
      const detail = dateMatch[2]
      // Parse: "delete | 1 source files" or "external delete | 2 source files"
      const parts = detail.split('|').map(s => s.trim())
      if (parts.length >= 2) {
        const reason = parts[0]
        const subject = parts[1]
        let action = '资料操作'
        if (reason.includes('delete')) action = '删除资料'
        else if (reason.includes('import')) action = '导入资料'
        entries.push({ action, target: subject, time: currentDate })
      }
      continue
    }

    if (line.startsWith('## ')) {
      currentDate = line.slice(3).trim()
      continue
    }

    if (line.startsWith('- ') && currentDate) {
      const text = line.slice(2).trim()
      // Parse: "Action taken / finding noted" or "Project created"
      if (text.includes('Project created')) {
        entries.push({ action: '项目创建', target: '初始化知识库', time: currentDate })
      } else if (text.includes('source file')) {
        const match = text.match(/Deleted (\d+) source file/)
        if (match) {
          entries.push({ action: '删除资料', target: `${match[1]} 个源文件`, time: currentDate })
        }
      } else if (text.includes('compiled') || text.includes('generated')) {
        entries.push({ action: '编译完成', target: text, time: currentDate })
      } else {
        entries.push({ action: '活动', target: text, time: currentDate })
      }
    }
  }

  return entries
}

export function BStatusView() {
  const project = useWikiStore((s) => s.project)
  const [stats, setStats] = useState<ProjectStats>({
    totalSources: 0,
    totalWikiPages: 0,
    diskUsage: { raw: 0, wiki: 0, total: 0 },
    lastActivity: ''
  })
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [createdAt, setCreatedAt] = useState<string>('')

  useEffect(() => {
    async function loadStats() {
      if (!project) return
      setLoading(true)
      try {
        // Count source files
        let sourceFiles: FileNode[] = []
        try {
          const rawNodes = await listDirectory(`${project.path}/raw/sources`)
          sourceFiles = flattenFiles(rawNodes)
        } catch { /* directory may not exist yet */ }

        // Count wiki pages
        let wikiPages: FileNode[] = []
        try {
          const wikiNodes = await listDirectory(`${project.path}/wiki`)
          wikiPages = flattenMd(wikiNodes)
        } catch { /* directory may not exist yet */ }

        // Calculate disk usage
        let rawSize = 0
        let wikiSize = 0

        const sizePromises: Promise<void>[] = []
        for (const f of sourceFiles) {
          sizePromises.push(
            getFileSize(f.path).then(s => { rawSize += s }).catch(() => { })
          )
        }
        for (const f of wikiPages) {
          sizePromises.push(
            getFileSize(f.path).then(s => { wikiSize += s }).catch(() => { })
          )
        }
        await Promise.all(sizePromises)

        // Read log for activity
        let entries: LogEntry[] = []
        try {
          const logContent = await readFile(`${project.path}/wiki/log.md`)
          entries = parseLogEntries(logContent)
        } catch { /* log may not exist */ }

        // Read creation time from project.json
        let created = ''
        try {
          const identityContent = await readFile(`${project.path}/.llm-wiki/project.json`)
          const identity = JSON.parse(identityContent)
          if (identity.createdAt) {
            created = new Date(identity.createdAt).toLocaleDateString('zh-CN')
          }
        } catch { /* identity may not exist */ }

        setStats({
          totalSources: sourceFiles.length,
          totalWikiPages: wikiPages.length,
          diskUsage: {
            raw: rawSize,
            wiki: wikiSize,
            total: rawSize + wikiSize
          },
          lastActivity: entries.length > 0 ? timeAgo(new Date(entries[0].time).toISOString()) : '无'
        })
        setLogEntries(entries.slice(0, 10))
        setCreatedAt(created || '未知')
      } catch (error) {
        console.error("加载统计失败:", error)
      } finally {
        setLoading(false)
      }
    }
    loadStats()
  }, [project])

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  return (
    <div className="p-6">
      <h2 className="mb-6 text-2xl font-bold text-foreground">项目统计</h2>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          加载中...
        </div>
      ) : (
        <>
          {/* 统计卡片 */}
          <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={<Files className="h-6 w-6" />}
              title="原始资料"
              value={stats.totalSources}
              unit="个文件"
              color="bg-blue-500/10 text-blue-500"
            />

            <StatCard
              icon={<FileText className="h-6 w-6" />}
              title="Wiki页面"
              value={stats.totalWikiPages}
              unit="个页面"
              color="bg-green-500/10 text-green-500"
            />

            <StatCard
              icon={<HardDrive className="h-6 w-6" />}
              title="磁盘使用"
              value={formatBytes(stats.diskUsage.total)}
              unit=""
              color="bg-purple-500/10 text-purple-500"
            />

            <StatCard
              icon={<Activity className="h-6 w-6" />}
              title="最近活动"
              value={stats.lastActivity}
              unit=""
              color="bg-orange-500/10 text-orange-500"
            />
          </div>

          {/* 详细统计 */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* 存储详情 */}
            <div className="rounded-2xl border border-border bg-card p-6">
              <h3 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
                <HardDrive className="h-5 w-5" />
                存储详情
              </h3>

              <div className="space-y-4">
                <StorageBar
                  label="原始资料"
                  used={stats.diskUsage.raw}
                  total={Math.max(stats.diskUsage.total, 1)}
                  color="bg-blue-500"
                />

                <StorageBar
                  label="Wiki内容"
                  used={stats.diskUsage.wiki}
                  total={Math.max(stats.diskUsage.total, 1)}
                  color="bg-green-500"
                />

                <div className="pt-2 text-sm text-muted-foreground">
                  总计: {formatBytes(stats.diskUsage.total)}
                </div>
              </div>
            </div>

            {/* 最近活动 */}
            <div className="rounded-2xl border border-border bg-card p-6">
              <h3 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
                <Clock className="h-5 w-5" />
                最近活动
              </h3>

              {logEntries.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  暂无活动记录
                </div>
              ) : (
                <div className="space-y-3">
                  {logEntries.map((entry, i) => (
                    <ActivityItem
                      key={i}
                      action={entry.action}
                      target={entry.target}
                      time={entry.time}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 项目信息 */}
          <div className="mt-6 rounded-2xl border border-border bg-card p-6">
            <h3 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
              <TrendingUp className="h-5 w-5" />
              项目信息
            </h3>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <InfoItem label="项目名称" value={project?.name || '-'} />
              <InfoItem label="项目路径" value={project?.path || '-'} />
              <InfoItem label="创建时间" value={createdAt} />
              <InfoItem label="资料数量" value={`${stats.totalSources} 个文件`} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

interface StatCardProps {
  icon: React.ReactNode
  title: string
  value: string | number
  unit: string
  color: string
}

function StatCard({ icon, title, value, unit, color }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className={`mb-3 inline-flex rounded-lg p-3 ${color}`}>
        {icon}
      </div>
      <div className="text-3xl font-bold text-foreground">{value}</div>
      <div className="text-sm text-muted-foreground">
        {title} {unit}
      </div>
    </div>
  )
}

interface StorageBarProps {
  label: string
  used: number
  total: number
  color: string
}

function StorageBar({ label, used, total, color }: StorageBarProps) {
  const percentage = total > 0 ? Math.round((used / total) * 100) : 0

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-foreground">{label}</span>
        <span className="text-muted-foreground">{percentage}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${color} transition-all`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}

interface ActivityItemProps {
  action: string
  target: string
  time: string
}

function ActivityItem({ action, target, time }: ActivityItemProps) {
  return (
    <div className="flex items-start gap-3 rounded-lg p-2 hover:bg-accent">
      <div className="mt-1 h-2 w-2 rounded-full bg-primary" />
      <div className="flex-1">
        <div className="text-sm text-foreground">
          <span className="font-medium">{action}</span>: {target}
        </div>
        <div className="text-xs text-muted-foreground">{time}</div>
      </div>
    </div>
  )
}

interface InfoItemProps {
  label: string
  value: string
}

function InfoItem({ label, value }: InfoItemProps) {
  return (
    <div>
      <div className="mb-1 text-sm text-muted-foreground">{label}</div>
      <div className="font-medium text-foreground">{value}</div>
    </div>
  )
}

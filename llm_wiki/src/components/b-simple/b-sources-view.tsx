/**
 * B端资料管理视图
 * 支持拖拽上传、文件选择、URL添加
 */

import { useState, useEffect, useRef, useCallback } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { Upload, File, Link2, Trash2, RefreshCw, Play, AlertCircle, Loader2, RotateCcw } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { importSourceFiles, scanAndEnqueueAllSources, forceRecompileAllSources, deleteSourceFile } from "@/lib/source-lifecycle"
import { getQueue, getQueueSummary, retryTask, retryAllFailedTasks, cancelAllTasks, type IngestTask } from "@/lib/ingest-queue"
import { listDirectory } from "@/commands/fs"

export function BSourcesView() {
  const project = useWikiStore((s) => s.project)
  const [sources, setSources] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [compiling, setCompiling] = useState(false)
  const [forceCompiling, setForceCompiling] = useState(false)
  const [showUrlDialog, setShowUrlDialog] = useState(false)
  const [queueTasks, setQueueTasks] = useState<IngestTask[]>([])
  const [queueSummary, setQueueSummary] = useState({ pending: 0, processing: 0, failed: 0, completed: 0, total: 0 })
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 轮询队列状态
  const pollQueue = useCallback(() => {
    setQueueTasks([...getQueue()])
    setQueueSummary(getQueueSummary())
  }, [])

  useEffect(() => {
    pollQueue()
    const timer = setInterval(pollQueue, 1500)
    return () => clearInterval(timer)
  }, [pollQueue])

  // 加载资料列表
  const loadSources = async () => {
    if (!project) return
    setLoading(true)
    try {
      const files = await listDirectory(`${project.path}/raw/sources`)
      setSources(files.filter(f => !f.is_dir).map(f => f.path))
    } catch (error) {
      console.error("加载资料失败:", error)
      setSources([])
    } finally {
      setLoading(false)
    }
  }

  // 组件加载时自动加载资料列表
  useEffect(() => {
    loadSources()
  }, [project])

  // 手动编译所有资料
  const handleCompileAll = async () => {
    if (!project) return
    setCompiling(true)
    try {
      const llmConfig = useWikiStore.getState().llmConfig
      const count = await scanAndEnqueueAllSources(project, llmConfig)
      if (count > 0) {
        alert(`已提交 ${count} 个文件到编译队列，请查看下方队列状态`)
      } else {
        alert('没有找到可编译的文件，或 LLM 未配置')
      }
    } catch (error) {
      console.error("编译失败:", error)
      const msg = error instanceof Error ? error.message : String(error)
      alert("编译失败: " + msg)
    } finally {
      setCompiling(false)
    }
  }

  // 重试失败的任务
  const handleRetryFailed = async () => {
    const count = await retryAllFailedTasks()
    if (count > 0) {
      alert(`已重新提交 ${count} 个失败任务`)
    } else {
      alert('没有失败的任务')
    }
  }

  // 重试单个任务
  const handleRetryTask = async (taskId: string) => {
    await retryTask(taskId)
  }

  // 强制重新编译（清除缓存后重新编译全部）
  const handleForceRecompile = async () => {
    if (!project) return
    if (!confirm("确定要强制重新编译所有资料吗？这将清除编译缓存并重新生成所有 Wiki 页面。")) return
    setForceCompiling(true)
    try {
      const llmConfig = useWikiStore.getState().llmConfig
      const count = await forceRecompileAllSources(project, llmConfig)
      if (count > 0) {
        alert(`已清除缓存并提交 ${count} 个文件到编译队列，请查看下方队列状态`)
      } else {
        alert('没有找到可编译的文件，或 LLM 未配置')
      }
    } catch (error) {
      console.error("强制编译失败:", error)
      const msg = error instanceof Error ? error.message : String(error)
      alert("强制编译失败: " + msg)
    } finally {
      setForceCompiling(false)
    }
  }

  // 删除资料文件
  const handleDeleteSource = async (sourcePath: string) => {
    if (!project) return
    const fileName = sourcePath.split('/').pop() || sourcePath
    if (!confirm(`确定要删除 "${fileName}" 吗？相关的 Wiki 页面也会被清理。`)) return
    try {
      await deleteSourceFile(project.path, sourcePath)
      await loadSources()
    } catch (error) {
      console.error("删除失败:", error)
      const msg = error instanceof Error ? error.message : String(error)
      alert("删除失败: " + msg)
    }
  }

  // 取消队列
  const handleCancelQueue = async () => {
    const count = await cancelAllTasks()
    if (count > 0) {
      alert(`已取消 ${count} 个任务`)
    } else {
      alert('队列已清空')
    }
  }

  // 选择文件上传
  const handleSelectFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        title: "选择要添加的文件",
      })

      if (selected && project) {
        const files = Array.isArray(selected) ? selected : [selected]
        const llmConfig = useWikiStore.getState().llmConfig
        await importSourceFiles(project, files, llmConfig)
        await loadSources()
      }
    } catch (error) {
      console.error("添加文件失败:", error)
    }
  }

  // 拖拽上传
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (!project) return

    const files = Array.from(e.dataTransfer.files)
    // In Tauri, File objects from drag-drop have a path property
    const filePaths = files.map(f => (f as any).path).filter(Boolean)
    if (filePaths.length > 0) {
      const llmConfig = useWikiStore.getState().llmConfig
      await importSourceFiles(project, filePaths, llmConfig)
      await loadSources()
    }
  }

  return (
    <div className="flex h-full flex-col p-6">
      {/* 操作栏 */}
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground">资料管理</h2>
        <div className="flex gap-2">
          <button
            onClick={handleCompileAll}
            disabled={compiling}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors ${compiling
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
              }`}
          >
            <Play className="h-4 w-4" />
            {compiling ? '编译中...' : '手动编译'}
          </button>
          <button
            onClick={handleForceRecompile}
            disabled={forceCompiling}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors ${forceCompiling
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-orange-500 text-white hover:bg-orange-600'
              }`}
          >
            <RotateCcw className="h-4 w-4" />
            {forceCompiling ? '重新编译中...' : '强制重新编译'}
          </button>
          <button
            onClick={loadSources}
            className="flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-foreground hover:bg-accent"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
          {(queueSummary.pending > 0 || queueSummary.processing > 0) && (
            <button
              onClick={handleCancelQueue}
              className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-red-600 hover:bg-red-100"
            >
              <RotateCcw className="h-4 w-4" />
              取消队列
            </button>
          )}
        </div>
      </div>

      {/* 上传区域 */}
      <div
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="mb-6 rounded-2xl border-2 border-dashed border-border bg-card p-12 text-center transition-colors hover:border-primary hover:bg-accent/50"
      >
        <Upload className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        <div className="mb-4 text-lg font-medium text-foreground">
          拖拽文件到这里上传
        </div>
        <div className="mb-6 text-sm text-muted-foreground">
          支持 PDF、Word、Markdown、文本等格式
        </div>

        <div className="flex justify-center gap-3">
          <button
            onClick={handleSelectFiles}
            className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2 text-primary-foreground hover:bg-primary/90"
          >
            <File className="h-4 w-4" />
            选择文件
          </button>

          <button
            onClick={() => setShowUrlDialog(true)}
            className="flex items-center gap-2 rounded-lg border border-border bg-background px-6 py-2 text-foreground hover:bg-accent"
          >
            <Link2 className="h-4 w-4" />
            添加链接
          </button>
        </div>
      </div>

      {/* 编译队列状态 */}
      {queueTasks.length > 0 && (
        <div className="mb-6 rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              编译队列
            </h3>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-blue-500">等待: {queueSummary.pending}</span>
              <span className="text-yellow-500">进行中: {queueSummary.processing}</span>
              <span className="text-green-500">已完成: {queueSummary.completed}</span>
              {queueSummary.failed > 0 && (
                <>
                  <span className="text-red-500">失败: {queueSummary.failed}</span>
                  <button
                    onClick={handleRetryFailed}
                    className="flex items-center gap-1 rounded bg-red-500/10 px-2 py-1 text-red-500 hover:bg-red-500/20"
                  >
                    <RotateCcw className="h-3 w-3" />
                    重试全部
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="space-y-2 max-h-48 overflow-auto">
            {queueTasks.map((task) => (
              <div
                key={task.id}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${task.status === 'processing' ? 'bg-yellow-500/10' :
                  task.status === 'failed' ? 'bg-red-500/10' :
                    task.status === 'pending' ? 'bg-blue-500/5' :
                      'bg-green-500/10'
                  }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {task.status === 'processing' && <Loader2 className="h-3.5 w-3.5 animate-spin text-yellow-500 flex-shrink-0" />}
                  {task.status === 'failed' && <AlertCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />}
                  {task.status === 'pending' && <div className="h-3.5 w-3.5 rounded-full border-2 border-blue-400 flex-shrink-0" />}
                  <span className="truncate text-foreground">{task.sourcePath.split('/').pop()}</span>
                  {task.error && <span className="text-xs text-red-400 truncate">— {task.error}</span>}
                </div>
                {task.status === 'failed' && (
                  <button
                    onClick={() => handleRetryTask(task.id)}
                    className="ml-2 flex-shrink-0 rounded p-1 text-red-400 hover:bg-red-500/20"
                    title="重试"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 资料列表 */}
      <div className="flex-1 overflow-auto">
        <div className="mb-3 text-sm font-medium text-muted-foreground">
          已添加资料 ({sources.length})
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-muted-foreground">加载中...</div>
          </div>
        ) : sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <File className="mb-3 h-12 w-12 opacity-50" />
            <div>还没有添加资料</div>
            <div className="text-sm">拖拽文件或点击上方按钮开始添加</div>
          </div>
        ) : (
          <div className="space-y-2">
            {sources.map((source, index) => (
              <div
                key={index}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-4 hover:bg-accent"
              >
                <div className="flex items-center gap-3">
                  <File className="h-5 w-5 text-primary" />
                  <div>
                    <div className="font-medium text-foreground">
                      {source.split('/').pop()}
                    </div>
                    <div className="text-xs text-muted-foreground">{source}</div>
                  </div>
                </div>

                <button
                  onClick={() => handleDeleteSource(source)}
                  className="rounded-lg p-2 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                  title="删除"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* URL 对话框 */}
      {showUrlDialog && (
        <UrlDialog onClose={() => setShowUrlDialog(false)} />
      )}
    </div>
  )
}

interface UrlDialogProps {
  onClose: () => void
}

function UrlDialog({ onClose }: UrlDialogProps) {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')

  const handleAdd = () => {
    // TODO: 实现URL添加
    console.log("添加URL:", url, title)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-2xl">
        <h3 className="mb-4 text-xl font-bold text-foreground">添加网页链接</h3>

        <div className="mb-4">
          <label className="mb-2 block text-sm font-medium text-foreground">
            URL 地址 *
          </label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="w-full rounded-lg border border-border bg-background px-4 py-2 text-foreground"
            autoFocus
          />
        </div>

        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-foreground">
            标题（可选）
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="为这个链接取个名字"
            className="w-full rounded-lg border border-border bg-background px-4 py-2 text-foreground"
          />
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-accent"
          >
            取消
          </button>
          <button
            onClick={handleAdd}
            disabled={!url}
            className={`rounded-lg px-4 py-2 ${url
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'cursor-not-allowed bg-muted text-muted-foreground'
              }`}
          >
            添加
          </button>
        </div>
      </div>
    </div>
  )
}

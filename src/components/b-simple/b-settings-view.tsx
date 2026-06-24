/**
 * B端简化版设置界面
 * 只保留核心配置：LLM设置、基本选项
 */

import { useState, useEffect } from "react"
import { Save, Check } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { saveLlmConfig, saveSourceWatchConfig, loadSourceWatchConfig } from "@/lib/project-store"

export function BSettingsView() {
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const setLlmConfig = useWikiStore((s) => s.setLlmConfig)
  const setSourceWatchConfig = useWikiStore((s) => s.setSourceWatchConfig)
  const project = useWikiStore((s) => s.project)

  const [provider, setProvider] = useState(llmConfig.provider)
  const [apiKey, setApiKey] = useState(llmConfig.apiKey)
  const [model, setModel] = useState(llmConfig.model)
  const [endpoint, setEndpoint] = useState(llmConfig.customEndpoint)
  const [autoIngest, setAutoIngest] = useState(false)
  const [sourceWatchEnabled, setSourceWatchEnabled] = useState(false)
  const [saved, setSaved] = useState(false)

  // 加载已保存的设置
  useEffect(() => {
    async function loadSettings() {
      const config = await loadSourceWatchConfig(project?.id)
      setAutoIngest(config.autoIngest)
      setSourceWatchEnabled(config.enabled)
    }
    loadSettings()
  }, [project?.id])

  const handleSave = async () => {
    const newConfig = {
      ...llmConfig,
      provider,
      apiKey,
      model,
      customEndpoint: endpoint,
    }

    setLlmConfig(newConfig)
    await saveLlmConfig(newConfig)

    const newWatchConfig = {
      enabled: sourceWatchEnabled,
      autoIngest,
      includeExtensions: [],
      excludeExtensions: [],
      excludeDirs: [],
      excludeGlobs: [],
      maxFileSizeMb: 50,
    }
    setSourceWatchConfig(newWatchConfig)
    await saveSourceWatchConfig(newWatchConfig, project?.id)

    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const providers = [
    { value: 'openai', label: 'OpenAI' },
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'google', label: 'Google' },
    { value: 'ollama', label: 'Ollama（本地）' },
    { value: 'custom', label: '自定义' },
  ]

  const models = {
    openai: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    anthropic: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
    google: ['gemini-pro', 'gemini-pro-vision'],
    ollama: ['llama2', 'mistral', 'qwen'],
    custom: [],
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground">设置</h2>
        <button
          onClick={handleSave}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors ${saved
            ? 'bg-green-500 text-white'
            : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
        >
          {saved ? (
            <>
              <Check className="h-4 w-4" />
              已保存
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              保存设置
            </>
          )}
        </button>
      </div>

      <div className="max-w-2xl space-y-8">
        {/* LLM 配置 */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold text-foreground">
            LLM 配置
          </h3>

          <div className="space-y-4">
            {/* 提供商选择 */}
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                LLM 提供商
              </label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as any)}
                className="w-full rounded-lg border border-border bg-background px-4 py-2 text-foreground focus:border-primary focus:outline-none"
              >
                {providers.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {/* API Key */}
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="输入你的 API Key"
                className="w-full rounded-lg border border-border bg-background px-4 py-2 text-foreground focus:border-primary focus:outline-none"
              />
              <div className="mt-1 text-xs text-muted-foreground">
                API Key 会安全地保存在本地
              </div>
            </div>

            {/* 模型选择 */}
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                模型
              </label>
              {provider === 'custom' ? (
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="输入模型名称"
                  className="w-full rounded-lg border border-border bg-background px-4 py-2 text-foreground focus:border-primary focus:outline-none"
                />
              ) : (
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2 text-foreground focus:border-primary focus:outline-none"
                >
                  {models[provider as keyof typeof models]?.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* 自定义端点 */}
            {(provider === 'custom' || provider === 'ollama') && (
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  API 端点
                </label>
                <input
                  type="text"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder={
                    provider === 'ollama'
                      ? 'http://localhost:11434'
                      : 'https://api.example.com/v1'
                  }
                  className="w-full rounded-lg border border-border bg-background px-4 py-2 text-foreground focus:border-primary focus:outline-none"
                />
              </div>
            )}
          </div>
        </div>

        {/* 通用设置 */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold text-foreground">
            通用设置
          </h3>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-foreground">自动编译</div>
                <div className="text-sm text-muted-foreground">
                  添加资料后自动生成 Wiki 页面
                </div>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={autoIngest}
                  onChange={(e) => setAutoIngest(e.target.checked)}
                />
                <div className="peer h-6 w-11 rounded-full bg-muted after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-primary peer-checked:after:translate-x-full"></div>
              </label>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-foreground">文件监听</div>
                <div className="text-sm text-muted-foreground">
                  自动检测文件夹变化
                </div>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={sourceWatchEnabled}
                  onChange={(e) => setSourceWatchEnabled(e.target.checked)}
                />
                <div className="peer h-6 w-11 rounded-full bg-muted after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-primary peer-checked:after:translate-x-full"></div>
              </label>
            </div>
          </div>
        </div>

        {/* 关于 */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold text-foreground">关于</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">版本</span>
              <span className="text-foreground">B端版 v1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">基于</span>
              <span className="text-foreground">LLM-Wiki</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">许可证</span>
              <span className="text-foreground">GPL-3.0</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

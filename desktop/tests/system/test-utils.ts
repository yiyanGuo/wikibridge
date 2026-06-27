import { expect, type Page } from "@playwright/test"

export type SystemTestState = {
  services?: {
    bearfrpBackendUrl?: string
  }
  authenticated?: boolean
  user?: { username: string; balance_mb: number } | null
  llmConfig?: Record<string, unknown>
  projects?: Array<Record<string, unknown>>
  connections?: Array<Record<string, unknown>>
  remoteKnowledgeBases?: Array<Record<string, unknown>>
  wikiProjects?: Record<string, Record<string, unknown>>
  projectTrees?: Record<string, Record<string, unknown>>
  projectDocuments?: Record<string, Record<string, unknown>>
  commandFailures?: Record<string, string>
}

export async function prepareSystemTestPage(page: Page, state: SystemTestState = {}) {
  await page.addInitScript((initialState) => {
    window.__wikibridgeSystemTestInitialState = initialState
    window.__wikibridgeSystemTestOpenCalls = []
    window.__wikibridgeSystemTestConfirmResult = true
    window.__wikibridgeSystemTestClipboardText = ""
    window.open = (url, target) => {
      window.__wikibridgeSystemTestOpenCalls.push({
        url: String(url || ""),
        target: String(target || ""),
      })
      return null
    }
    window.confirm = () => window.__wikibridgeSystemTestConfirmResult
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          window.__wikibridgeSystemTestClipboardText = text
        },
      },
    })
  }, state)
  await page.goto("/")
  await expect(page.getByText("WikiBridge", { exact: true })).toBeVisible()
}

export async function getInvocations(page: Page) {
  return page.evaluate(() => window.__wikibridgeSystemTest?.getInvocations() || [])
}

export async function enqueueOpenResult(page: Page, result: string | string[] | null) {
  await page.evaluate(
    (nextResult) => window.__wikibridgeSystemTestDialog?.enqueueOpenResult(nextResult),
    result,
  )
}

export async function setConfirmResult(page: Page, result: boolean) {
  await page.evaluate((nextResult) => {
    window.__wikibridgeSystemTestConfirmResult = nextResult
  }, result)
}

export async function getClipboardText(page: Page) {
  return page.evaluate(() => window.__wikibridgeSystemTestClipboardText)
}

export async function getOpenCalls(page: Page) {
  return page.evaluate(() => window.__wikibridgeSystemTestOpenCalls)
}

declare global {
  interface Window {
    __wikibridgeSystemTest?: {
      getState: () => SystemTestState
      getInvocations: () => Array<{ command: string; args?: unknown }>
      failCommand: (command: string, message: string) => void
      clearCommandFailure: (command: string) => void
    }
    __wikibridgeSystemTestInitialState?: SystemTestState
    __wikibridgeSystemTestDialog?: {
      enqueueOpenResult: (result: string | string[] | null) => void
    }
    __wikibridgeSystemTestOpenCalls: Array<{ url: string; target: string }>
    __wikibridgeSystemTestConfirmResult: boolean
    __wikibridgeSystemTestClipboardText: string
  }
}

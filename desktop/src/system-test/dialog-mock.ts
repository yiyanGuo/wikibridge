type OpenOptions = {
  directory?: boolean
  multiple?: boolean
}

type DialogController = {
  enqueueOpenResult: (result: string | string[] | null) => void
  getOpenCalls: () => OpenOptions[]
}

declare global {
  interface Window {
    __wikibridgeSystemTestDialog?: DialogController
  }
}

const openResults: Array<string | string[] | null> = []
const openCalls: OpenOptions[] = []

window.__wikibridgeSystemTestDialog = {
  enqueueOpenResult(result) {
    openResults.push(result)
  },
  getOpenCalls() {
    return JSON.parse(JSON.stringify(openCalls))
  },
}

export async function open(options: OpenOptions = {}): Promise<string | string[] | null> {
  openCalls.push(options)
  return openResults.length > 0 ? (openResults.shift() ?? null) : null
}

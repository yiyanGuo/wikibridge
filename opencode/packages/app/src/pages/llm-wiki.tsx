import { Button } from "@opencode-ai/ui/button"
import { Markdown } from "@opencode-ai/ui/markdown"
import { TextField } from "@opencode-ai/ui/text-field"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Spinner } from "@opencode-ai/ui/spinner"
import { For, Match, Show, Switch, createResource, createSignal } from "solid-js"
import { LlmWikiGuard, LlmWikiProvider, useLlmWiki } from "@/context/llm-wiki"

export default function LlmWikiPage() {
  return (
    <LlmWikiProvider>
      <div class="flex h-full w-full min-w-0 flex-col bg-v2-background-bg-base">
        <LlmWikiHeader />
        <div class="flex min-h-0 flex-1">
          <LlmWikiSidebar />
          <LlmWikiContent />
        </div>
      </div>
    </LlmWikiProvider>
  )
}

function LlmWikiHeader() {
  const ctx = useLlmWiki()
  return (
    <header class="flex h-12 shrink-0 items-center justify-between border-b border-v2-border-border-base px-4">
      <div class="flex items-center gap-3">
        <span class="text-14-semibold text-v2-text-text-base">Knowledge Base</span>
        <Show when={ctx.currentProject()}>
          {(project) => (
            <span class="rounded-full bg-v2-background-bg-layer-01 px-2 py-0.5 text-12-regular text-v2-text-text-muted">
              {project().name}
            </span>
          )}
        </Show>
      </div>
      <LlmWikiSearch />
    </header>
  )
}

function LlmWikiSearch() {
  const ctx = useLlmWiki()
  const [value, setValue] = createSignal("")
  return (
    <div class="flex items-center gap-2">
      <TextField
        type="search"
        placeholder="Search knowledge base..."
        class="w-64"
        value={value()}
        onChange={setValue}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === "Enter") ctx.search(value())
        }}
      />
      <Button variant="secondary" size="small" onClick={() => ctx.search(value())}>
        Search
      </Button>
    </div>
  )
}

function LlmWikiSidebar() {
  const ctx = useLlmWiki()
  return (
    <aside class="flex w-64 shrink-0 flex-col border-r border-v2-border-border-base">
      <div class="border-b border-v2-border-border-base p-3">
        <LlmWikiProjectPicker />
      </div>
      <ScrollView class="min-h-0 flex-1 p-2">
        <Show when={ctx.filesLoading()}>
          <div class="flex justify-center p-4">
            <Spinner />
          </div>
        </Show>
        <For each={ctx.files()}>
          {(node) => (
            <LlmWikiFileNode node={node} depth={0} />
          )}
        </For>
      </ScrollView>
    </aside>
  )
}

function LlmWikiProjectPicker() {
  const ctx = useLlmWiki()
  return (
    <select
      class="w-full rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-2 py-1.5 text-13-regular text-v2-text-text-base outline-none focus-visible:ring-1 focus-visible:ring-v2-focus-focus"
      value={ctx.currentProject()?.id ?? ""}
      onChange={(event) => ctx.setCurrentProjectId(event.currentTarget.value)}
    >
      <option value="" disabled>Select project...</option>
      <For each={ctx.projects()}>
        {(project) => (
          <option value={project.id}>{project.name}</option>
        )}
      </For>
    </select>
  )
}

function LlmWikiFileNode(props: { node: import("@/context/llm-wiki").LlmWikiFileNode; depth: number }) {
  const ctx = useLlmWiki()
  const paddingLeft = () => `${props.depth * 12 + 4}px`
  return (
    <Switch>
      <Match when={props.node.isDir}>
        <div class="flex flex-col">
          <button
            type="button"
            class="flex h-7 items-center rounded-md px-1.5 text-left text-13-regular text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
            style={{ "padding-left": paddingLeft() }}
          >
            {props.node.name}
          </button>
          <For each={props.node.children ?? []}>
            {(child) => (
              <LlmWikiFileNode node={child} depth={props.depth + 1} />
            )}
          </For>
        </div>
      </Match>
      <Match when={!props.node.isDir}>
        <button
          type="button"
          class="flex h-7 w-full items-center rounded-md px-1.5 text-left text-13-regular text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
          style={{ "padding-left": paddingLeft() }}
          classList={{ "bg-v2-overlay-simple-overlay-hover text-v2-text-text-base": ctx.selectedPath() === props.node.path }}
          onClick={() => ctx.selectPath(props.node.path)}
        >
          {props.node.name}
        </button>
      </Match>
    </Switch>
  )
}

function LlmWikiContent() {
  return (
    <LlmWikiGuard>
      <main class="flex min-w-0 flex-1 flex-col">
        <LlmWikiSearchResults />
        <LlmWikiFileContent />
      </main>
    </LlmWikiGuard>
  )
}

function LlmWikiSearchResults() {
  const ctx = useLlmWiki()
  return (
    <Show when={ctx.searchResults().length > 0}>
      <div class="border-b border-v2-border-border-base p-4">
        <div class="mb-2 text-12-semibold text-v2-text-text-muted">Search results</div>
        <ScrollView class="max-h-48">
          <For each={ctx.searchResults()}>
            {(result) => (
              <button
                type="button"
                class="flex w-full flex-col gap-1 rounded-md p-2 text-left hover:bg-v2-overlay-simple-overlay-hover"
                onClick={() => ctx.selectPath(result.path)}
              >
                <span class="text-13-medium text-v2-text-text-base">{result.title}</span>
                <span class="line-clamp-2 text-12-regular text-v2-text-text-muted">{result.snippet}</span>
              </button>
            )}
          </For>
        </ScrollView>
      </div>
    </Show>
  )
}

function LlmWikiFileContent() {
  const ctx = useLlmWiki()
  const [content] = createResource(
    () => ctx.selectedPath(),
    async (path) => {
      const data = await ctx.loadFile(path)
      return data?.content ?? ""
    },
  )

  return (
    <Show
      when={ctx.selectedPath()}
      fallback={
        <div class="flex h-full items-center justify-center text-v2-text-text-muted">
          Select a file to read.
        </div>
      }
    >
      <ScrollView class="min-h-0 flex-1 p-6">
        <Show when={content.loading}>
          <div class="flex justify-center p-4">
            <Spinner />
          </div>
        </Show>
        <Markdown text={content() ?? ""} class="prose prose-sm max-w-none" />
      </ScrollView>
    </Show>
  )
}

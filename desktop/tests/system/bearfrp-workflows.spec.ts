import { expect, test } from "@playwright/test"
import {
  enqueueOpenResult,
  getInvocations,
  prepareSystemTestPage,
  setConfirmResult,
} from "./test-utils"

test("saves publisher model config and keeps the saved key visible", async ({ page }) => {
  await prepareSystemTestPage(page, {
    llmConfig: {
      provider: "deepseek",
      apiKey: "",
      model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com/v1",
      maxContextSize: 64000,
      configured: false,
    },
  })

  await page.getByLabel("DeepSeek API Key").fill("sk-first")
  await page.getByRole("button", { name: "保存" }).click()
  await expect(page.getByText("知识库构建模型已保存")).toBeVisible()

  await page.getByRole("button", { name: "高级模型设置" }).click()
  await page.getByLabel("Model").fill("deepseek-v4-pro")
  await page.getByLabel("Base URL").fill("https://api.deepseek.com/v1")
  await page.getByLabel("maxContextSize").fill("128000")
  await page.getByRole("button", { name: "保存" }).click()
  await expect(page.getByLabel("DeepSeek API Key")).toHaveValue("sk-first")
  await expect(page.getByRole("button", { name: "清除 Key" })).toHaveCount(0)

  const saveInvocations = (await getInvocations(page)).filter(
    (invocation) => invocation.command === "set_llm_wiki_llm_config",
  )
  expect(saveInvocations.at(-1)?.args).toMatchObject({
    input: {
      apiKey: "sk-first",
      model: "deepseek-v4-pro",
      baseUrl: "https://api.deepseek.com/v1",
      maxContextSize: 128000,
    },
  })
})

test("imports sources and runs Build with internal graph refresh", async ({ page }) => {
  await prepareSystemTestPage(page)

  await expect(page.getByText("链接：")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Chat" })).toHaveCount(0)
  await page.getByRole("button", { name: "进入项目" }).click()
  await expect(page.getByRole("button", { name: "Build" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Link" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "启动 Chat" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "打开 Chat" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "停止 Chat" })).toHaveCount(0)
  await expect(page.getByText("Graph：")).toHaveCount(0)
  await expect(page.getByText("已处理文件 1/1")).toBeVisible()

  await enqueueOpenResult(page, ["/tmp/source-one.md", "/tmp/source-two.md"])
  await page.getByRole("button", { name: "Add 文件", exact: true }).click()
  await expect(page.getByText("已导入 2 个 source")).toBeVisible()
  await expect(page.getByText("Sources：")).toHaveCount(0)

  await page.getByRole("button", { name: "Build" }).click()
  await expect(page.getByText("构建完成：处理 1 个 source，生成 1 个 Wiki 文件")).toBeVisible()
  await expect(page.getByText("已处理文件 1/1")).toBeVisible()
  await expect(page.getByText("Graph 已刷新")).toHaveCount(0)

  const commands = (await getInvocations(page)).map((invocation) => invocation.command)
  expect(commands.indexOf("build_wiki_project")).toBeGreaterThan(-1)
  expect(commands.indexOf("refresh_wiki_graph")).toBeGreaterThan(
    commands.indexOf("build_wiki_project"),
  )
})

test("shows empty reader state when a project has no wiki documents", async ({ page }) => {
  await prepareSystemTestPage(page, {
    projectTrees: {
      "project-1": {
        node_id: "",
        name: "root",
        kind: "directory",
        readable: false,
        children: [],
      },
    },
    wikiProjects: {
      "project-1": {
        project: { id: "project-1", name: "示例知识库", path: "/tmp/wikibridge/sample" },
        queue: { pending: 0, processing: 0, failed: 0, completed: 0, total: 0 },
        sourceCount: 0,
        wikiCount: 0,
      },
    },
  })

  await page.getByRole("button", { name: "进入项目" }).click()
  await expect(page.getByText("暂无 Wiki 文档")).toBeVisible()
  await expect(page.getByText("请先 Add source，再 Build。")).toBeVisible()
})

test("shows reader errors when document loading fails", async ({ page }) => {
  await prepareSystemTestPage(page, {
    commandFailures: {
      read_project_tree_document: "文档读取失败",
    },
  })

  await page.getByRole("button", { name: "进入项目" }).click()
  await expect(page.getByText("文档读取失败")).toBeVisible()
})

test("requires confirmation before deleting a project", async ({ page }) => {
  await prepareSystemTestPage(page)

  await expect(page.getByRole("heading", { name: "示例知识库" })).toBeVisible()
  await setConfirmResult(page, false)
  await page.getByTitle("删除项目").click()
  await expect(page.getByRole("heading", { name: "示例知识库" })).toBeVisible()

  await setConfirmResult(page, true)
  await page.getByTitle("删除项目").click()
  await expect(page.getByText("项目已从列表移除")).toBeVisible()
  await expect(page.getByRole("heading", { name: "示例知识库" })).toBeHidden()
})

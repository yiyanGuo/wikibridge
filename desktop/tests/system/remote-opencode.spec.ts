import { expect, test } from "@playwright/test"
import { prepareSystemTestPage, setConfirmResult } from "./test-utils"

test("adds and connects a remote LLM Wiki knowledge base", async ({ page }) => {
  await prepareSystemTestPage(page)

  await page.getByRole("button", { name: /消费端/ }).click()
  await expect(page.getByText("添加 LLM Wiki API 地址后可连接到本地 OpenCode。")).toBeVisible()

  await page.getByLabel("名称").fill("团队知识库")
  await page.getByLabel("API 地址").fill("https://wiki.example.test/share/")
  await page.getByRole("button", { name: "添加" }).click()

  await expect(page.getByText("远程知识库已添加")).toBeVisible()
  const card = page.locator(".remote-card").filter({ hasText: "团队知识库" })
  await expect(card).toBeVisible()
  await expect(card).toContainText("https://wiki.example.test/share/api/v1")
  await expect(card).toContainText("项目：1")

  await card.getByRole("button", { name: "连接" }).click()
  await expect(page.getByText("本地 OpenCode 已连接远程知识库并创建对话，MCP 已注册")).toBeVisible()
  await expect(page.locator("iframe.opencode-frame")).toHaveAttribute(
    "src",
    /^http:\/\/127\.0\.0\.1:9010\/mock\/session\/session-/,
  )
})

test("normalizes duplicate remote LLM Wiki links and updates the existing card", async ({
  page,
}) => {
  await prepareSystemTestPage(page, {
    remoteKnowledgeBases: [
      {
        remoteId: "remote-1",
        name: "旧名称",
        url: "https://wiki.example.test/share",
        apiUrl: "https://wiki.example.test/share/api/v1",
        status: "ready",
        projectCount: 1,
        projects: [
          { id: "remote-project-1", name: "团队项目", path: "/remote/team", current: true },
        ],
        currentProject: {
          id: "remote-project-1",
          name: "团队项目",
          path: "/remote/team",
          current: true,
        },
        authRequired: false,
        mcpStatus: "not_registered",
        addedAt: 1,
        lastOpenedAt: 1,
      },
    ],
  })

  await page.getByRole("button", { name: /消费端/ }).click()
  await page.getByLabel("名称").fill("新名称")
  await page.getByLabel("API 地址").fill("https://wiki.example.test/share/")
  await page.getByRole("button", { name: "添加" }).click()

  await expect(page.locator(".remote-card")).toHaveCount(1)
  await expect(page.locator(".remote-card").filter({ hasText: "新名称" })).toBeVisible()
  await expect(page.locator(".remote-card")).toContainText("https://wiki.example.test/share/api/v1")
})

test("reports remote check failure without removing the saved item", async ({ page }) => {
  await prepareSystemTestPage(page, {
    remoteKnowledgeBases: [
      {
        remoteId: "remote-down",
        name: "故障知识库",
        url: "https://down.example.test",
        apiUrl: "https://down.example.test/api/v1",
        status: "ready",
        projectCount: 1,
        projects: [
          { id: "remote-project-1", name: "团队项目", path: "/remote/team", current: true },
        ],
        currentProject: {
          id: "remote-project-1",
          name: "团队项目",
          path: "/remote/team",
          current: true,
        },
        authRequired: false,
        mcpStatus: "not_registered",
        addedAt: 1,
        lastOpenedAt: 1,
      },
    ],
  })

  await page.getByRole("button", { name: /消费端/ }).click()
  await page.getByRole("button", { name: "检测" }).click()

  await expect(page.getByText("远程知识库不可达")).toBeVisible()
  await expect(page.getByText("故障知识库")).toBeVisible()
})

test("requires confirmation before removing a remote knowledge base", async ({ page }) => {
  await prepareSystemTestPage(page, {
    remoteKnowledgeBases: [
      {
        remoteId: "remote-1",
        name: "团队知识库",
        url: "https://wiki.example.test",
        apiUrl: "https://wiki.example.test/api/v1",
        status: "ready",
        projectCount: 1,
        projects: [
          { id: "remote-project-1", name: "团队项目", path: "/remote/team", current: true },
        ],
        currentProject: {
          id: "remote-project-1",
          name: "团队项目",
          path: "/remote/team",
          current: true,
        },
        authRequired: false,
        mcpStatus: "not_registered",
        addedAt: 1,
        lastOpenedAt: 1,
      },
    ],
  })

  await page.getByRole("button", { name: /消费端/ }).click()
  await expect(page.getByText("团队知识库")).toBeVisible()

  await setConfirmResult(page, false)
  await page.getByTitle("删除").click()
  await expect(page.getByText("团队知识库")).toBeVisible()

  await setConfirmResult(page, true)
  await page.getByTitle("删除").click()
  await expect(page.getByText("远程知识库已删除")).toBeVisible()
  await expect(page.getByText("团队知识库")).toBeHidden()
})

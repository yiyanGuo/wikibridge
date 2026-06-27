import { expect, test } from "@playwright/test"
import { prepareSystemTestPage, setConfirmResult } from "./test-utils"

test("adds a remote knowledge base and enters it from the central button", async ({ page }) => {
  await prepareSystemTestPage(page)

  await page.getByRole("button", { name: /消费端/ }).click()
  await expect(page.getByText("添加远程知识库 URL 后可进入本地 OpenCode。")).toBeVisible()

  await page.getByLabel("URL 地址").fill("https://wiki.example.test/share/")
  await page.getByRole("button", { name: "添加" }).click()

  await expect(page.getByText("远程知识库已添加")).toBeVisible()
  const card = page.locator(".remote-card").filter({ hasText: "gyy的知识库" })
  await expect(card).toBeVisible()
  await expect(card).toContainText("https://wiki.example.test/share/api/v1")

  await page.locator(".remote-empty-panel").getByRole("button", { name: "启动并进入" }).click()
  await expect(page.getByText("OpenCode 远程知识库对话已创建")).toBeVisible()
  await expect(page.locator("iframe.opencode-frame")).toHaveAttribute(
    "src",
    /^http:\/\/127\.0\.0\.1:9010\/mock\/session\/session-/,
  )
})

test("prompts for a password only when the remote requires one", async ({ page }) => {
  await prepareSystemTestPage(page)

  await page.getByRole("button", { name: /消费端/ }).click()
  await page.getByLabel("URL 地址").fill("https://protected.example.test/share/")
  await page.getByRole("button", { name: "添加" }).click()

  await expect(page.getByText("该知识库需要访问密码")).toBeVisible()
  await expect(page.getByLabel("访问密码")).toBeVisible()

  await page.getByLabel("访问密码").fill("wrong")
  await page.getByRole("button", { name: "验证并添加" }).click()
  await expect(page.getByText("密码不正确或已失效")).toBeVisible()
  await expect(page.getByText("密码不正确或已失效")).toBeHidden({ timeout: 4000 })
  await expect(page.getByLabel("访问密码")).toBeVisible()

  await page.getByLabel("访问密码").fill("secret")
  await page.getByRole("button", { name: "验证并添加" }).click()
  await expect(page.getByText("远程知识库已添加")).toBeVisible()
  await expect(page.locator(".remote-card").filter({ hasText: "gyy的知识库" })).toBeVisible()
})

test("normalizes duplicate remote links and updates the existing card", async ({ page }) => {
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
  await page.getByLabel("URL 地址").fill("https://wiki.example.test/share/")
  await page.getByRole("button", { name: "添加" }).click()

  await expect(page.locator(".remote-card")).toHaveCount(1)
  await expect(page.locator(".remote-card").filter({ hasText: "gyy的知识库" })).toBeVisible()
  await expect(page.locator(".remote-card")).toContainText("https://wiki.example.test/share/api/v1")
})

test("reports add failure without saving the remote", async ({ page }) => {
  await prepareSystemTestPage(page)

  await page.getByRole("button", { name: /消费端/ }).click()
  await page.getByLabel("URL 地址").fill("https://down.example.test")
  await page.getByRole("button", { name: "添加" }).click()

  await expect(page.getByText("远程知识库不可达")).toBeVisible()
  await expect(page.getByText("远程知识库不可达")).toBeHidden({ timeout: 4000 })
  await expect(page.locator(".remote-card")).toHaveCount(0)
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

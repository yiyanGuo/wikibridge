import { expect, test } from "@playwright/test"
import { enqueueOpenResult, getClipboardText, prepareSystemTestPage } from "./test-utils"

test("creates a local knowledge project and opens its reader", async ({ page }) => {
  await prepareSystemTestPage(page, { projects: [] })

  await enqueueOpenResult(page, "/tmp/wikibridge/new-project")
  await page.getByLabel("项目名称").fill("测试知识库")
  await page.getByRole("button", { name: "选择" }).click()
  await expect(page.getByLabel("项目保存位置")).toHaveValue("/tmp/wikibridge/new-project")
  await page.getByRole("button", { name: "创建项目" }).click()

  await expect(page.getByText("项目已创建")).toBeVisible()
  await expect(page.getByRole("heading", { name: "测试知识库" })).toBeVisible()

  await page.getByRole("button", { name: "进入项目" }).click()
  await expect(page.getByRole("heading", { name: "测试知识库" })).toBeVisible()
  await expect(page.getByText("Intro.md")).toBeVisible()
  await expect(
    page.locator(".reader-content-heading").getByRole("heading", { name: "Intro" }),
  ).toBeVisible()

  await page.getByRole("button", { name: "返回" }).click()
  await expect(page.getByRole("heading", { name: "知识库项目" })).toBeVisible()
})

test("logs in and manages a published Chat connection", async ({ page }) => {
  await prepareSystemTestPage(page)

  await page.getByRole("button", { name: "登录连接" }).click()
  await page.getByLabel("用户名").fill("alice")
  await page.getByLabel("密码").fill("secret")
  await page.locator(".auth-panel form").getByRole("button", { name: "登录" }).click()

  await expect(page.getByText("alice")).toBeVisible()
  await page.getByLabel("选择知识库项目").selectOption({ label: "示例知识库" })
  await page.getByRole("button", { name: "发布 API" }).click()
  await expect(page.getByText("知识库 API 分享连接已创建")).toBeVisible()
  await expect(page.getByRole("heading", { name: "示例知识库" })).toBeVisible()

  await page.getByRole("button", { name: "开启访问" }).click()
  await expect(page.locator(".alert.notice")).toHaveText("访问已开启")
  await expect(page.getByText("https://wiki.example.test/api/v1")).toBeVisible()

  await page.getByTitle("复制访问地址").click()
  await expect.poll(() => getClipboardText(page)).toBe("https://wiki.example.test/api/v1")
  await expect(page.getByText("访问地址已复制")).toBeVisible()

  await page.getByRole("button", { name: "关闭访问" }).click()
  await expect(page.locator(".alert.notice")).toHaveText("访问已关闭")
})

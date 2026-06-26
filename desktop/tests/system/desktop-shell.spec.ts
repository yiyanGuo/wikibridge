import { expect, test } from "@playwright/test"
import { getInvocations, prepareSystemTestPage } from "./test-utils"

test("switches between BearFRP and remote OpenCode entries", async ({ page }) => {
  await prepareSystemTestPage(page)

  await expect(page.getByRole("button", { name: /发布端/ })).toHaveClass(/active/)
  await expect(page.getByRole("heading", { name: "知识库项目" })).toBeVisible()

  await page.getByRole("button", { name: /消费端/ }).click()
  await expect(page.getByRole("button", { name: /消费端/ })).toHaveClass(/active/)
  await expect(page.getByRole("heading", { name: "添加远程知识库" })).toBeVisible()

  await page.getByRole("button", { name: /发布端/ }).click()
  await expect(page.getByRole("heading", { name: "知识库项目" })).toBeVisible()
})

test("saves BearFRP backend URL and records the Tauri command", async ({ page }) => {
  await prepareSystemTestPage(page, { services: { bearfrpBackendUrl: "" } })

  await expect(page.getByText("请先配置远端发布端后端 URL。")).toBeVisible()
  const backendForm = page.locator("form").filter({ hasText: "发布端后端" })
  await backendForm.getByLabel("发布端后端").fill("https://bearfrp.new.example")
  await backendForm.getByRole("button", { name: "保存" }).click()

  await expect(page.getByText("发布端后端已保存")).toBeVisible()
  await expect(page.getByText("请先配置远端发布端后端 URL。")).toBeHidden()

  const invocations = await getInvocations(page)
  expect(invocations).toContainEqual({
    command: "set_bearfrp_backend_url",
    args: { url: "https://bearfrp.new.example" },
  })
})

test("shows a user-facing error when backend save fails", async ({ page }) => {
  await prepareSystemTestPage(page, {
    commandFailures: {
      set_bearfrp_backend_url: "后端地址不可用",
    },
  })

  const backendForm = page.locator("form").filter({ hasText: "发布端后端" })
  await backendForm.getByLabel("发布端后端").fill("https://bad.example")
  await backendForm.getByRole("button", { name: "保存" }).click()

  await expect(page.getByText("后端地址不可用")).toBeVisible()
})

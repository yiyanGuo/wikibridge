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

test("uses the fixed BearFRP backend without showing backend settings", async ({ page }) => {
  await prepareSystemTestPage(page, { services: { bearfrpBackendUrl: "" } })

  await expect(page.getByRole("heading", { name: "知识库项目" })).toBeVisible()
  await expect(page.getByText("请先配置远端发布端后端 URL。")).toHaveCount(0)
  await expect(page.getByLabel("发布端后端")).toHaveCount(0)

  const state = await page.evaluate(() => window.__wikibridgeSystemTest?.getState())
  expect(state?.services?.bearfrpBackendUrl).toBe("https://frp.muleizh.ink")

  const invocations = await getInvocations(page)
  expect(invocations.some((invocation) => invocation.command === "set_bearfrp_backend_url")).toBe(
    false,
  )
})

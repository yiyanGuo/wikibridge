import { expect, test } from "@playwright/test"
import { getOpenCalls, prepareSystemTestPage, setConfirmResult } from "./test-utils"

test("shows login failures and supports logout", async ({ page }) => {
  await prepareSystemTestPage(page, {
    commandFailures: {
      login_user: "用户名或密码错误",
    },
  })

  await page.getByRole("button", { name: "登录连接" }).click()
  await page.getByLabel("用户名").fill("alice")
  await page.getByLabel("密码").fill("wrong")
  await page.locator(".auth-panel form").getByRole("button", { name: "登录" }).click()
  await expect(page.getByText("用户名或密码错误")).toBeVisible()
  await expect(page.getByText("用户名或密码错误")).toBeHidden({ timeout: 4000 })
  await expect(page.getByLabel("密码")).toBeVisible()

  await page.evaluate(() => window.__wikibridgeSystemTest?.clearCommandFailure("login_user"))
  await page.getByLabel("密码").fill("secret")
  await page.locator(".auth-panel form").getByRole("button", { name: "登录" }).click()
  await expect(page.getByText("alice")).toBeVisible()

  await page.getByTitle("退出").click()
  await expect(page.getByText("本地知识库")).toBeVisible()
})

test("reports recharge failures without changing the account summary", async ({ page }) => {
  await prepareSystemTestPage(page, {
    authenticated: true,
    user: { username: "alice", balance_mb: 100 },
    commandFailures: {
      recharge_user: "可用额度暂时无法充值",
    },
  })

  await expect(page.getByText("可用额度：100 MB")).toBeVisible()
  await page.getByRole("button", { name: "免费充值" }).click()
  await expect(page.getByText("可用额度暂时无法充值")).toBeVisible()
  await expect(page.getByText("可用额度暂时无法充值")).toBeHidden({ timeout: 4000 })
  await expect(page.getByText("可用额度：100 MB")).toBeVisible()
})

test("opens and deletes a published access connection with confirmation", async ({ page }) => {
  await prepareSystemTestPage(page, {
    authenticated: true,
    user: { username: "alice", balance_mb: 100 },
    connections: [
      {
        connection_id: "connection-1",
        project_id: "project-1",
        project_name: "示例知识库",
        proxy_id: 1,
        public_url: "https://wiki.example.test/api/v1/existing",
        running: true,
        enabled: true,
        service_ready: true,
        traffic_limit_mb: 100,
        traffic_used_bytes: 0,
        status: "running",
      },
    ],
  })

  await page.getByRole("button", { name: "访问连接" }).click()
  await page.getByTitle("打开访问地址").click()
  await expect
    .poll(() => getOpenCalls(page))
    .toContainEqual({
      url: "https://wiki.example.test/api/v1/existing",
      target: "_blank",
    })

  await setConfirmResult(page, false)
  await page.getByTitle("删除连接").click()
  await expect(page.getByText("https://wiki.example.test/api/v1/existing")).toBeVisible()

  await setConfirmResult(page, true)
  await page.getByTitle("删除连接").click()
  await expect(page.getByText("知识库 API 分享连接已删除")).toBeVisible()
  await expect(page.getByText("https://wiki.example.test/api/v1/existing")).toBeHidden()
})

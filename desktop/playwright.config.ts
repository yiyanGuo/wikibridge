import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/system",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:1421",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run test:system:server",
    url: "http://127.0.0.1:1421",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})

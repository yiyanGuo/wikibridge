# Playwright 人工测试截图说明

生成时间：2026/6/26 19:43:53 Asia/Shanghai

## 执行命令

```bash
cd /root/SE/wikibridge
node scripts/capture-manual-ui-screenshots.mjs
```

可选环境变量：

```bash
WIKIBRIDGE_BASE_URL=http://127.0.0.1:18080
WIKIBRIDGE_BEARFRP_PUBLIC_URL=http://127.0.0.1:52600
WIKIBRIDGE_SCREENSHOT_DIR=/root/SE/doc/软件测试报告/screen-shot
```

## 当前环境

- Node：22.13.1
- 本地入口：http://127.0.0.1:18080
- BearFRP 发布入口：http://127.0.0.1:52600
- 截图目录：/root/SE/doc/软件测试报告/screen-shot
- Playwright 依赖：desktop/node_modules/playwright

## 截图清单

| 测试项 | 文件 | 结果 | 证据来源 | 说明 |
| --- | --- | --- | --- | --- |
| T-07 | T-07-local-entry-opencode-kb-home.png | PASS | real-ui | 检查入口 HTTP 200 且 meta[name="opencode-kb-mode"] 为 1。 |
| T-03 | T-03-kb-mode-meta-and-ui.png | PASS | real-ui | 页面暴露 KB mode meta，并显示 OpenCode KB 入口 UI。 |
| T-07 | T-07-llm-wiki-knowledge-base-page.png | PASS | real-ui | 真实 /llm-wiki UI 呈现 Knowledge Base、项目选择器和文件树。 |
| T-07 | T-07-llm-wiki-graph-view.png | PASS | real-ui | 真实 /llm-wiki UI 显示 Graph 节点和边。 |
| T-07 | T-07-llm-wiki-file-content.png | PASS | real-ui | 点击 index.md 后显示 Markdown 内容。 |
| T-07 | T-07-llm-wiki-search-results.png | PASS | real-ui | 搜索 WikiBridge 后显示 Search results。 |
| T-08 | T-08-xss-no-alert-llm-wiki-content.png | PASS | real-ui | 打开包含 <script>alert(1)</script> 的真实 Wiki 页面并监听 dialog，未捕获浏览器弹窗。 |
| T-07 | T-07-bearfrp-published-entry.png | PASS | real-ui | BearFRP 发布入口可访问，并返回 OpenCode KB shell。 |
| T-09 | T-09-desktop-project-dashboard.png | PASS | real-ui | 桌面端发布端项目仪表盘可见。 |
| T-09 | T-09-desktop-compile-ready.png | PASS | real-ui | 桌面端显示 LLM Wiki 配置和项目构建入口。 |
| T-09 | T-09-desktop-link-report-ready.png | PASS | real-ui | 桌面端显示知识库 API 分享连接入口或登录态连接入口。 |
| T-09 | T-09-desktop-local-wiki-reader.png | PASS | real-ui | 桌面端消费端远程知识库入口可见。 |

## T-09 跳过说明

T-09 已在当前 Node 环境下尝试执行桌面端截图路径。

## 备注

脚本会先执行 `node scripts/test-tasks.mjs --prepare-blackbox-data`，确保 `sample-wiki` 测试项目存在。
T-03、T-07、T-08 的截图均要求真实浏览器 UI 断言先通过；若 `/llm-wiki` 页面、文件点击、搜索结果或 XSS dialog 监听失败，脚本会直接失败退出。

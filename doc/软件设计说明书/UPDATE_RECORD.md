# WikiBridge 软件设计说明书更新记录

更新时间：2026-06-26 16:01 CST

## 本次更新

- 将《软件设计规格说明书》从 V1.0 更新为 V1.1。
- 根据联调后的最终架构修正文档主线：
  - B 端只发布 LLM-Wiki API。
  - S 端提供 BearFRP/frps 控制面和公网转发。
  - C 端本地运行 OpenCode，并通过 llm-wiki MCP 消费远程知识库。
- 删除旧主线中“B 端发布静态 Wiki / 消费端浏览器 + Chatbox”为主方案的表述，仅保留静态 Wiki 作为可选降级方向。
- 重画/修正了总体架构图、用例图、核心流程图和部署图。
- 修正了 UI 设计、用例设计、构件/类设计、数据设计、异常处理、测试设计和结论。
- 明确写入安全边界：
  - B 端不暴露完整 OpenCode。
  - C 端保存自己的模型供应商、模型名和 API Key。
  - S 端不保存知识正文、原始资料或问答上下文。
  - OpenCode KB 模式与 llm-wiki MCP 白名单限制工具能力。

## 输出文件

- 正式 PDF：`/root/SE/doc/软件设计说明书/软件设计说明书.pdf`
- 解压后更新的 LaTeX 源码：`/root/SE/doc/软件设计说明书/work/reference/wikibridge_spec.tex`
- 解压后编译出的 PDF：`/root/SE/doc/软件设计说明书/work/reference/wikibridge_spec.pdf`

## 编译结果

- 使用 `latexmk -xelatex` 编译通过。
- 输出 PDF 共 18 页。
- 编译日志仅有字体和 underfull hbox 级别的排版警告，没有阻断性错误。
- 已将编译出的 `wikibridge_spec.pdf` 覆盖到正式路径 `软件设计说明书.pdf`。

## 未执行事项

- 未重新打包 `reference.zip`。
- 原始 `reference.zip` 仍保留为用户提供的源码包。

/**
 * B端简化版主入口
 * 修改 main.tsx 使用 BApp 作为入口
 */

import React from "react"
import ReactDOM from "react-dom/client"
import { BApp } from "./BApp"
import "./globals.css"

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BApp />
  </React.StrictMode>,
)

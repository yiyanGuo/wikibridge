import React from "react"
import ReactDOM from "react-dom/client"
import { BApp } from "./BApp"
import "./index.css"

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BApp />
  </React.StrictMode>,
)

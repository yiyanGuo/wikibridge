#!/usr/bin/env bun
import fs from "fs"
import path from "path"
import { $ } from "bun"

const root = path.resolve(import.meta.dirname, "..")
const appDir = path.join(root, "packages", "app")
const dist = path.join(appDir, "dist")
const output = path.join(root, "packages", "opencode", "opencode-web-ui.gen.ts")

if (!fs.existsSync(dist)) {
  console.log("Building web UI...")
  await $`bun run --cwd ${appDir} build`
}

const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist })))
  .map((file) => file.replaceAll("\\", "/"))
  .filter((file) => !file.endsWith(".map"))
  .sort()

const imports = files.map((file, i) => {
  const spec = path.relative(path.dirname(output), path.join(dist, file)).replaceAll("\\", "/")
  return `import file_${i} from ${JSON.stringify(spec.startsWith(".") ? spec : `./${spec}`)} with { type: "file" };`
})

const entries = files.map((file, i) => `  ${JSON.stringify(file)}: file_${i},`)

const content = [
  "// Auto-generated embedded web UI bundle",
  ...imports,
  "export default {",
  ...entries,
  "}",
].join("\n")

fs.writeFileSync(output, content)
console.log(`Wrote embedded UI bundle to ${output}`)

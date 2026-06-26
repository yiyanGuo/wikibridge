export const supportedPlatforms = [
  "darwin-arm64",
  "darwin-amd64",
  "linux-arm64",
  "linux-amd64",
  "windows-amd64",
]

const rustTargets = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-amd64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-amd64": "x86_64-unknown-linux-gnu",
  "windows-amd64": "x86_64-pc-windows-msvc",
}

const opencodePackages = {
  "darwin-arm64": "opencode-darwin-arm64",
  "darwin-amd64": "opencode-darwin-x64",
  "linux-arm64": "opencode-linux-arm64",
  "linux-amd64": "opencode-linux-x64",
  "windows-amd64": "opencode-windows-x64",
}

export function hostPlatformKey() {
  const os =
    process.platform === "darwin"
      ? "darwin"
      : process.platform === "win32"
        ? "windows"
        : process.platform === "linux"
          ? "linux"
          : failUnsupported(`Unsupported OS: ${process.platform}`)
  const arch =
    process.arch === "arm64"
      ? "arm64"
      : process.arch === "x64"
        ? "amd64"
        : failUnsupported(`Unsupported arch: ${process.arch}`)
  if (os === "windows") return "windows-amd64"
  return `${os}-${arch}`
}

export function parsePlatformArg(args) {
  let platform = hostPlatformKey()
  const rest = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--platform") {
      const value = args[index + 1]
      if (!value) failUnsupported("--platform requires a value")
      platform = normalizePlatform(value)
      index += 1
      continue
    }
    if (arg.startsWith("--platform=")) {
      platform = normalizePlatform(arg.slice("--platform=".length))
      continue
    }
    rest.push(arg)
  }

  assertSupportedPlatform(platform)
  return { platform, args: rest }
}

export function executableName(platform, name) {
  return platform.startsWith("windows-") ? `${name}.exe` : name
}

export function rustTargetTriple(platform) {
  assertSupportedPlatform(platform)
  return rustTargets[platform]
}

export function opencodePackageKey(platform) {
  assertSupportedPlatform(platform)
  return opencodePackages[platform]
}

export function assertSupportedPlatform(platform) {
  if (!supportedPlatforms.includes(platform)) {
    failUnsupported(
      `Unsupported platform "${platform}". Supported platforms: ${supportedPlatforms.join(", ")}`,
    )
  }
}

function normalizePlatform(platform) {
  return platform === "current" ? hostPlatformKey() : platform
}

function failUnsupported(message) {
  throw new Error(message)
}

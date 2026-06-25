import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ConfigService } from "@/effect/config-service"
import { Config, Layer, Option } from "effect"

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "")
  if (!trimmed) return "http://127.0.0.1:19828/api/v1"
  return trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`
}

export class Service extends ConfigService.Service<Service>()("@opencode/LlmWikiConfig", {
  baseUrl: Config.string("LLM_WIKI_BASE_URL").pipe(
    Config.withDefault("http://127.0.0.1:19828/api/v1"),
    Config.map(normalizeBaseUrl),
  ),
  token: Config.string("LLM_WIKI_TOKEN").pipe(Config.option, Config.map(Option.filter((value) => value.trim().length > 0))),
}) {}

export const defaultLayer = Service.defaultLayer.pipe(Layer.orDie)

export const node = LayerNode.make(defaultLayer, [])

export * as LlmWikiConfig from "./config"

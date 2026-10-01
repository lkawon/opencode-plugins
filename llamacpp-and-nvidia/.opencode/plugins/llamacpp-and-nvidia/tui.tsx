/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import {
  fetchStats,
  type Gpu,
  type LlamacppSlot,
  type ModelPerformance,
  type Stats,
} from "../../lib/llamacpp-client"

const REFRESH_MS = 1_000
const CURRENT_STALE_S = 15

const tui: TuiPlugin = async (api) => {
  const [stats, setStats] = createSignal<Stats>({})
  const [online, setOnline] = createSignal(true)
  const [lastError, setLastError] = createSignal("")

  const refresh = async () => {
    try {
      setStats(await fetchStats())
      setOnline(true)
      setLastError("")
    } catch (error) {
      setOnline(false)
      setLastError(error instanceof Error ? error.message : String(error))
    }
    api.renderer.requestRender()
  }

  await refresh()
  const timer = setInterval(refresh, REFRESH_MS)
  api.lifecycle.onDispose(() => clearInterval(timer))

  api.slots.register({
    order: 50,
    slots: {
      sidebar_content() {
        return <Panel stats={stats()} online={online()} lastError={lastError()} />
      },
    },
  })
}

function Panel(props: { stats: Stats; online: boolean; lastError: string }) {
  return <box flexDirection="column">
    <GpuSection gpus={props.stats.gpu?.gpus ?? []} />
    <text> </text>
    <ModelSection
      online={props.online}
      lastError={props.lastError}
      available={props.stats.llamacpp?.available}
      error={props.stats.llamacpp?.error}
      model={props.stats.llamacpp?.model}
      slot={props.stats.llamacpp?.slots?.[0]}
      performance={props.stats.llamacpp?.performance}
      log={props.stats.llamacpp?.log}
      modelId={props.stats.llamacpp?.model?.id ?? props.stats.llamacpp?.model_id ?? ""}
    />
  </box>
}

function GpuSection(props: { gpus: Gpu[] }) {
  if (props.gpus.length === 0) {
    return <text fg="gray">GPU: NVML unavailable</text>
  }
  return <>{props.gpus.map((gpu) => <box flexDirection="column">
    <text>{(gpu.name ?? "GPU").replace("NVIDIA ", "")}</text>
    <text fg="gray">{vramLine(gpu)}</text>
    <text fg="gray">
      GPU {gpu.gpu_utilization_percent ?? 0}%  {gpu.temperature_c ?? 0}°C  {Math.round(gpu.power_draw_w ?? 0)} W
    </text>
  </box>)}</>
}

function vramLine(gpu: Gpu) {
  const used = gpu.memory_used_mib ?? 0
  const total = gpu.memory_total_mib ?? 0
  const percent = total ? Math.round((used / total) * 100) : 0
  return `VRAM ${used} / ${total} MiB (${percent}%)`
}

type SlotState = { state: string; progress?: number }

function decodedTokens(slot?: LlamacppSlot) {
  return slot?.next_token?.reduce((sum, token) => sum + (token.n_decoded ?? 0), 0) ?? 0
}

function slotState(slot?: LlamacppSlot): SlotState {
  if (!slot) return { state: "unknown" }
  if (!slot.is_processing) return { state: "idle" }
  const decoded = decodedTokens(slot)
  if (decoded > 0) return { state: "generating" }
  return { state: "processing prompt" }
}

function statusLabel(state: SlotState) {
  return state.state
}

function ModelSection(props: {
  online: boolean
  lastError: string
  available?: boolean
  error?: string
  model?: { name?: string; id?: string; n_ctx?: number; n_params?: number; size?: number; ftype?: string }
  slot?: LlamacppSlot
  performance?: Record<string, ModelPerformance> & { last_updated?: number }
  log?: { prompt_progress?: number | null; tg_3s?: number | null; updated_at?: number }
  modelId: string
}) {
  const perf = () => props.performance?.[props.modelId]
  const titleText = () => {
    if (!props.online) return "llama.cpp offline"
    if (!props.available) return "llama.cpp offline"
    return (props.model?.name ?? props.model?.id ?? "no model loaded").slice(0, 24)
  }
  const contextText = () => {
    if (!props.online) return "llama.cpp offline"
    if (!props.available) return " "
    return `context size ${props.model?.n_ctx ?? "?"}`
  }
  const speedText = () => props.log?.tg_3s?.toFixed(1) ?? perf()?.current_tokens_per_second?.toFixed(1) ?? "\u2014"
  const tokensText = () => {
    const current = speedText()
    const avg = perf()?.average_tokens_per_second?.toFixed(1) ?? "\u2014"
    const max = perf()?.max_tokens_per_second?.toFixed(1) ?? "\u2014"
    return `${current} ${avg} ${max}`
  }
  const statusText = () => {
    if (!props.online) return " "
    if (!props.available || !props.model) return " "
    const state = slotState(props.slot)
    if (state.state === "processing prompt") {
      const progress = typeof props.log?.prompt_progress === "number" ? props.log.prompt_progress : 0
      return `processing prompt ${Math.round(progress * 100)}%`
    }
    if (state.state === "generating") return `generating ${decodedTokens(props.slot)} generated tokens`
    return statusLabel(state)
  }
  const showDetails = () => props.online && props.available
  const showTokenLine = () => props.online && props.available && !!props.model

  return <box flexDirection="column">
    <text>{titleText()}</text>
    <text fg="gray" height={showDetails() ? 1 : 0}>{showDetails() ? contextText() : ""}</text>
    <text fg="gray" height={showDetails() ? 1 : 0}>{showDetails() ? statusText() : ""}</text>
    <text fg="gray" height={showTokenLine() ? 1 : 0}>{showTokenLine() ? `tokens ${tokensText()}` : ""}</text>
  </box>
}

function quantLine(model: { ftype?: string; n_params?: number; size?: number }) {
  const parts: string[] = []
  if (model.ftype) parts.push(model.ftype)
  if (model.n_params) parts.push(`${(model.n_params / 1e9).toFixed(0)}B`)
  if (model.size) parts.push(`${(model.size / 1024 / 1024 / 1024).toFixed(1)} GB`)
  return parts.join("  ") || "model"
}

function currentSpeed(perf: ModelPerformance | undefined, lastUpdated: number | undefined) {
  if (!perf || typeof perf.current_tokens_per_second !== "number") return "\u2014"
  if (typeof perf.updated_at !== "number" || typeof lastUpdated !== "number") return "\u2014"
  if (lastUpdated - perf.updated_at > CURRENT_STALE_S) return "\u2014"
  return perf.current_tokens_per_second.toFixed(1)
}

const plugin: TuiPluginModule & { id: string } = { id: "llamacpp-and-nvidia.sidebar", tui }
export default plugin

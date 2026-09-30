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
  if (!props.online) {
    return <box flexDirection="column">
      <text>llama.cpp</text>
      <text fg="red">Telemetry offline</text>
      <text fg="gray">{props.lastError || "server unreachable"}</text>
    </box>
  }

  return <box flexDirection="column">
    <GpuSection gpus={props.stats.gpu?.gpus ?? []} />
    <text> </text>
    <ModelSection
      available={props.stats.llamacpp?.available}
      error={props.stats.llamacpp?.error}
      model={props.stats.llamacpp?.model}
      slot={props.stats.llamacpp?.slots?.[0]}
      performance={props.stats.llamacpp?.performance}
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

function slotState(slot?: LlamacppSlot): SlotState {
  if (!slot) return { state: "unknown" }
  if (!slot.is_processing) return { state: "idle" }
  const total = slot.n_prompt_tokens ?? 0
  const processed = slot.n_prompt_tokens_processed ?? 0
  if (total > 0 && processed < total) {
    return { state: "processing prompt", progress: processed / total }
  }
  return { state: "generating" }
}

function statusLabel(state: SlotState) {
  if (state.state === "processing prompt" && typeof state.progress === "number") {
    const pct = state.progress <= 1 ? state.progress * 100 : state.progress
    return `processing prompt (${Math.round(pct)}%)`
  }
  return state.state
}

function ModelSection(props: {
  available?: boolean
  error?: string
  model?: { name?: string; id?: string; n_ctx?: number; n_params?: number; size?: number; ftype?: string }
  slot?: LlamacppSlot
  performance?: Record<string, ModelPerformance> & { last_updated?: number }
  modelId: string
}) {
  if (!props.available) {
    return <text fg="gray">llama.cpp offline: {props.error ?? "unreachable"}</text>
  }
  if (!props.model) {
    return <text fg="gray">no model loaded</text>
  }

  const perf = props.performance?.[props.modelId]
  const lastUpdated = props.performance?.last_updated
  const speeds = [
    currentSpeed(perf, lastUpdated),
    perf?.max_tokens_per_second?.toFixed(1) ?? "\u2014",
    perf?.average_tokens_per_second?.toFixed(1) ?? "\u2014",
  ].join(" ")

  return <box flexDirection="column">
    <text>{(props.model.name ?? props.model.id ?? "?").slice(0, 24)}</text>
    <text fg="gray">{quantLine(props.model)}</text>
    <text fg="gray">ctx {props.model.n_ctx?.toLocaleString() ?? "?"}</text>
    <text fg="gray">status {statusLabel(slotState(props.slot))}</text>
    <text fg="gray">Tokens/s {speeds}</text>
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

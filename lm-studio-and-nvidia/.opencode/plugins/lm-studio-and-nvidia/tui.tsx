/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"

type Gpu = {
  name?: string
  memory_used_mib?: number
  memory_total_mib?: number
  gpu_utilization_percent?: number
  temperature_c?: number
  power_draw_w?: number
}

type Stats = {
  gpu?: { gpus?: Gpu[] }
  lmstudio?: {
    available?: boolean
    models?: Array<{ display_name?: string; key?: string; loaded_instances?: unknown[] }>
    loaded_models?: unknown[]
    performance?: {
      model?: string
      tokens_per_second?: number | null
      models?: Record<string, ModelPerformance>
      activity?: Record<string, ModelActivity>
    }
  }
}

type ModelPerformance = {
  current_tokens_per_second?: number | null
  max_tokens_per_second?: number | null
  average_tokens_per_second?: number | null
  sample_count?: number
}

type ModelActivity = {
  generated_tokens?: number
  prompt_tokens_processed?: number
  prompt_tokens_total?: number
  prompt_processing_progress?: number
}

const endpoint = () => (process.env.GPU_STATS_URL ?? "http://127.0.0.1:8765").replace(/\/$/, "")
const token = () => process.env.GPU_STATS_TOKEN ?? "token123"

const tui: TuiPlugin = async (api) => {
  const [stats, setStats] = createSignal<Stats>({})

  const refresh = async () => {
    try {
      const headers: Record<string, string> = { Accept: "application/json" }
      headers.Authorization = `Bearer ${token()}`
      const response = await fetch(`${endpoint()}/stats`, { headers })
      if (response.ok) {
        setStats(await response.json() as Stats)
        api.renderer.requestRender()
      }
    } catch {
      // The server may be temporarily unavailable; keep the last known state.
    }
  }

  await refresh()
  const timer = setInterval(refresh, 1000)
  api.lifecycle.onDispose(() => clearInterval(timer))

  api.slots.register({
    order: 50,
    slots: {
      sidebar_content() {
        return <Panel stats={stats()} />
      },
    },
  })
}

function Panel(props: { stats: Stats }) {
  const gpu = () => props.stats.gpu?.gpus?.[0]
  const models = () => (props.stats.lmstudio?.models ?? []).filter((model) => (model.loaded_instances?.length ?? 0) > 0)
  const performance = () => props.stats.lmstudio?.performance
  const used = () => gpu()?.memory_used_mib ?? 0
  const total = () => gpu()?.memory_total_mib ?? 0
  const percent = () => total() ? Math.round(used() / total() * 100) : 0
  const gpuName = () => (gpu()?.name ?? "GPU offline").replace("NVIDIA ", "")

  return <box flexDirection="column">
    <text>{gpuName()}</text>
    <text fg="gray">VRAM {used()} / {total()} MiB ({percent()}%)</text>
    <text fg="gray">GPU {gpu()?.gpu_utilization_percent ?? 0}%  {gpu()?.temperature_c ?? 0}°C</text>
    <text fg="gray">Power {(gpu()?.power_draw_w ?? 0).toFixed(0)} W</text>
    <text> </text>
    {props.stats.lmstudio?.available
      ? <>{models().slice(0, 5).map((model, index) => <>
          {index > 0 && <text> </text>}
          <text>{(model.display_name ?? model.key ?? "?").slice(0, 24)}</text>
          <ModelStatus model={model} performance={performance()} loaded={props.stats.lmstudio?.loaded_models} />
          <text fg="gray">Tokens/s {speedValues(model, performance())}</text>
        </>)}</>
      : <text fg="gray">Offline</text>}
  </box>
}

function ModelStatus(props: {
  model: { key?: string }
  performance: { activity?: Record<string, ModelActivity> } | undefined
  loaded: unknown[] | undefined
}) {
  const status = () => statusFor(props.model, props.loaded)
  const detail = () => status() === "processing prompt"
    ? promptProgressLine(props.model, props.performance)
    : generatedTokensLine(props.model, props.performance, props.loaded)
  return <>
    <text fg="gray">Status {status()}{detail() ? ` (${detail()})` : ""}</text>
  </>
}

function statusFor(model: { key?: string }, loaded: unknown[] | undefined) {
  const key = (model.key ?? "").toLowerCase()
  const item = (loaded ?? []).find((entry) => JSON.stringify(entry).toLowerCase().includes(key))
  if (!item || typeof item !== "object") return "loaded"
  const value = item as Record<string, unknown>
  return String(value.generation_status ?? value.generationStatus ?? value.status ?? "idle")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .toLowerCase()
}

function speedFor(
  model: { key?: string },
  performance: { model?: string; tokens_per_second?: number | null; models?: Record<string, ModelPerformance>; activity?: Record<string, ModelActivity> } | undefined,
  field: keyof Pick<ModelPerformance, "current_tokens_per_second" | "max_tokens_per_second" | "average_tokens_per_second">,
) {
  const modelKey = (model.key ?? "").toLowerCase()
  const matched = Object.entries(performance?.models ?? {}).find(([key]) => {
    const performanceKey = key.toLowerCase()
    if (!performanceKey || !modelKey) return false
    return performanceKey.includes(modelKey) || modelKey.includes(performanceKey)
  })?.[1]
  const value = matched?.[field]
  if (typeof value === "number") return value.toFixed(1)

  // Compatibility with a telemetry server that has not been restarted yet.
  if (field !== "current_tokens_per_second" || !performance?.tokens_per_second) return "—"
  const active = (performance.model ?? "").toLowerCase()
  if (active && modelKey && !active.includes(modelKey)) return "—"
  return performance.tokens_per_second.toFixed(1)
}

function speedValues(
  model: { key?: string },
  performance: { model?: string; tokens_per_second?: number | null; models?: Record<string, ModelPerformance>; activity?: Record<string, ModelActivity> } | undefined,
) {
  return [
    speedFor(model, performance, "current_tokens_per_second"),
    speedFor(model, performance, "max_tokens_per_second"),
    speedFor(model, performance, "average_tokens_per_second"),
  ].join(" ")
}

function activityFor(
  model: { key?: string },
  performance: { activity?: Record<string, ModelActivity> } | undefined,
) {
  const modelKey = (model.key ?? "").toLowerCase()
  return Object.entries(performance?.activity ?? {}).find(([key]) => {
    const activityKey = key.toLowerCase()
    if (!activityKey || !modelKey) return false
    return activityKey.includes(modelKey) || modelKey.includes(activityKey)
  })?.[1]
}

function promptProgressLine(
  model: { key?: string },
  performance: { activity?: Record<string, ModelActivity> } | undefined,
) {
  const activity = activityFor(model, performance)
  const processed = activity?.prompt_tokens_processed
  const total = activity?.prompt_tokens_total
  let progress = activity?.prompt_processing_progress
  if (typeof progress !== "number" && typeof processed === "number" && typeof total === "number" && total > 0) {
    progress = processed / total
  }
  if (typeof progress !== "number" && typeof processed !== "number") return ""
  const percent = typeof progress === "number" ? `${Math.round((progress <= 1 ? progress * 100 : progress))}%` : "?%"
  const tokens = typeof processed === "number"
    ? ` (${processed}${typeof total === "number" ? `/${total}` : ""})`
    : ""
  return `${percent}${tokens}`
}

function generatedTokensLine(
  model: { key?: string },
  performance: { activity?: Record<string, ModelActivity> } | undefined,
  loaded: unknown[] | undefined,
) {
  if (statusFor(model, loaded) !== "generating") return ""
  const generated = activityFor(model, performance)?.generated_tokens
  if (typeof generated !== "number") return ""
  return `${generated}`
}

const plugin: TuiPluginModule & { id: string } = { id: "lm-studio-and-nvidia.sidebar", tui }
export default plugin

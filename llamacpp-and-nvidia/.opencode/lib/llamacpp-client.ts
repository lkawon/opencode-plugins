import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type Gpu = {
  name?: string
  memory_used_mib?: number
  memory_total_mib?: number
  gpu_utilization_percent?: number
  temperature_c?: number
  power_draw_w?: number
}

export type LlamacppModel = {
  id?: string
  name?: string
  n_ctx?: number
  n_params?: number
  size?: number
  ftype?: string
}

export type LlamacppSlot = {
  id?: number
  is_processing?: boolean
  n_ctx?: number
  n_prompt_tokens?: number
  n_prompt_tokens_processed?: number
  n_prompt_tokens_cache?: number
  next_token?: Array<{ n_decoded?: number; has_next_token?: boolean }>
}

export type ModelPerformance = {
  current_tokens_per_second?: number
  max_tokens_per_second?: number
  average_tokens_per_second?: number
  sample_count?: number
  updated_at?: number
}

export type Llamacpp = {
  available?: boolean
  error?: string
  model?: LlamacppModel
  models?: LlamacppModel[]
  slots?: LlamacppSlot[]
  model_id?: string
  performance?: Record<string, ModelPerformance> & { last_updated?: number }
  log?: { prompt_progress?: number | null; tg_3s?: number | null; updated_at?: number }
}

export type Stats = {
  gpu?: { available?: boolean; error?: string; gpus?: Gpu[] }
  llamacpp?: Llamacpp
}

export function endpoint(): string {
  return (process.env.GPU_STATS_URL ?? "http://127.0.0.1:8765").replace(/\/$/, "")
}

export function token(): string {
  if (process.env.GPU_STATS_TOKEN) return process.env.GPU_STATS_TOKEN
  const path = process.env.GPU_STATS_TOKEN_PATH
    ?? join(homedir(), ".config", "opencode", "llamacpp-stats.token")
  try {
    return readFileSync(path, "utf8").trim()
  } catch {
    return ""
  }
}

export async function fetchStats(): Promise<Stats> {
  const response = await fetch(`${endpoint()}/stats`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token()}` },
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`GPU stats server HTTP ${response.status}`)
  return (await response.json()) as Stats
}

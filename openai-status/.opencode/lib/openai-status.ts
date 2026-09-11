import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export type QuotaWindow = {
  usedPercent: number
  remainingPercent: number
  windowSeconds: number
  resetAfterSeconds: number
}

export type OpenAIStatus = {
  available: boolean
  plan?: string
  limitReached?: boolean
  windows?: QuotaWindow[]
  error?: string
  fetchedAt: number
}

type OpenAIAuth = {
  type?: string
  access?: string
  expires?: number
}

type UsageWindow = {
  used_percent?: number
  limit_window_seconds?: number
  reset_after_seconds?: number
}

type UsageResponse = {
  plan_type?: string
  rate_limit?: {
    limit_reached?: boolean
    primary_window?: UsageWindow | null
    secondary_window?: UsageWindow | null
  } | null
}

const usageUrl = "https://chatgpt.com/backend-api/wham/usage"

function authPath() {
  if (process.env.OPENCODE_AUTH_PATH) return process.env.OPENCODE_AUTH_PATH
  const dataHome = process.env.XDG_DATA_HOME
  return dataHome
    ? join(dataHome, "opencode", "auth.json")
    : join(homedir(), ".local", "share", "opencode", "auth.json")
}

function jwtPayload(token: string): Record<string, unknown> | undefined {
  try {
    const value = token.split(".")[1]
    if (!value) return undefined
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
    return JSON.parse(Buffer.from(base64, "base64").toString("utf8")) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function accountId(token: string) {
  const payload = jwtPayload(token)
  const auth = payload?.["https://api.openai.com/auth"]
  if (!auth || typeof auth !== "object") return undefined
  const id = (auth as Record<string, unknown>).chatgpt_account_id
  return typeof id === "string" ? id : undefined
}

function quotaWindow(value: UsageWindow | null | undefined): QuotaWindow | undefined {
  if (!value) return undefined
  const usedPercent = Number(value.used_percent)
  const windowSeconds = Number(value.limit_window_seconds)
  const resetAfterSeconds = Number(value.reset_after_seconds)
  if (![usedPercent, windowSeconds, resetAfterSeconds].every(Number.isFinite)) return undefined
  return {
    usedPercent,
    remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
    windowSeconds,
    resetAfterSeconds,
  }
}

export async function fetchOpenAIStatus(): Promise<OpenAIStatus> {
  const fetchedAt = Date.now()
  try {
    const authFile = JSON.parse(await readFile(authPath(), "utf8")) as Record<string, OpenAIAuth | undefined>
    const auth = authFile.openai
    if (!auth || auth.type !== "oauth" || !auth.access) {
      return { available: false, error: "OpenAI OAuth is not connected", fetchedAt }
    }
    if (auth.expires && auth.expires <= fetchedAt) {
      return { available: false, error: "OpenAI OAuth token has expired", fetchedAt }
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${auth.access}`,
      "User-Agent": "OpenCode-OpenAI-Status/1.0",
    }
    const id = accountId(auth.access)
    if (id) headers["ChatGPT-Account-Id"] = id

    const response = await fetch(usageUrl, {
      headers,
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      return { available: false, error: `OpenAI usage API returned HTTP ${response.status}`, fetchedAt }
    }

    const body = await response.json() as UsageResponse
    const windows = [
      quotaWindow(body.rate_limit?.primary_window),
      quotaWindow(body.rate_limit?.secondary_window),
    ].filter((window): window is QuotaWindow => Boolean(window))

    return {
      available: true,
      plan: body.plan_type || "unknown",
      limitReached: Boolean(body.rate_limit?.limit_reached),
      windows,
      fetchedAt,
    }
  } catch (error) {
    const message = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)
      ? "OpenAI usage request timed out"
      : error instanceof SyntaxError
        ? "OpenCode authentication data is invalid"
        : error instanceof Error && "code" in error
          ? "OpenCode authentication file is unavailable"
          : error instanceof Error ? error.message : String(error)
    return { available: false, error: message, fetchedAt }
  }
}

export function windowLabel(seconds: number) {
  if (seconds >= 86_400) return `${Math.round(seconds / 86_400)}d limit`
  return `${Math.round(seconds / 3_600)}h limit`
}

export function resetLabel(seconds: number) {
  const totalMinutes = Math.max(0, Math.ceil(seconds / 60))
  const days = Math.floor(totalMinutes / 1_440)
  const hours = Math.floor((totalMinutes % 1_440) / 60)
  const minutes = totalMinutes % 60
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function displayPlan(plan: string | undefined) {
  if (!plan) return "OpenAI"
  return `OpenAI ${plan.charAt(0).toUpperCase()}${plan.slice(1)}`
}

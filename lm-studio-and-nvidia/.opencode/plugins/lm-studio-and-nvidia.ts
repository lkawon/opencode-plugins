import { type Plugin, tool } from "@opencode-ai/plugin"

type Stats = {
  gpu?: { gpus?: Array<Record<string, unknown>> }
  lmstudio?: Record<string, unknown>
}

const endpoint = () => (process.env.GPU_STATS_URL ?? "http://127.0.0.1:8765").replace(/\/$/, "")

export const LmStudioAndNvidiaPlugin: Plugin = async () => ({
  tool: {
    gpu_stats: tool({
      description: "Returns current GPU statistics and LM Studio model status.",
      args: {},
      async execute() {
        const headers: Record<string, string> = { Accept: "application/json" }
        if (process.env.GPU_STATS_TOKEN) {
          headers.Authorization = `Bearer ${process.env.GPU_STATS_TOKEN}`
        }
        const response = await fetch(`${endpoint()}/stats`, { headers })
        if (!response.ok) throw new Error(`GPU stats server HTTP ${response.status}`)
        return JSON.stringify(await response.json() as Stats, null, 2)
      },
    }),
  },
})

import { type Plugin, tool } from "@opencode-ai/plugin"
import { fetchStats, type Stats } from "../lib/llamacpp-client"

export const LlamacppAndNvidiaPlugin: Plugin = async () => ({
  tool: {
    gpu_stats: tool({
      description: "Returns current GPU statistics and llama.cpp model status.",
      args: {},
      async execute() {
        return JSON.stringify(await fetchStats(), null, 2)
      },
    }),
  },
})

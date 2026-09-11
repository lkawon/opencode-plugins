import { type Plugin, tool } from "@opencode-ai/plugin"
import { fetchOpenAIStatus } from "../lib/openai-status"

export const OpenAIStatusPlugin: Plugin = async () => ({
  tool: {
    openai_status: tool({
      description: "Returns ChatGPT/Codex subscription quota usage and reset windows.",
      args: {},
      async execute() {
        return JSON.stringify(await fetchOpenAIStatus(), null, 2)
      },
    }),
  },
})

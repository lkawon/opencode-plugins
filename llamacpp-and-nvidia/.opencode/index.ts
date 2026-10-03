import { Plugin } from "@opencode/plugin"
import { fetchStats } from "./lib/llamacpp-client"

export default Plugin.define({
  id: "llamacpp-and-nvidia",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "gpu_stats",
        description: "Returns current GPU statistics and llama.cpp model status.",
        input: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        async execute() {
          return { content: JSON.stringify(await fetchStats(), null, 2) }
        },
      })
    })
  },
})

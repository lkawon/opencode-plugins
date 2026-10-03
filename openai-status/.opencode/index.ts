import { Plugin } from "@opencode/plugin"
import { fetchOpenAIStatus } from "./lib/openai-status"

export default Plugin.define({
  id: "openai-status",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "openai_status",
        description: "Returns ChatGPT/Codex subscription quota usage and reset windows.",
        input: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        async execute() {
          return { content: JSON.stringify(await fetchOpenAIStatus(), null, 2) }
        },
      })
    })
  },
})

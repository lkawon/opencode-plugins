import assert from "node:assert/strict"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
process.env.OPENCODE_AUTH_PATH = join(here, "fixtures", "auth.json")

globalThis.fetch = async (url, options) => {
  assert.equal(url, "https://chatgpt.com/backend-api/wham/usage")
  assert.equal(options.headers["ChatGPT-Account-Id"], "acct_test")
  assert.match(options.headers.Authorization, /^Bearer ey/)
  return new Response(JSON.stringify({
    plan_type: "pro",
    rate_limit: {
      limit_reached: false,
      primary_window: {
        used_percent: 23.4,
        limit_window_seconds: 18_000,
        reset_after_seconds: 4_200,
      },
      secondary_window: {
        used_percent: 48,
        limit_window_seconds: 604_800,
        reset_after_seconds: 345_600,
      },
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } })
}

const module = await import("../.opencode/lib/openai-status.ts")
const status = await module.fetchOpenAIStatus()

assert.equal(status.available, true)
assert.equal(status.plan, "pro")
assert.equal(status.limitReached, false)
assert.equal(status.windows.length, 2)
assert.equal(status.windows[0].remainingPercent, 76.6)
assert.equal(module.windowLabel(status.windows[0].windowSeconds), "5h limit")
assert.equal(module.windowLabel(status.windows[1].windowSeconds), "7d limit")
assert.equal(module.resetLabel(status.windows[0].resetAfterSeconds), "1h 10m")

console.log("OpenAI status mock test passed")

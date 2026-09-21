import assert from "node:assert/strict"
import { copyFileSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const target = join(here, "fixtures", "auth-refresh-run.json")
mkdirSync(here, { recursive: true })
copyFileSync(join(here, "fixtures", "auth-refresh.json"), target)
process.env.OPENCODE_AUTH_PATH = target

globalThis.fetch = async (url, options) => {
  assert.equal(url, "https://auth.openai.com/oauth/token")
  assert.equal(options.method, "POST")
  assert.equal(options.headers["Content-Type"], "application/x-www-form-urlencoded")
  assert.match(options.body.toString(), /grant_type=refresh_token/)
  assert.match(options.body.toString(), /refresh_token=refresh_test_token/)
  return new Response(
    JSON.stringify({
      access_token: "new.access.token",
      refresh_token: "new_refresh_token",
      expires_in: 3_600,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )
}

const { refresh } = await import("../refresh-openai.mjs")
await refresh()

const data = JSON.parse(readFileSync(target, "utf8"))
assert.equal(data.openai.access, "new.access.token")
assert.equal(data.openai.refresh, "new_refresh_token")
assert.equal(data.openai.accountId, "acct_test")
assert.ok(data.openai.expires > Date.now() + 3_000 * 1_000)
assert.ok(data.openai.expires <= Date.now() + 3_600 * 1_000 + 1_000)

console.log("OpenAI refresh test passed")

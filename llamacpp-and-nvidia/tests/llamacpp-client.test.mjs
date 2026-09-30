import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { endpoint, token } = await import("../.opencode/lib/llamacpp-client.ts")

// endpoint(): trailing slash stripped, default fallback
process.env.GPU_STATS_URL = "http://127.0.0.1:9999/"
assert.equal(endpoint(), "http://127.0.0.1:9999")
delete process.env.GPU_STATS_URL
assert.equal(endpoint(), "http://127.0.0.1:8765")

// token(): from environment
process.env.GPU_STATS_TOKEN = "envtok"
assert.equal(token(), "envtok")
delete process.env.GPU_STATS_TOKEN

// token(): from the persisted token file
const dir = await mkdtemp(join(tmpdir(), "llamacpp-tok-"))
const tokenPath = join(dir, "llamacpp-stats.token")
await writeFile(tokenPath, "filetok\n")
process.env.GPU_STATS_TOKEN_PATH = tokenPath
assert.equal(token(), "filetok")
delete process.env.GPU_STATS_TOKEN_PATH
await rm(dir, { recursive: true, force: true })

console.log("llamacpp-client test passed")

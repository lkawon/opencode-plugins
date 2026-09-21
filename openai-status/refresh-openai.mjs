#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const tokenUrl = "https://auth.openai.com/oauth/token"
const clientID = "app_EMoamEEZ73f0CkXaXp7hrann"

function authPath() {
  if (process.env.OPENCODE_AUTH_PATH) return process.env.OPENCODE_AUTH_PATH
  const dataHome = process.env.XDG_DATA_HOME
  return dataHome
    ? join(dataHome, "opencode", "auth.json")
    : join(homedir(), ".local", "share", "opencode", "auth.json")
}

async function refresh() {
  const path = authPath()
  const data = JSON.parse(await readFile(path, "utf8"))
  const auth = data.openai
  if (!auth || auth.type !== "oauth") {
    throw new Error("OpenAI OAuth is not connected (run: opencode auth login --provider openai)")
  }
  if (!auth.refresh) {
    throw new Error("No refresh token in auth.json (run: opencode auth login --provider openai)")
  }

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: auth.refresh,
      client_id: clientID,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Token refresh failed: HTTP ${response.status} ${body}`.trim())
  }

  const tokens = await response.json()
  if (!tokens.access_token) {
    throw new Error(`Unexpected refresh response: ${JSON.stringify(tokens)}`)
  }

  auth.access = tokens.access_token
  if (tokens.refresh_token) auth.refresh = tokens.refresh_token
  if (tokens.expires_in) auth.expires = Date.now() + tokens.expires_in * 1_000
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`)

  const minutes = tokens.expires_in ? Math.round(tokens.expires_in / 60) : "unknown"
  console.log(`OpenAI token refreshed (valid for ~${minutes} min), saved to ${path}`)
}

export { authPath, refresh }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  refresh().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

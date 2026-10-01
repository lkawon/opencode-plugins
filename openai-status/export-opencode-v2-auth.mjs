#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

function authPath() {
  if (process.env.OPENCODE_AUTH_PATH) return process.env.OPENCODE_AUTH_PATH
  const dataHome = process.env.XDG_DATA_HOME
  return dataHome
    ? join(dataHome, "opencode", "auth.json")
    : join(homedir(), ".local", "share", "opencode", "auth.json")
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"))
  } catch (error) {
    if (error && error.code === "ENOENT") return {}
    throw error
  }
}

async function exportAuth() {
  const { stdout } = await execFileAsync("opencode", ["auth", "export"], {
    maxBuffer: 10 * 1024 * 1024,
  })
  const credentials = JSON.parse(stdout)
  const credential = credentials.find((item) => item.integrationID === "openai" && item.active)
    ?? credentials.find((item) => item.integrationID === "openai")
  if (!credential) throw new Error("No OpenAI credential found. Run: opencode auth login openai")

  const value = credential.value ?? {}
  if (value.type !== "oauth" || !value.access || !value.refresh) {
    throw new Error("Active OpenAI credential is not an OAuth credential with access/refresh tokens")
  }

  const path = authPath()
  const existing = await readJsonIfExists(path)
  existing.openai = {
    type: value.type,
    access: value.access,
    refresh: value.refresh,
    expires: value.expires,
  }

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(existing, null, 2)}\n`)
  console.log(`Wrote OpenAI compatibility auth file: ${path}`)
  console.log(`Using credential: ${credential.label ?? credential.id}`)
}

export { authPath, exportAuth }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  exportAuth().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

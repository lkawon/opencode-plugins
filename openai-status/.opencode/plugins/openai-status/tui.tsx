/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import {
  displayPlan,
  fetchOpenAIStatus,
  resetLabel,
  windowLabel,
  type OpenAIStatus,
} from "../../lib/openai-status"

const tui: TuiPlugin = async (api) => {
  const [status, setStatus] = createSignal<OpenAIStatus>({
    available: false,
    error: "Loading...",
    fetchedAt: Date.now(),
  })

  const refresh = async () => {
    setStatus(await fetchOpenAIStatus())
    api.renderer.requestRender()
  }

  api.slots.register({
    order: 60,
    slots: {
      sidebar_content() {
        return <Panel status={status()} />
      },
    },
  })

  void refresh()
  const timer = setInterval(refresh, 60_000)
  api.lifecycle.onDispose(() => clearInterval(timer))
}

function Panel(props: { status: OpenAIStatus }) {
  return <box flexDirection="column">
    {props.status.available
      ? <>
          <text>{displayPlan(props.status.plan)}</text>
          {(props.status.windows ?? []).map((window) => <>
            <text fg="gray">{windowLabel(window.windowSeconds)} {window.remainingPercent.toFixed(0)}% remaining</text>
            <text fg="gray">Resets in {resetLabel(window.resetAfterSeconds)}</text>
          </>)}
          {props.status.limitReached && <text fg="red">Limit reached</text>}
        </>
      : <>
          <text>OpenAI</text>
          <text fg="gray">{props.status.error ?? "Unavailable"}</text>
        </>}
  </box>
}

const plugin: TuiPluginModule & { id: string } = { id: "openai-status.sidebar", tui }
export default plugin

/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import {
  displayPlan,
  fetchOpenAIStatus,
  resetLabel,
  windowLabel,
  type OpenAIStatus,
} from "./lib/openai-status"

export default Plugin.define({
  id: "openai-status.sidebar",
  setup(context) {
    const [status, setStatus] = createSignal<OpenAIStatus>({
      available: false,
      error: "Loading...",
      fetchedAt: Date.now(),
    })

    const refresh = async () => {
      setStatus(await fetchOpenAIStatus())
    }

    void refresh()
    const timer = setInterval(refresh, 60_000)

    context.ui.slot({
      append: "sidebar.content",
      render: () => <Panel status={status()} />,
    })

    return () => clearInterval(timer)
  },
})

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

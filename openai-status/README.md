# OpenAI status panel for OpenCode

This plugin displays ChatGPT/Codex subscription quota windows in the OpenCode
right sidebar. It shows the account plan, remaining percentage, reset countdown,
and whether the limit has been reached.

## Requirements

- OpenCode authenticated with OpenAI OAuth (`/connect`, then OpenAI)
- ChatGPT Plus, Team, or Pro

The plugin reads OpenCode's OAuth credentials from
`~/.local/share/opencode/auth.json` and sends the access token only to
`https://chatgpt.com/backend-api/wham/usage`. It never renders, logs, stores, or
returns the token. The endpoint is internal and undocumented, so a future
ChatGPT change may require a plugin update.

## Local use

Start OpenCode from this directory. The local `.opencode/tui.json` loads the
sidebar panel automatically.

## Global installation

On Windows, run:

```cmd
install-global.cmd
```

On macOS or Linux, run:

```sh
sh ./install-global.sh
```

The installer requires `python3` and either `bun` or `npm`.

Restart OpenCode after installation. The installer preserves existing TUI
plugins, including `llamacpp-and-nvidia`.

The plugin also exposes an `openai_status` tool for on-demand diagnostics.

## Refresh behavior

Quota data is fetched once when the TUI starts and then every 60 seconds.

## Token refresh

If the status panel or tool reports `OpenAI OAuth token has expired`, refresh the
access token without re-logging in:

```sh
node refresh-openai.mjs
```

The script exchanges the stored `refresh` token at `https://auth.openai.com/oauth/token`
(the same endpoint OpenCode uses) and writes the new `access`, `refresh`, and
`expires` values back to `~/.local/share/opencode/auth.json`. No browser or
interactive login required. It needs Node 18+ (for `fetch`).

If the refresh token itself is rejected, log in again:

```sh
opencode auth login --provider openai
```

Note: restart OpenCode after refreshing so it picks up the new token.

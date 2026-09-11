# OpenCode sidebar plugins

This repository contains two independent OpenCode sidebar plugins:

- [`lm-studio-and-nvidia`](./lm-studio-and-nvidia) — NVIDIA GPU telemetry and loaded LM Studio model status.
- [`openai-status`](./openai-status) — ChatGPT/Codex subscription quota and reset times.

Each directory contains its own source files, local OpenCode configuration,
installation script, and documentation. Install both plugins to display both
sections in the right sidebar.

## Remote macOS installation

The NVIDIA/LM Studio telemetry server runs on the Windows GPU computer. On the
Mac, clone this repository and install both client-side OpenCode panels with:

```sh
sh ./install-macos.sh
```

The installer requires `python3` and either `bun` or `npm` on the Mac.

Configure the Mac shell with the Windows computer's LAN address and matching
token before starting OpenCode:

```sh
export GPU_STATS_URL="http://WINDOWS_IP:8765"
export GPU_STATS_TOKEN="token123"
opencode
```

Allow inbound TCP port `8765` through the Windows firewall only on a trusted
LAN. The `openai-status` panel uses the OpenAI OAuth login stored locally by
OpenCode on the Mac.

After installing both plugins globally, start the telemetry server and OpenCode
from the repository root with:

```cmd
run-opencode.cmd
```

To start only the Windows telemetry server without OpenCode, use:

```cmd
start-lmstudio-server.cmd
```

## Synchronizing the LM Studio context

To copy the context length of every currently loaded LM Studio model into its
matching OpenCode model configuration, run:

```cmd
sync-lmstudio-context.cmd
```

The command synchronizes these per-model limits:

- `limit.context` and `limit.input` — the context currently loaded in LM Studio.
- `limit.output` — an 8192-token output reserve, causing automatic compaction to
  start at approximately `context - output` tokens.

For example, a 45056-token LM Studio context will compact at approximately
36864 tokens. Override the reserve when needed:

```cmd
sync-lmstudio-context.cmd --output-reserve 4096
```

By default the command updates
`%USERPROFILE%\.config\opencode\opencode.jsonc` (or `opencode.json` when no
JSONC file exists), creates a timestamped backup, and preserves existing model
settings unrelated to these three limits. Preview the change without writing
anything:

```cmd
sync-lmstudio-context.cmd --dry-run
```

On the remote Mac, synchronization can read the loaded model context through
the Windows telemetry endpoint:

```sh
GPU_STATS_URL="http://WINDOWS_IP:8765" GPU_STATS_TOKEN="token123" \
  sh ./sync-lmstudio-context.sh --dry-run
```

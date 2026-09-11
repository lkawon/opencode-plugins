# OpenCode plugins and skills

This repository contains two independent OpenCode sidebar plugins:

- [`lm-studio-and-nvidia`](./lm-studio-and-nvidia) — NVIDIA GPU telemetry and loaded LM Studio model status.
- [`openai-status`](./openai-status) — ChatGPT/Codex subscription quota and reset times.

Each directory contains its own source files, local OpenCode configuration,
installation script, and documentation. Install both plugins to display both
sections in the right sidebar.

It also contains the [`new-month`](./skills/new-month) skill, which creates
monthly tabs in a Google Sheets timesheet. Its installation, OAuth setup and
usage are documented in [`skills/new-month/README.md`](./skills/new-month/README.md).

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

Allow inbound TCP ports `8765` (telemetry) and `1234` (LM Studio API) through
the Windows firewall only on a trusted LAN. The `openai-status` panel uses the
OpenAI OAuth login stored locally by OpenCode on the Mac.

After installing both plugins globally, start the telemetry server and OpenCode
from the repository root with:

```cmd
run-opencode.cmd
```

To start only the Windows telemetry server without OpenCode, use:

```cmd
start-lmstudio-server.cmd
```

## Auto-start on Windows (LM Studio + model + telemetry)

To bring up the whole GPU stack at Windows logon — LM Studio server bound to
the LAN, the model loaded, and the telemetry server running — use:

```cmd
start-lmstudio-model.cmd
```

The script performs three steps:

1. Restarts the LM Studio server on `LMSTUDIO_HOST:LMSTUDIO_PORT`
   (defaults `0.0.0.0:1234`), so the LAN bind is guaranteed.
2. Loads `LMSTUDIO_MODEL` (default `qwen/qwen3.8-27b`) unless it is already
   loaded.
3. Starts the telemetry server (single-instance, port `8765`) and waits for it
   to become healthy.

Override the defaults with environment variables before running it:

```powershell
$env:LMSTUDIO_HOST = "0.0.0.0"
$env:LMSTUDIO_PORT = "1234"
$env:LMSTUDIO_MODEL = "qwen/qwen3.8-27b"
.\start-lmstudio-model.cmd
```

Each run appends to `logs\boot-lmstudio.log` in the repository root.

To run the boot automatically at logon, register a hidden scheduled task with:

```cmd
install-startup.cmd
```

Optionally pass a different repository path:

```cmd
install-startup.cmd C:\path\to\opencode-plugins
```

To remove the scheduled task again:

```cmd
install-startup.cmd -Remove
```

The task is named `OpenCode-LMStudio-Boot`, runs for the current user at logon,
and is re-runnable (it replaces an existing task). It starts hidden and writes
to the same `logs\boot-lmstudio.log`.

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

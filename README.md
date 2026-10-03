# OpenCode plugins and skills

This repository contains two independent OpenCode sidebar plugins:

- [`llamacpp-and-nvidia`](./llamacpp-and-nvidia) — NVIDIA GPU telemetry and the loaded llama.cpp model.
- [`openai-status`](./openai-status) — ChatGPT/Codex subscription quota and reset times.

Each directory contains its own source files, local OpenCode configuration,
installation script, and documentation. Install both plugins to display both
sections in the right sidebar.

It also contains the [`new-month`](./skills/new-month) skill, which creates
monthly tabs in a Google Sheets timesheet. Its installation, OAuth setup and
usage are documented in [`skills/new-month/README.md`](./skills/new-month/README.md).

## How the telemetry works

The `llamacpp-and-nvidia` plugin reads a lightweight telemetry server running
on the computer with the NVIDIA GPU. The server is a thin, read-only HTTP
service that pulls data from llama.cpp's first-class endpoints — no `lms` CLI:

- GPU VRAM, utilization, temperature and power from `nvml.dll` directly.
- Model id, context length (`n_ctx`), quantization and size from llama.cpp `GET /v1/models`.
- Per-slot processing state from llama.cpp `GET /slots`.
- Prompt progress and generation speed from the llama-server stderr log.
- Tokens/s (max / average) sampled from llama.cpp `GET /metrics`.

The telemetry server binds `0.0.0.0` by default so it is reachable from the
LAN, and always requires a bearer token (fail closed). A token is generated
once and persisted to `~/.config/opencode/llamacpp-stats.token` unless
`GPU_STATS_TOKEN` is set. Set `GPU_STATS_HOST=127.0.0.1` to keep it local-only.

Set `GPU_STATS_DEBUG=1` to enable debug logging. On the Windows machine it
records requests, sampler output and swallowed errors with timestamps to the
telemetry stderr log (`logs\gpu-llamacpp-server.stderr.log`); on the Mac it
logs each stats fetch (URL, token presence, status, failures) to the OpenCode
console.

## Remote macOS installation

The telemetry server runs on the Windows GPU computer. On the Mac, clone this
repository and install both client-side OpenCode panels with:

```sh
sh ./install-macos.sh
```

The installer requires `python3` and either `bun` or `npm` on the Mac.

Configure the Mac shell with the Windows computer's LAN address and matching
token before starting OpenCode:

```sh
export GPU_STATS_URL="http://WINDOWS_IP:8765"
export GPU_STATS_TOKEN="<token>"
opencode
```

The boot script creates an inbound Windows firewall rule for TCP port `8765`
(telemetry). Only use this on a trusted LAN. The `openai-status` panel uses the
OpenAI OAuth login stored locally by OpenCode on the Mac.

After installing both plugins globally, start the Windows telemetry server
from the repository root:

```powershell
.\start-llamacpp.ps1 -mode start -service telemetry
```

OpenCode can then be started normally with `opencode`.

## Controlling the services (llama-server + telemetry)

The boot script takes two parameters:

- `-mode start|stop|restart` — what to do (default: `start`).
- `-service llama|telemetry|all` — which service to act on (default: `all`).

```powershell
.\start-llamacpp.ps1                                    # start llama-server + telemetry
.\start-llamacpp.ps1 -mode stop -service llama           # stop llama-server only
.\start-llamacpp.ps1 -mode restart -service telemetry    # restart telemetry only
```

`start-llamacpp.cmd` is a thin wrapper around the `.ps1`, so the same
arguments work via the `.cmd`. Each run appends to `logs\boot-llamacpp.log`
in the repository root.

The script defaults to a typical llama.cpp launch. Override with environment
variables before running it:

```powershell
$env:LLAMA_GGUF  = "e:\path\to\model.gguf"
$env:LLAMA_MMPROJ = "e:\path\to\mmproj.gguf"
$env:LLAMA_ALIAS = "qwen3.8-27b"
$env:LLAMA_CTX   = "124928"
$env:LLAMA_NGL   = "64"
.\start-llamacpp.ps1
```

To turn on llama.cpp debug logging (verbosity `5`; default is `3` = info),
set `LLAMA_VERBOSITY` and restart llama-server:

```powershell
$env:LLAMA_VERBOSITY = "5"
.\start-llamacpp.ps1 -mode restart -service llama
```

Output goes to `logs\llama-server.stderr.log`. Valid levels: `0` generic,
`1` error, `2` warning, `3` info, `4` trace, `5` debug.

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

The task is named `OpenCode-LLamaCpp-Boot`, runs for the current user at logon,
and is re-runnable (it replaces an existing task and removes the legacy
`OpenCode-LMStudio-Boot` task). It starts hidden and writes to the same
`logs\boot-llamacpp.log`.

## Synchronizing the llama.cpp context

To copy the loaded llama.cpp context length (`n_ctx`) into the matching OpenCode
model configuration, run:

```cmd
sync-llamacpp-context.cmd
```

The command synchronizes these per-model limits under `provider.llamacpp.models`:

- `limit.context` and `limit.input` — the context loaded in llama.cpp (`n_ctx`).
- `limit.output` — an 8192-token output reserve, causing automatic compaction to
  start at approximately `context - output` tokens.

Override the reserve when needed:

```cmd
sync-llamacpp-context.cmd --output-reserve 4096
```

By default the command updates
`%USERPROFILE%\.config\opencode\opencode.jsonc` (or `opencode.json` when no
JSONC file exists), creates a timestamped backup, and preserves existing model
settings unrelated to these three limits. Preview the change without writing
anything:

```cmd
sync-llamacpp-context.cmd --dry-run
```

On the remote Mac, synchronization can read the loaded model context through the
Windows telemetry endpoint:

```sh
GPU_STATS_URL="http://WINDOWS_IP:8765" GPU_STATS_TOKEN="<token>" \
  sh ./sync-llamacpp-context.sh --dry-run
```

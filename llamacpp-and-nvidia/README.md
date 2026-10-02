# llama.cpp and NVIDIA panel for OpenCode

This plugin displays current GPU utilization, VRAM usage, temperature, power
draw, the loaded llama.cpp model (quantization, size, context), slot status,
and generation speed in the OpenCode panel. It does not use MCP. Data is
fetched from a lightweight, read-only HTTP telemetry server running on the
computer with the NVIDIA GPU and llama.cpp.

## Requirements

- Windows with Python 3 and an NVIDIA driver providing NVML
- A running `llama-server` started with `--metrics --slots`
  (e.g. on `http://127.0.0.1:8080`)
- OpenCode

GPU statistics are read directly from `nvml.dll`. Model, context, slot and
speed data come from llama.cpp's HTTP endpoints (`/v1/models`, `/slots`,
`/metrics`). The server never spawns a CLI or scrapes log files.

 For the loaded model, the panel shows three generation speed values on one line
in `current max average` order. `current` is derived from the llama.cpp
`tokens_predicted_total` counter between polls and is shown as `—` when the
model is idle or the value is stale. Maximum and average are measured since the
telemetry server started.

## Local use

Start OpenCode from this directory. The local `.opencode/tui.json` and
`opencode.json` load the sidebar panel and the `gpu_stats` tool automatically.
The telemetry server is still required and is started with the root
`start-llamacpp.cmd -mode start -service telemetry`.

## Running on Windows

Start the telemetry server from the repository root:

```cmd
..\start-llamacpp.cmd -mode start -service telemetry
```

The server uses a single-instance lock. Running the script multiple times does
not create additional servers on port `8765`.

The server uses these defaults:

```text
GPU_STATS_HOST=0.0.0.0
GPU_STATS_PORT=8765
LLAMA_SERVER_URL=http://127.0.0.1:8080
```

The boot script creates an inbound Windows firewall rule for TCP port `8765` so
the telemetry server is reachable from the LAN. Set `GPU_STATS_HOST=127.0.0.1`
before starting telemetry if you want localhost-only access.

A bearer token is generated once and persisted to
`%USERPROFILE%\.config\opencode\llamacpp-stats.token` unless `GPU_STATS_TOKEN`
is set. You can override the endpoint before starting OpenCode:

```powershell
$env:GPU_STATS_URL  = "http://127.0.0.1:8765"
$env:GPU_STATS_TOKEN = "<token>"
opencode
```

For a full automatic startup at Windows logon — llama-server and telemetry —
see the "Auto-start on Windows" section in the [repository README](../README.md).

## Starting the server manually

From the repository root, start only the telemetry server in the background
with:

```cmd
..\start-llamacpp.cmd -mode start -service telemetry
```

For foreground diagnostics, run the Python process directly:

```powershell
$env:LLAMA_SERVER_URL = "http://127.0.0.1:8080"
python .\llamacpp-and-nvidia\gpu_llamacpp_server.py
```

Available endpoints (all require `Authorization: Bearer <token>`):

- `/health` — server health
- `/stats` — GPU and llama.cpp statistics

## Connecting from another computer

Set the GPU computer's address and the same token on the machine running
OpenCode. On macOS or Linux:

```bash
export GPU_STATS_URL="http://GPU_COMPUTER_IP:8765"
export GPU_STATS_TOKEN="<token>"
```

Only expose port `8765` on a trusted LAN. Restart OpenCode after changing the
configuration.

## Global plugin installation

On Windows, copy the plugin into the global OpenCode configuration with:

```cmd
install-global.cmd
```

The installer copies only the OpenCode plugin files into
`%USERPROFILE%\.config\opencode` and preserves other TUI plugin entries,
including `openai-status`. It also removes any legacy `lm-studio-and-nvidia` /
`gpu-lmstudio` files. The Python telemetry server remains in this project
directory and is started with the root
`start-llamacpp.cmd -mode start -service telemetry`. Close and restart
OpenCode after installation.

On macOS or Linux, install only the client-side OpenCode files with:

```sh
sh ./install-global.sh
```

The installer requires `python3` and either `bun` or `npm`.

Do not run the Python telemetry server on the remote Mac. Set `GPU_STATS_URL`
to the Windows GPU computer and provide the same `GPU_STATS_TOKEN` before
starting OpenCode.

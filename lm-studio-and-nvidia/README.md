# LM Studio and NVIDIA panel for OpenCode

This plugin displays current GPU utilization, VRAM usage, temperature, power
draw, loaded LM Studio models, and generation speed in the OpenCode panel. It
does not use MCP. Data is fetched from a lightweight HTTP server running on the
computer with the NVIDIA GPU and LM Studio.

## Requirements

- Windows with Python 3 and an NVIDIA driver providing NVML
- LM Studio running with its API available at `http://127.0.0.1:1234`
- `lms` available in `PATH` for generation speed reporting in tok/s
- OpenCode

GPU statistics are read directly from `nvml.dll`. The server does not launch
`nvidia-smi` on every refresh, preventing console windows from flashing.

For each loaded model, the panel shows three generation speed values on one line
in `current max average` order. Maximum and average are measured since the
telemetry server started. LM Studio emits prediction statistics after a response
finishes, so `current` is not a live token-by-token measurement.

## Running on Windows

After installing the plugins globally, the easiest way to start everything is
to use the launcher from the repository root:

```cmd
..\run-opencode.cmd
```

The script performs two operations:

1. Starts `gpu_lmstudio_server.py` in the background using `pythonw.exe`.
2. Starts OpenCode in the project directory.

The server uses a single-instance lock. Running the script multiple times does
not create additional servers on port `8765`.

The script uses these defaults:

```text
GPU_STATS_URL=http://127.0.0.1:8765
GPU_STATS_TOKEN=token123
```

You can override them before starting the script:

```powershell
$env:GPU_STATS_URL = "http://127.0.0.1:8765"
$env:GPU_STATS_TOKEN = "replace-this-token"
.\run-opencode.cmd
```

## Starting the server manually

From the repository root, start only the server in the background with:

```cmd
..\start-lmstudio-server.cmd
```

For foreground diagnostics, run the Python process directly:

```powershell
$env:GPU_STATS_TOKEN = "replace-this-token"
python .\gpu_lmstudio_server.py
```

Available endpoints:

- `/health` — server health
- `/stats` — GPU and LM Studio statistics

## Connecting from another computer

Set the GPU computer's address and the same token on the machine running
OpenCode. On macOS or Linux:

```bash
export GPU_STATS_URL="http://GPU_COMPUTER_IP:8765"
export GPU_STATS_TOKEN="replace-this-token"
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
including `openai-status`. The Python telemetry server remains in this project
directory and is started by the root `run-opencode.cmd`. Close and restart
OpenCode after installation.

On macOS or Linux, install only the client-side OpenCode files with:

```sh
sh ./install-global.sh
```

The installer requires `python3` and either `bun` or `npm`.

Do not run the Python telemetry server on the remote Mac. Set `GPU_STATS_URL`
to the Windows GPU computer and provide the same `GPU_STATS_TOKEN` before
starting OpenCode.

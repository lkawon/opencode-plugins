# Zdalny panel GPU i LM Studio dla OpenCode

To rozwiązanie nie używa MCP. `gpu_lmstudio_server.py` uruchamiasz na komputerze z RTX 3090 Ti i LM Studio. Plugin OpenCode w `.opencode/plugins/gpu-lmstudio` działa lokalnie na komputerze, na którym uruchomiony jest OpenCode, i pobiera dane przez HTTP.

Na komputerze z GPU ustaw token i uruchom:

```powershell
$env:GPU_STATS_TOKEN = "zmien-ten-token"
python .\gpu_lmstudio_server.py
```

Na Macu ustaw adres komputera z GPU oraz ten sam token przed uruchomieniem OpenCode:

```bash
export GPU_STATS_URL="http://ADRES_IP_KOMPUTERA_GPU:8765"
export GPU_STATS_TOKEN="zmien-ten-token"
```

Otwórz port `8765` tylko w zaufanej sieci LAN/firewallu. Po zmianach uruchom ponownie OpenCode.

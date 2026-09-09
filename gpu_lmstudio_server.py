#!/usr/bin/env python3
"""Read-only LAN telemetry endpoint for the computer running the GPU."""
import json
import os
import shutil
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import urlopen, Request

HOST = os.environ.get("GPU_STATS_HOST", "0.0.0.0")
PORT = int(os.environ.get("GPU_STATS_PORT", "8765"))
LM_URL = os.environ.get("LMSTUDIO_URL", "http://127.0.0.1:1234").rstrip("/")
TOKEN = os.environ.get("GPU_STATS_TOKEN", "")

def command_json(*args):
    if not shutil.which(args[0]): return None
    try:
        return json.loads(subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=5))
    except Exception:
        return None

def gpu():
    if not shutil.which("nvidia-smi"): return {"available": False, "error": "nvidia-smi unavailable"}
    query = "name,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu,power.draw"
    try:
        raw = subprocess.check_output(["nvidia-smi", f"--query-gpu={query}", "--format=csv,noheader,nounits"], text=True, timeout=5)
        keys = ["name", "memory_total_mib", "memory_used_mib", "memory_free_mib", "gpu_utilization_percent", "temperature_c", "power_draw_w"]
        rows = []
        for line in raw.splitlines():
            values = [x.strip() for x in line.split(",")]
            row = dict(zip(keys, values))
            for key in keys[1:]:
                try: row[key] = float(row[key]) if "." in row[key] else int(row[key])
                except (ValueError, KeyError): pass
            rows.append(row)
        return {"available": True, "gpus": rows}
    except Exception as error: return {"available": False, "error": str(error)}

def lmstudio():
    try:
        request = Request(f"{LM_URL}/api/v1/models", headers={"Accept": "application/json"})
        with urlopen(request, timeout=4) as response: data = json.load(response)
        return {"available": True, "models": data.get("models", []) if isinstance(data, dict) else data, "loaded_models": command_json("lms", "ps", "--json")}
    except Exception as error: return {"available": False, "error": str(error)}

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if TOKEN and self.headers.get("Authorization") != f"Bearer {TOKEN}":
            self.send_error(401, "Unauthorized"); return
        if self.path not in ("/", "/health", "/stats"):
            self.send_error(404); return
        payload = {"gpu": gpu(), "lmstudio": lmstudio()} if self.path != "/health" else {"ok": True}
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json; charset=utf-8"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *_): pass

print(f"GPU/LM Studio stats listening on {HOST}:{PORT}", flush=True)
ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

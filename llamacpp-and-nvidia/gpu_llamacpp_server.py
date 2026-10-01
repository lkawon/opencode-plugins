#!/usr/bin/env python3
"""Read-only LAN telemetry endpoint for the computer running the NVIDIA GPU + llama.cpp server.

Data sources (all HTTP, no CLI, no log scraping):
  - NVML (nvml.dll)        -> GPU VRAM, utilization, temperature, power
  - llama.cpp /v1/models   -> model id, context length (n_ctx), quant, size, params
  - llama.cpp /slots       -> per-slot processing state and prompt progress
  - llama.cpp /metrics     -> Prometheus counters sampled to derive tokens/s

The server binds 127.0.0.1 by default and always requires a bearer token (fail
closed). A token is generated once and persisted unless GPU_STATS_TOKEN is set.
"""
import ctypes
import hmac
import json
import os
import re
import secrets
import stat
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import urlopen, Request

HOST = os.environ.get("GPU_STATS_HOST", "127.0.0.1")
PORT = int(os.environ.get("GPU_STATS_PORT", "8765"))
LLAMA_URL = os.environ.get("LLAMA_SERVER_URL", "http://127.0.0.1:8080").rstrip("/")
DEFAULT_LOG_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "logs"))
LLAMA_LOG_FILE = os.environ.get(
    "LLAMA_LOG_FILE",
    os.path.join(DEFAULT_LOG_DIR, "llama-server.stderr.log"),
)
SAMPLE_INTERVAL = float(os.environ.get("GPU_STATS_SAMPLE_INTERVAL", "1.0"))
MODEL_ID_CACHE_TTL = 30.0
TOKEN_PATH = os.environ.get(
    "GPU_STATS_TOKEN_PATH",
    os.path.join(os.path.expanduser("~"), ".config", "opencode", "llamacpp-stats.token"),
)


def _load_or_create_token():
    env_token = os.environ.get("GPU_STATS_TOKEN", "").strip()
    if env_token:
        return env_token
    try:
        with open(TOKEN_PATH, "r", encoding="utf-8") as handle:
            stored = handle.read().strip()
            if stored:
                return stored
    except OSError:
        pass
    token = secrets.token_urlsafe(24)
    try:
        os.makedirs(os.path.dirname(TOKEN_PATH), exist_ok=True)
        descriptor = os.open(TOKEN_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, stat.S_IRUSR | stat.S_IWUSR)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(token + "\n")
    except OSError:
        pass
    return token


TOKEN = _load_or_create_token()

STATE_LOCK = threading.Lock()
MODEL_PERFORMANCE = {}
LLAMA_LOG_STATE = {"task": None, "prompt_progress": None, "tg_3s": None, "updated_at": 0.0}
MODEL_ID_CACHE = {"id": "", "at": 0.0}
LAST_METRICS_AT = 0.0
_INSTANCE_MUTEX = None


PROMPT_PROGRESS_RE = re.compile(r"task\s+(\d+)\s+\| prompt processing, .*?progress =\s*([0-9.]+)")
TG_RE = re.compile(r"task\s+(\d+)\s+\| n_gen =.*?tg(?:_3s)? =\s*([0-9.]+) t/s(?:,\s*tg_3s =\s*([0-9.]+) t/s)?")
RELEASE_RE = re.compile(r"task\s+(\d+)\s+\| stop processing")


# --- NVML: minimal direct binding; avoids spawning nvidia-smi. ---
class _Memory(ctypes.Structure):
    _fields_ = [
        ("total", ctypes.c_ulonglong),
        ("free", ctypes.c_ulonglong),
        ("used", ctypes.c_ulonglong),
    ]


class _Utilization(ctypes.Structure):
    _fields_ = [("gpu", ctypes.c_uint), ("memory", ctypes.c_uint)]


class Nvml:
    def __init__(self):
        library = "nvml.dll" if os.name == "nt" else "libnvidia-ml.so.1"
        self.lib = ctypes.WinDLL(library) if os.name == "nt" else ctypes.CDLL(library)
        self._configure()
        self._check(self.lib.nvmlInit_v2())

    def _configure(self):
        device = ctypes.c_void_p
        self.lib.nvmlInit_v2.restype = ctypes.c_int
        self.lib.nvmlDeviceGetCount_v2.argtypes = [ctypes.POINTER(ctypes.c_uint)]
        self.lib.nvmlDeviceGetCount_v2.restype = ctypes.c_int
        self.lib.nvmlDeviceGetHandleByIndex_v2.argtypes = [ctypes.c_uint, ctypes.POINTER(device)]
        self.lib.nvmlDeviceGetHandleByIndex_v2.restype = ctypes.c_int
        self.lib.nvmlDeviceGetName.argtypes = [device, ctypes.c_char_p, ctypes.c_uint]
        self.lib.nvmlDeviceGetName.restype = ctypes.c_int
        self.lib.nvmlDeviceGetMemoryInfo.argtypes = [device, ctypes.POINTER(_Memory)]
        self.lib.nvmlDeviceGetMemoryInfo.restype = ctypes.c_int
        self.lib.nvmlDeviceGetUtilizationRates.argtypes = [device, ctypes.POINTER(_Utilization)]
        self.lib.nvmlDeviceGetUtilizationRates.restype = ctypes.c_int
        self.lib.nvmlDeviceGetTemperature.argtypes = [device, ctypes.c_uint, ctypes.POINTER(ctypes.c_uint)]
        self.lib.nvmlDeviceGetTemperature.restype = ctypes.c_int
        self.lib.nvmlDeviceGetPowerUsage.argtypes = [device, ctypes.POINTER(ctypes.c_uint)]
        self.lib.nvmlDeviceGetPowerUsage.restype = ctypes.c_int
        self.lib.nvmlErrorString.argtypes = [ctypes.c_int]
        self.lib.nvmlErrorString.restype = ctypes.c_char_p

    def _check(self, code):
        if code:
            message = self.lib.nvmlErrorString(code)
            raise RuntimeError(message.decode("utf-8", "replace") if message else f"NVML error {code}")

    def _optional_uint(self, function, handle, *args):
        value = ctypes.c_uint()
        code = function(handle, *args, ctypes.byref(value))
        return value.value if code == 0 else None

    def stats(self):
        count = ctypes.c_uint()
        self._check(self.lib.nvmlDeviceGetCount_v2(ctypes.byref(count)))
        rows = []
        for index in range(count.value):
            handle = ctypes.c_void_p()
            self._check(self.lib.nvmlDeviceGetHandleByIndex_v2(index, ctypes.byref(handle)))
            name = ctypes.create_string_buffer(96)
            self._check(self.lib.nvmlDeviceGetName(handle, name, len(name)))
            memory = _Memory()
            utilization = _Utilization()
            self._check(self.lib.nvmlDeviceGetMemoryInfo(handle, ctypes.byref(memory)))
            self._check(self.lib.nvmlDeviceGetUtilizationRates(handle, ctypes.byref(utilization)))
            temperature = self._optional_uint(self.lib.nvmlDeviceGetTemperature, handle, 0)
            power_mw = self._optional_uint(self.lib.nvmlDeviceGetPowerUsage, handle)
            rows.append({
                "name": name.value.decode("utf-8", "replace"),
                "memory_total_mib": round(memory.total / 1024 / 1024),
                "memory_used_mib": round(memory.used / 1024 / 1024),
                "memory_free_mib": round(memory.free / 1024 / 1024),
                "gpu_utilization_percent": utilization.gpu,
                "temperature_c": temperature,
                "power_draw_w": round(power_mw / 1000, 1) if power_mw is not None else None,
            })
        return rows


try:
    NVML = Nvml()
    NVML_ERROR = ""
except Exception as error:
    NVML = None
    NVML_ERROR = str(error)


# --- llama.cpp HTTP helpers ---
def _http(path, timeout=4):
    request = Request(f"{LLAMA_URL}{path}", headers={"Accept": "application/json"})
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", "replace")


def _get_json(path, timeout=4):
    return json.loads(_http(path, timeout))


def parse_metrics(text):
    """Parse a Prometheus exposition into {metric_name: float} for scalar series."""
    result = {}
    for line in text.splitlines():
        if not line or line[0] == "#":
            continue
        parts = line.rsplit(" ", 1)
        if len(parts) != 2:
            continue
        name, raw = parts
        if "{" in name:
            name = name.split("{", 1)[0]
        try:
            result[name] = float(raw)
        except ValueError:
            continue
    return result


def _model_entries():
    data = _get_json("/v1/models")
    entries = data.get("data") if isinstance(data, dict) else data
    return entries if isinstance(entries, list) else []


def _current_model_id():
    now = time.time()
    if MODEL_ID_CACHE["id"] and now - MODEL_ID_CACHE["at"] < MODEL_ID_CACHE_TTL:
        return MODEL_ID_CACHE["id"]
    try:
        for entry in _model_entries():
            if not isinstance(entry, dict):
                continue
            mid = str(entry.get("id") or entry.get("name") or "").strip()
            if mid:
                MODEL_ID_CACHE["id"] = mid
                MODEL_ID_CACHE["at"] = now
                return mid
    except Exception:
        pass
    return MODEL_ID_CACHE["id"]


def _record_performance(model, speed):
    now = time.time()
    aggregate = MODEL_PERFORMANCE.get(model)
    if aggregate is None:
        MODEL_PERFORMANCE[model] = {
            "current_tokens_per_second": speed,
            "max_tokens_per_second": speed,
            "average_tokens_per_second": speed,
            "sample_count": 1,
            "updated_at": now,
        }
        return
    count = aggregate["sample_count"]
    aggregate["current_tokens_per_second"] = speed
    aggregate["max_tokens_per_second"] = max(aggregate["max_tokens_per_second"], speed)
    aggregate["average_tokens_per_second"] = (
        aggregate["average_tokens_per_second"] * count + speed
    ) / (count + 1)
    aggregate["sample_count"] = count + 1
    aggregate["updated_at"] = now


def _read_log_tail(path, max_bytes=65536):
    with open(path, "rb") as handle:
        handle.seek(0, os.SEEK_END)
        size = handle.tell()
        handle.seek(max(0, size - max_bytes), os.SEEK_SET)
        return handle.read().decode("utf-8", "replace")


def _log_sampler():
    """Parse llama-server log timing lines for prompt progress and tg_3s."""
    while True:
        try:
            text = _read_log_tail(LLAMA_LOG_FILE)
            task = None
            prompt_progress = None
            progress_task = None
            tg_3s = None
            for line in text.splitlines():
                release = RELEASE_RE.search(line)
                if release:
                    if progress_task == release.group(1):
                        prompt_progress = None
                        progress_task = None
                    continue
                progress = PROMPT_PROGRESS_RE.search(line)
                if progress:
                    task = progress.group(1)
                    progress_task = task
                    prompt_progress = float(progress.group(2))
                    continue
                speed = TG_RE.search(line)
                if speed:
                    task = speed.group(1)
                    tg_3s = float(speed.group(3) or speed.group(2))
            model = _current_model_id()
            now = time.time()
            with STATE_LOCK:
                LLAMA_LOG_STATE.update({
                    "task": task,
                    "prompt_progress": prompt_progress,
                    "tg_3s": tg_3s,
                    "updated_at": now,
                })
                if model and tg_3s is not None and tg_3s > 0:
                    _record_performance(model, tg_3s)
        except Exception:
            pass
        time.sleep(SAMPLE_INTERVAL)


def _metrics_sampler():
    """Poll /metrics on an interval and track live generation tokens/s."""
    global LAST_METRICS_AT
    last_total = None
    last_time = None
    while True:
        try:
            metrics = parse_metrics(_http("/metrics"))
            gauge = metrics.get("llamacpp:predicted_tokens_seconds")
            total = metrics.get("llamacpp:tokens_predicted_total")
            now = time.time()
            model = _current_model_id()
            if model and gauge is not None and gauge > 0:
                with STATE_LOCK:
                    _record_performance(model, gauge)
            elif model and last_total is not None and total is not None and total > last_total and last_time:
                delta_time = now - last_time
                if delta_time > 0:
                    with STATE_LOCK:
                        _record_performance(model, (total - last_total) / delta_time)
            if total is not None:
                last_total = total
                last_time = now
            LAST_METRICS_AT = now
        except Exception:
            pass
        time.sleep(SAMPLE_INTERVAL)


def _gpu_payload():
    if NVML is None:
        return {"available": False, "error": NVML_ERROR or "NVML unavailable"}
    try:
        return {"available": True, "gpus": NVML.stats()}
    except Exception as error:
        return {"available": False, "error": str(error)}


def _llamacpp_payload():
    try:
        entries = _model_entries()
    except Exception as error:
        return {"available": False, "error": str(error)}

    models = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        meta = entry.get("meta") if isinstance(entry.get("meta"), dict) else {}
        models.append({
            "id": str(entry.get("id") or entry.get("name") or ""),
            "name": str(entry.get("id") or entry.get("name") or ""),
            "n_ctx": meta.get("n_ctx"),
            "n_params": meta.get("n_params"),
            "size": meta.get("size"),
            "ftype": meta.get("ftype"),
        })

    slots = []
    try:
        raw_slots = _get_json("/slots")
        if isinstance(raw_slots, list):
            for slot in raw_slots:
                if not isinstance(slot, dict):
                    continue
                n_prompt = slot.get("n_prompt_tokens")
                n_processed = slot.get("n_prompt_tokens_processed")
                slots.append({
                    "id": slot.get("id"),
                    "is_processing": bool(slot.get("is_processing")),
                    "n_ctx": slot.get("n_ctx"),
                    "n_prompt_tokens": n_prompt,
                    "n_prompt_tokens_processed": n_processed,
                    "n_prompt_tokens_cache": slot.get("n_prompt_tokens_cache"),
                    "next_token": slot.get("next_token") if isinstance(slot.get("next_token"), list) else [],
                })
    except Exception:
        pass

    model_id = _current_model_id()
    with STATE_LOCK:
        performance = {key: dict(value) for key, value in MODEL_PERFORMANCE.items()}
        performance["last_updated"] = LAST_METRICS_AT
        log_state = dict(LLAMA_LOG_STATE)

    return {
        "available": True,
        "model": models[0] if models else None,
        "models": models,
        "slots": slots,
        "model_id": model_id,
        "performance": performance,
        "log": log_state,
    }


def _authorized(handler):
    provided = (handler.headers.get("Authorization") or "").encode("utf-8")
    expected = f"Bearer {TOKEN}".encode("utf-8")
    return hmac.compare_digest(provided, expected)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if not _authorized(self):
            self.send_error(401, "Unauthorized")
            return
        if self.path in ("/", "/health"):
            payload = {"ok": True, "llama_url": LLAMA_URL}
        elif self.path == "/stats":
            payload = {"gpu": _gpu_payload(), "llamacpp": _llamacpp_payload()}
        else:
            self.send_error(404)
            return
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


def main():
    global _INSTANCE_MUTEX
    if os.name == "nt":
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
        kernel32.CreateMutexW.restype = ctypes.c_void_p
        _INSTANCE_MUTEX = kernel32.CreateMutexW(None, False, f"Local\\gpu-llamacpp-stats-{PORT}")
        if not _INSTANCE_MUTEX:
            raise ctypes.WinError(ctypes.get_last_error())
        if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
            print(f"Telemetry server already running on port {PORT}; exiting.", flush=True)
            return

    threading.Thread(target=_metrics_sampler, daemon=True).start()
    threading.Thread(target=_log_sampler, daemon=True).start()
    print(f"llama.cpp/NVIDIA stats listening on {HOST}:{PORT} (llama server: {LLAMA_URL})", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()

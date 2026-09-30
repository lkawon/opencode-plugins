#!/usr/bin/env python3
"""Read-only LAN telemetry endpoint for the computer running the GPU."""
import ctypes
import glob
import json
import os
import re
import shutil
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import urlopen, Request

HOST = os.environ.get("GPU_STATS_HOST", "0.0.0.0")
PORT = int(os.environ.get("GPU_STATS_PORT", "8765"))
LM_URL = os.environ.get("LMSTUDIO_URL", "http://127.0.0.1:1234").rstrip("/")
TOKEN = os.environ.get("GPU_STATS_TOKEN", "token123")
LMSTUDIO_LOG_DIR = os.environ.get(
    "LMSTUDIO_LOG_DIR",
    os.path.join(os.path.expanduser("~"), ".lmstudio", "apps", "bionic", "server-logs"),
)
LAST_PERFORMANCE = {"model": "", "tokens_per_second": None}
MODEL_PERFORMANCE = {}
MODEL_ACTIVITY = {}
MODEL_GENERATION = {}
LOADED_MODELS = []
STATE_LOCK = threading.Lock()
_INSTANCE_MUTEX = None

if os.name == "nt":
    _startupinfo = subprocess.STARTUPINFO()
    _startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    _startupinfo.wShowWindow = subprocess.SW_HIDE
    NO_WINDOW = {
        "creationflags": subprocess.CREATE_NO_WINDOW,
        "startupinfo": _startupinfo,
    }
else:
    NO_WINDOW = {}


class _Memory(ctypes.Structure):
    _fields_ = [
        ("total", ctypes.c_ulonglong),
        ("free", ctypes.c_ulonglong),
        ("used", ctypes.c_ulonglong),
    ]


class _Utilization(ctypes.Structure):
    _fields_ = [("gpu", ctypes.c_uint), ("memory", ctypes.c_uint)]


class Nvml:
    """Minimal direct NVML binding; avoids spawning nvidia-smi."""

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


def _find_value(value, names):
    if isinstance(value, dict):
        for key, item in value.items():
            if key in names and item is not None:
                return item
        for item in value.values():
            found = _find_value(item, names)
            if found is not None:
                return found
    elif isinstance(value, list):
        for item in value:
            found = _find_value(item, names)
            if found is not None:
                return found
    return None


def _number(value):
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _record_performance(model, speed):
    aggregate = MODEL_PERFORMANCE.get(model)
    if aggregate is None:
        MODEL_PERFORMANCE[model] = {
            "current_tokens_per_second": speed,
            "max_tokens_per_second": speed,
            "average_tokens_per_second": speed,
            "sample_count": 1,
        }
        return
    count = aggregate["sample_count"]
    aggregate["current_tokens_per_second"] = speed
    aggregate["max_tokens_per_second"] = max(aggregate["max_tokens_per_second"], speed)
    aggregate["average_tokens_per_second"] = (
        aggregate["average_tokens_per_second"] * count + speed
    ) / (count + 1)
    aggregate["sample_count"] = count + 1


def _record_activity(model, event):
    generated_tokens = _number(_find_value(event, {
        "generated_tokens", "generatedTokens", "completion_tokens", "completionTokens",
        "output_tokens", "outputTokens", "predicted_tokens", "predictedTokens",
        "tokens_generated", "tokensGenerated",
    }))
    prompt_processed = _number(_find_value(event, {
        "prompt_tokens_processed", "promptTokensProcessed", "processed_prompt_tokens",
        "processedPromptTokens", "prompt_processed_tokens", "promptProcessedTokens",
        "prompt_eval_count", "promptEvalCount",
    }))
    prompt_total = _number(_find_value(event, {
        "prompt_tokens_total", "promptTokensTotal", "total_prompt_tokens",
        "totalPromptTokens", "prompt_total_tokens", "promptTotalTokens",
        "prompt_tokens", "promptTokens",
    }))
    prompt_progress = _number(_find_value(event, {
        "prompt_processing_progress", "promptProcessingProgress", "prompt_progress",
        "promptProgress", "processing_progress", "processingProgress", "progress",
    }))

    if generated_tokens is None and prompt_processed is None and prompt_total is None and prompt_progress is None:
        return

    activity = MODEL_ACTIVITY.setdefault(model, {})
    activity["updated_at"] = time.time()
    if generated_tokens is not None:
        activity["generated_tokens"] = int(generated_tokens)
    if prompt_processed is not None:
        activity["prompt_tokens_processed"] = int(prompt_processed)
    if prompt_total is not None:
        activity["prompt_tokens_total"] = int(prompt_total)
    if prompt_progress is not None:
        activity["prompt_processing_progress"] = prompt_progress


def _model_key(model):
    return str(_find_value(
        model,
        {"model", "model_key", "modelKey", "identifier", "modelIdentifier", "path"},
    ) or "")


def _refresh_generating_activity(models):
    now = time.time()
    active = set()
    for model in models:
        if not isinstance(model, dict):
            continue
        key = _model_key(model)
        if not key:
            continue
        status = str(model.get("generation_status") or model.get("generationStatus") or model.get("status") or "").lower()
        if status == "generating":
            active.add(key)
            state = MODEL_GENERATION.setdefault(key, {"started_at": now, "base_tokens": 0})
            speed = MODEL_PERFORMANCE.get(key, {}).get("current_tokens_per_second")
            if speed is None and LAST_PERFORMANCE.get("model") == key:
                speed = LAST_PERFORMANCE.get("tokens_per_second")
            activity = MODEL_ACTIVITY.setdefault(key, {})
            activity["updated_at"] = now
            if speed:
                activity["generated_tokens"] = int(state["base_tokens"] + max(0, now - state["started_at"]) * speed)
        else:
            MODEL_GENERATION.pop(key, None)
            if status == "processingprompt":
                activity = MODEL_ACTIVITY.setdefault(key, {})
                activity["updated_at"] = now
                activity["generated_tokens"] = 0
    for key in list(MODEL_GENERATION):
        if key not in active:
            MODEL_GENERATION.pop(key, None)


def _activity_key():
    if len(LOADED_MODELS) != 1:
        return ""
    return _model_key(LOADED_MODELS[0])


def _latest_server_log():
    pattern = os.path.join(LMSTUDIO_LOG_DIR, "**", "*.log")
    files = glob.glob(pattern, recursive=True)
    return max(files, key=os.path.getmtime) if files else ""


def _record_log_line(line):
    progress_match = re.search(r"\[INFO\]\[([^\]]+)\] Prompt processing progress: ([0-9.]+)%", line)
    if progress_match:
        model = progress_match.group(1)
        _record_activity(model, {"prompt_processing_progress": float(progress_match.group(2)) / 100})
        return

    prompt_match = re.search(
        r"prompt processing, n_tokens =\s*(\d+), progress =\s*([0-9.]+).*?/\s*([0-9.]+) tokens per second",
        line,
    )
    if prompt_match:
        model = _activity_key()
        if model:
            _record_activity(model, {
                "prompt_tokens_processed": int(prompt_match.group(1)),
                "prompt_processing_progress": float(prompt_match.group(2)),
            })
            speed = float(prompt_match.group(3))
            LAST_PERFORMANCE.update({"model": model, "tokens_per_second": speed})
            _record_performance(model, speed)
        return

    eval_match = re.search(r"\beval time =\s*[0-9.]+ ms /\s*(\d+) tokens .*?\s([0-9.]+) tokens per second", line)
    if eval_match and "prompt eval time" not in line:
        model = _activity_key()
        if model:
            _record_activity(model, {"generated_tokens": int(eval_match.group(1))})
            speed = float(eval_match.group(2))
            LAST_PERFORMANCE.update({"model": model, "tokens_per_second": speed})
            _record_performance(model, speed)


def _server_log_tail():
    path = ""
    position = 0
    while True:
        try:
            latest = _latest_server_log()
            if latest and latest != path:
                path = latest
                position = os.path.getsize(path)
            if path:
                size = os.path.getsize(path)
                if size < position:
                    position = 0
                with open(path, "r", encoding="utf-8", errors="replace") as log:
                    log.seek(position)
                    for line in log:
                        with STATE_LOCK:
                            _record_log_line(line)
                    position = log.tell()
        except Exception:
            pass
        time.sleep(0.5)


def _performance_log():
    executable = shutil.which("lms")
    if not executable:
        return
    while True:
        try:
            process = subprocess.Popen(
                [executable, "log", "stream", "--source", "model", "--filter", "input,output", "--json", "--stats"],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                errors="replace",
                **NO_WINDOW,
            )
            for line in process.stdout or ():
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                model = _find_value(event, {"model", "model_key", "modelKey", "identifier", "modelIdentifier"}) or ""
                with STATE_LOCK:
                    key = str(model)
                    if not key and len(LOADED_MODELS) == 1:
                        key = str(_find_value(
                            LOADED_MODELS[0],
                            {"model", "model_key", "modelKey", "identifier", "modelIdentifier", "path"},
                        ) or "")
                    if not key:
                        continue
                    _record_activity(key, event)
                    speed = _number(_find_value(event, {"tokens_per_second", "tokensPerSecond"}))
                    if speed is None:
                        continue
                    LAST_PERFORMANCE.update({"model": key, "tokens_per_second": speed})
                    _record_performance(key, speed)
        except Exception:
            pass
        time.sleep(2)


def _loaded_models_loop():
    global LOADED_MODELS
    executable = shutil.which("lms")
    if not executable:
        return
    while True:
        try:
            output = subprocess.check_output(
                [executable, "ps", "--json"],
                text=True,
                encoding="utf-8",
                errors="replace",
                stderr=subprocess.DEVNULL,
                timeout=4,
                **NO_WINDOW,
            )
            models = json.loads(output)
            if isinstance(models, list):
                with STATE_LOCK:
                    LOADED_MODELS = models
                    _refresh_generating_activity(models)
        except Exception:
            pass
        time.sleep(0.5)


def _lmstudio_state():
    with STATE_LOCK:
        loaded = list(LOADED_MODELS)
        performance = dict(LAST_PERFORMANCE)
        performance["models"] = {
            key: dict(value) for key, value in MODEL_PERFORMANCE.items()
        }
        performance["activity"] = {
            key: dict(value) for key, value in MODEL_ACTIVITY.items()
        }
    return loaded, performance


def gpu():
    if NVML is None:
        return {"available": False, "error": NVML_ERROR or "NVML unavailable"}
    try:
        return {"available": True, "gpus": NVML.stats()}
    except Exception as error:
        return {"available": False, "error": str(error)}

def lmstudio():
    try:
        request = Request(f"{LM_URL}/api/v1/models", headers={"Accept": "application/json"})
        with urlopen(request, timeout=4) as response: data = json.load(response)
        # Use the HTTP API only; do not spawn the LM Studio CLI from the
        # refresh path, because Windows can flash a console for CLI processes.
        models = data.get("models", []) if isinstance(data, dict) else data
        loaded_models, performance = _lmstudio_state()
        return {"available": True, "models": models, "loaded_models": loaded_models, "performance": performance}
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

def main():
    global _INSTANCE_MUTEX
    if os.name == "nt":
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
        kernel32.CreateMutexW.restype = ctypes.c_void_p
        _INSTANCE_MUTEX = kernel32.CreateMutexW(None, False, f"Local\\gpu-lmstudio-stats-{PORT}")
        if not _INSTANCE_MUTEX:
            raise ctypes.WinError(ctypes.get_last_error())
        if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
            return

    threading.Thread(target=_performance_log, daemon=True).start()
    threading.Thread(target=_server_log_tail, daemon=True).start()
    threading.Thread(target=_loaded_models_loop, daemon=True).start()
    print(f"GPU/LM Studio stats listening on {HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Print JSON field paths emitted by LM Studio model logs.

Run this on the Windows GPU computer while a prompt is being processed and a
response is being generated. It captures the raw `lms log stream` events and
prints all scalar JSON paths so we can see the exact metric names LM Studio
exposes in this version.
"""
import argparse
import json
import shutil
import subprocess
import sys
import time


def scalar_paths(value, prefix=""):
    if isinstance(value, dict):
        for key, item in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            yield from scalar_paths(item, path)
    elif isinstance(value, list):
        for index, item in enumerate(value[:3]):
            path = f"{prefix}[{index}]" if prefix else f"[{index}]"
            yield from scalar_paths(item, path)
    else:
        yield prefix, value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--events", type=int, default=20, help="number of JSON events to capture")
    parser.add_argument("--seconds", type=int, default=120, help="maximum capture time")
    args = parser.parse_args()

    executable = shutil.which("lms")
    if not executable:
        print("lms not found in PATH", file=sys.stderr)
        return 1

    process = subprocess.Popen(
        [executable, "log", "stream", "--source", "model", "--filter", "input,output", "--json", "--stats"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    deadline = time.time() + args.seconds
    captured = 0
    seen_paths = set()
    try:
        while captured < args.events and time.time() < deadline:
            line = process.stdout.readline() if process.stdout else ""
            if not line:
                if process.poll() is not None:
                    break
                time.sleep(0.1)
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue

            captured += 1
            print(f"\n=== event {captured} ===")
            for path, value in scalar_paths(event):
                if path in seen_paths:
                    continue
                seen_paths.add(path)
                print(f"{path}: {value!r}")
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()

    print(f"\nCaptured {captured} JSON events, {len(seen_paths)} unique scalar paths.")
    return 0 if captured else 2


if __name__ == "__main__":
    raise SystemExit(main())

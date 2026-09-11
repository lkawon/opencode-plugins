#!/usr/bin/env python3
"""Synchronize loaded LM Studio context lengths with the OpenCode config."""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen


def default_config_path():
    config_dir = Path.home() / ".config" / "opencode"
    jsonc_path = config_dir / "opencode.jsonc"
    return jsonc_path if jsonc_path.exists() else config_dir / "opencode.json"


def strip_jsonc(text):
    """Remove JSONC comments and trailing commas without touching strings."""
    output = []
    index = 0
    in_string = False
    escaped = False
    while index < len(text):
        char = text[index]
        next_char = text[index + 1] if index + 1 < len(text) else ""
        if in_string:
            output.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            index += 1
            continue
        if char == '"':
            in_string = True
            output.append(char)
            index += 1
            continue
        if char == "/" and next_char == "/":
            output.extend("  ")
            index += 2
            while index < len(text) and text[index] not in "\r\n":
                output.append(" ")
                index += 1
            continue
        if char == "/" and next_char == "*":
            output.extend("  ")
            index += 2
            while index < len(text):
                if index + 1 < len(text) and text[index:index + 2] == "*/":
                    output.extend("  ")
                    index += 2
                    break
                output.append(text[index] if text[index] in "\r\n" else " ")
                index += 1
            continue
        output.append(char)
        index += 1

    value = "".join(output)
    output = []
    index = 0
    in_string = False
    escaped = False
    while index < len(value):
        char = value[index]
        if in_string:
            output.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            index += 1
            continue
        if char == '"':
            in_string = True
            output.append(char)
            index += 1
            continue
        if char == ",":
            lookahead = index + 1
            while lookahead < len(value) and value[lookahead].isspace():
                lookahead += 1
            if lookahead < len(value) and value[lookahead] in "}]":
                index += 1
                continue
        output.append(char)
        index += 1
    return "".join(output)


def hidden_process_options():
    if os.name != "nt":
        return {}
    startupinfo = subprocess.STARTUPINFO()
    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startupinfo.wShowWindow = subprocess.SW_HIDE
    return {"creationflags": subprocess.CREATE_NO_WINDOW, "startupinfo": startupinfo}


def remote_loaded_models(stats_url, token):
    request = Request(
        f"{stats_url.rstrip('/')}/stats",
        headers={
            "Accept": "application/json",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
    )
    with urlopen(request, timeout=10) as response:
        payload = json.load(response)
    result = []
    for model in payload.get("lmstudio", {}).get("models", []):
        instances = model.get("loaded_instances") or []
        if model.get("type") != "llm" or not instances:
            continue
        result.append({
            "type": "llm",
            "modelKey": model.get("key"),
            "identifier": model.get("key"),
            "contextLength": instances[0].get("config", {}).get("context_length"),
        })
    return result


def loaded_models(stats_url=None, token=None):
    if stats_url:
        return remote_loaded_models(stats_url, token)
    executable = shutil.which("lms")
    if not executable:
        raise RuntimeError("lms was not found in PATH")
    command = [executable, "ps", "--json"]
    if os.name == "nt" and Path(executable).suffix.lower() in {".cmd", ".bat"}:
        command = [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/s", "/c", subprocess.list2cmdline(command)]
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
        **hidden_process_options(),
    )
    if result.returncode:
        message = result.stderr.strip() or f"lms exited with code {result.returncode}"
        raise RuntimeError(message)
    data = json.loads(result.stdout)
    if not isinstance(data, list):
        raise RuntimeError("Unexpected response from lms ps --json")
    return [item for item in data if item.get("type") == "llm"]


def model_identifiers(model):
    identifiers = {
        model.get("modelKey"),
        model.get("identifier"),
        model.get("indexedModelIdentifier"),
        model.get("path"),
    }
    selected = model.get("selectedVariant")
    if isinstance(selected, str):
        identifiers.add(selected.split("@", 1)[0])
    return {value for value in identifiers if isinstance(value, str) and value}


def synchronize(config, models, output_reserve):
    configured = config.get("provider", {}).get("lmstudio", {}).get("models", {})
    if not isinstance(configured, dict):
        raise RuntimeError("provider.lmstudio.models is missing from the OpenCode config")

    changes = []
    skipped = []
    for model in models:
        context = model.get("contextLength")
        if not isinstance(context, int) or context <= 0:
            continue
        matches = model_identifiers(model) & configured.keys()
        if not matches:
            skipped.append(model.get("identifier") or model.get("modelKey") or "unknown")
            continue
        for identifier in sorted(matches):
            settings = configured[identifier]
            if not isinstance(settings, dict):
                continue
            limit = settings.setdefault("limit", {})
            if not isinstance(limit, dict):
                raise RuntimeError(f"Invalid limit setting for {identifier}")
            desired = {
                "context": context,
                "input": context,
                "output": min(output_reserve, max(1, context - 1)),
            }
            model_changes = []
            for key, new_value in desired.items():
                previous = limit.get(key)
                if previous != new_value:
                    limit[key] = new_value
                    model_changes.append((key, previous, new_value))
            if model_changes:
                changes.append((identifier, model_changes))
    return changes, skipped


def atomic_write(path, data):
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary_name, path)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=default_config_path(), help="OpenCode JSON/JSONC config path")
    parser.add_argument(
        "--stats-url",
        default=os.environ.get("GPU_STATS_URL"),
        help="Remote Windows telemetry URL; defaults to GPU_STATS_URL, otherwise uses local lms",
    )
    parser.add_argument(
        "--stats-token",
        default=os.environ.get("GPU_STATS_TOKEN", ""),
        help="Remote telemetry token; defaults to GPU_STATS_TOKEN",
    )
    parser.add_argument(
        "--output-reserve",
        type=int,
        default=8192,
        help="Tokens reserved for model output; compaction starts near context minus this value (default: 8192)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Show changes without writing the config")
    args = parser.parse_args()

    if args.output_reserve <= 0:
        raise ValueError("--output-reserve must be greater than zero")

    config_path = args.config.expanduser().resolve()
    if not config_path.is_file():
        raise RuntimeError(f"OpenCode config not found: {config_path}")

    config = json.loads(strip_jsonc(config_path.read_text(encoding="utf-8-sig")))
    models = loaded_models(args.stats_url, args.stats_token)
    if not models:
        print("No LM Studio LLM is currently loaded.")
        return 0

    changes, skipped = synchronize(config, models, args.output_reserve)
    for identifier, model_changes in changes:
        print(identifier)
        for key, previous, new_value in model_changes:
            old_value = "not set" if previous is None else previous
            print(f"  limit.{key}: {old_value} -> {new_value}")
        limit = config["provider"]["lmstudio"]["models"][identifier]["limit"]
        print(f"  compaction threshold: about {limit['input'] - limit['output']} tokens")
    for identifier in skipped:
        print(f"Skipped {identifier}: model is not configured in provider.lmstudio.models")

    if not changes:
        print("OpenCode context settings are already synchronized.")
        return 0
    if args.dry_run:
        print("Dry run: config was not changed.")
        return 0

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = config_path.with_name(f"{config_path.name}.bak-{timestamp}")
    shutil.copy2(config_path, backup_path)
    atomic_write(config_path, config)
    print(f"Updated: {config_path}")
    print(f"Backup:  {backup_path}")
    print("Restart OpenCode to apply the new context limit.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, json.JSONDecodeError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)

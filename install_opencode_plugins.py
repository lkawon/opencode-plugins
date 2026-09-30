#!/usr/bin/env python3
"""Install this repository's OpenCode plugins on macOS/Linux."""

import argparse
import json
import os
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PLUGINS = {
    "llamacpp-and-nvidia": {
        "files": [
            (".opencode/lib/llamacpp-client.ts", "lib/llamacpp-client.ts"),
            (".opencode/plugins/llamacpp-and-nvidia.ts", "plugins/llamacpp-and-nvidia.ts"),
            (".opencode/plugins/llamacpp-and-nvidia/tui.tsx", "plugins/llamacpp-and-nvidia/tui.tsx"),
        ],
        "tui": "./plugins/llamacpp-and-nvidia/tui.tsx",
    },
    "openai-status": {
        "files": [
            (".opencode/plugins/openai-status.ts", "plugins/openai-status.ts"),
            (".opencode/plugins/openai-status/tui.tsx", "plugins/openai-status/tui.tsx"),
            (".opencode/lib/openai-status.ts", "lib/openai-status.ts"),
        ],
        "tui": "./plugins/openai-status/tui.tsx",
    },
}


def default_destination():
    base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / "opencode"


def load_json(path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def install(selected, destination):
    destination.mkdir(parents=True, exist_ok=True)
    tui_path = destination / "tui.json"
    tui = load_json(tui_path, {"$schema": "https://opencode.ai/tui.json", "plugin": []})
    entries = tui.setdefault("plugin", [])
    if not isinstance(entries, list):
        entries = [entries]
        tui["plugin"] = entries

    package_path = destination / "package.json"
    package = load_json(package_path, {"type": "module", "dependencies": {}})
    dependencies = package.setdefault("dependencies", {})

    for name in selected:
        spec = PLUGINS[name]
        source_root = ROOT / name
        source_package = load_json(source_root / ".opencode/package.json", {})
        dependencies.update(source_package.get("dependencies", {}))
        for source_name, destination_name in spec["files"]:
            source = source_root / source_name
            target = destination / destination_name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        entry = spec["tui"]
        entries[:] = [item for item in entries if item != entry]
        entries.append(entry)
        print(f"Installed {name}")

    if "llamacpp-and-nvidia" in selected:
        for legacy_entry in (
            "./plugins/gpu-lmstudio/tui.tsx",
            "./plugins/lm-studio-and-nvidia/tui.tsx",
        ):
            entries[:] = [item for item in entries if item != legacy_entry]
        for legacy in (
            destination / "plugins/gpu-lmstudio",
            destination / "plugins/gpu-lmstudio.ts",
            destination / "plugins/lm-studio-and-nvidia",
            destination / "plugins/lm-studio-and-nvidia.ts",
            destination / "gpu_lmstudio_server.py",
        ):
            if legacy.is_dir():
                shutil.rmtree(legacy)
            elif legacy.exists():
                legacy.unlink()

    write_json(tui_path, tui)
    write_json(package_path, package)
    print(f"OpenCode directory: {destination}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plugin", choices=[*PLUGINS, "all"])
    parser.add_argument("--destination", type=Path, default=default_destination())
    args = parser.parse_args()
    selected = list(PLUGINS) if args.plugin == "all" else [args.plugin]
    install(selected, args.destination.expanduser().resolve())


if __name__ == "__main__":
    main()

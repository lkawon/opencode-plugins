#!/usr/bin/env python3
"""Install this repository's OpenCode v2 plugins on macOS/Linux.

Each plugin ships as a self-contained package (index.ts server entry + tui.tsx
CLI entry + lib/ data layer). The installer copies that package into
`~/.config/opencode/plugins/<name>/`, registers it in `opencode.json` under the
v2 `plugins` key, and merges its runtime dependencies into the global
`package.json` (installed by the shell wrapper via bun/npm).
"""

import argparse
import json
import os
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PLUGINS = {
    "llamacpp-and-nvidia": {
        "files": ["package.json", "index.ts", "tui.tsx"],
        "dirs": ["lib"],
    },
    "openai-status": {
        "files": ["package.json", "index.ts", "tui.tsx"],
        "dirs": ["lib"],
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


def remove_path(path):
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()


def install(selected, destination):
    destination.mkdir(parents=True, exist_ok=True)

    config_path = destination / "opencode.json"
    config = load_json(config_path, {"$schema": "https://opencode.ai/config.json", "plugins": []})
    plugins = config.setdefault("plugins", [])
    if not isinstance(plugins, list):
        plugins = [plugins]
        config["plugins"] = plugins

    package_path = destination / "package.json"
    package = load_json(package_path, {"type": "module", "dependencies": {}})
    dependencies = package.setdefault("dependencies", {})

    for name in selected:
        spec = PLUGINS[name]
        source_root = ROOT / name / ".opencode"
        target_root = destination / "plugins" / name
        target_root.mkdir(parents=True, exist_ok=True)

        for file_name in spec["files"]:
            source = source_root / file_name
            target = target_root / file_name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        for dir_name in spec["dirs"]:
            source = source_root / dir_name
            if source.is_dir():
                shutil.copytree(source, target_root / dir_name, dirs_exist_ok=True)

        source_package = load_json(source_root / "package.json", {})
        dependencies.update(source_package.get("dependencies", {}))

        target_pkg = f"./plugins/{name}"
        entry = {"package": target_pkg}
        plugins[:] = [
            item
            for item in plugins
            if item != entry
            and item != target_pkg
            and (not isinstance(item, dict) or item.get("package") != target_pkg)
        ]
        plugins.append(entry)

        # Drop the V1 flat entry point that predates the package layout.
        remove_path(destination / "plugins" / f"{name}.ts")
        print(f"Installed {name}")

    # Remove V1-era artifacts that the new package layout replaces.
    for legacy in (
        destination / "lib",
        destination / "tui.json",
        destination / "plugins/gpu-lmstudio",
        destination / "plugins/gpu-lmstudio.ts",
        destination / "plugins/lm-studio-and-nvidia",
        destination / "plugins/lm-studio-and-nvidia.ts",
        destination / "gpu_lmstudio_server.py",
    ):
        remove_path(legacy)

    # The V1 SDK package is superseded by @opencode/plugin.
    dependencies.pop("@opencode-ai/plugin", None)

    write_json(config_path, config)
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

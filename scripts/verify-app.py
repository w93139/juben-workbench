#!/usr/bin/env python3
"""Run free application checks; isolate local builds from the live preview by default."""
import argparse
import importlib.util
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile


SPEC = importlib.util.spec_from_file_location("workbench_sync", Path(__file__).with_name("sync-github.py"))
SYNC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SYNC)


def source_files(source):
    """Validate the complete source list before opening or copying any file."""
    paths = subprocess.check_output([
        "git", "ls-files", "--cached", "--others", "--exclude-standard", "-z",
    ], cwd=source).decode().split("\0")
    files = []
    for name in sorted(set(filter(None, paths))):
        SYNC.check_name(name)
        # Also reject alternate dotenv names, e.g. .envrc, regardless of Git state.
        if any(part.startswith(".env") and part != ".env.example" for part in Path(name).parts):
            raise ValueError("隔离检查不接受环境配置文件。")
        if Path(name).name.lower().endswith(tuple(
            extension + sidecar for extension in (".db", ".sqlite", ".sqlite3")
            for sidecar in ("-wal", "-shm", "-journal")
        )):
            raise ValueError("隔离检查不接受数据库附属文件。")
        original = source
        for part in Path(name).parts:
            original = original / part
            try:
                mode = original.lstat().st_mode
            except FileNotFoundError:
                break  # A tracked source file may have been deleted in this change.
            if stat.S_ISLNK(mode):
                raise ValueError("隔离检查不接受源码路径中的符号链接。")
        else:
            if not stat.S_ISREG(mode):
                raise ValueError("隔离检查只接受普通源码文件。")
            files.append(name)
    return files


def copy_sources(source, destination):
    for name in source_files(source):
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / name, target)


def main():
    parser = argparse.ArgumentParser(description="无模型开发检查；默认隔离构建，保留失败现场")
    parser.add_argument("--in-place", action="store_true", help="仅用于CI等独占工作区，会重建该目录的.next")
    args = parser.parse_args()
    if args.in_place and os.environ.get("CI") not in ("true", "1"):
        parser.error("--in-place仅用于CI独占工作区；本机请使用默认隔离模式")
    source = Path(__file__).resolve().parents[1]
    app = source / "03-前端原型"
    if not (app / "node_modules").exists():
        parser.error("请先在03-前端原型使用Node.js 24执行npm ci")
    version = subprocess.check_output(["node", "--version"], text=True).strip()
    if not version.startswith("v24."):
        parser.error("请使用Node.js 24运行检查")
    root = source
    if not args.in_place:
        root = Path(tempfile.mkdtemp(prefix="juben-verify-"))
        try:
            copy_sources(source, root)
        except (SYNC.SyncError, OSError, ValueError, subprocess.CalledProcessError) as error:
            print(f"源码隔离失败，未执行应用检查：{error}", file=sys.stderr)
            return 1
        (root / "03-前端原型/node_modules").symlink_to(app / "node_modules", target_is_directory=True)
    env = {key: value for key, value in os.environ.items() if not key.startswith(("STUDIO_", "OPENAI_API_", "ANTHROPIC_API_"))}
    env.update(CI="1", NEXT_TELEMETRY_DISABLED="1")
    print(f"检查目录：{root}；不启用真实模型验证", flush=True)
    commands = [
        ["npm", "run", "lint"],
        ["npm", "run", "test"],
        ["npm", "run", "build", "--", "--webpack"],
        ["npm", "run", "typecheck"],
        ["npx", "--no-install", "playwright", "test", "--workers=1"],
    ]
    for command in commands:
        print("运行：" + " ".join(command), flush=True)
        result = subprocess.run(command, cwd=root / "03-前端原型", env=env)
        if result.returncode:
            print(f"检查失败，现场保留于：{root}", flush=True)
            return result.returncode
    print("无模型应用检查通过；真实整本与用户验收另行记录。", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

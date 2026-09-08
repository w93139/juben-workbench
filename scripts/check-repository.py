#!/usr/bin/env python3
"""Read-only repository boundary and credential scan; no network or git mutation."""
import importlib.util
import argparse
from pathlib import Path
import sys

SPEC = importlib.util.spec_from_file_location("workbench_sync", Path(__file__).with_name("sync-github.py"))
SYNC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SYNC)


def main():
    parser = argparse.ArgumentParser(description="只读扫描指定仓库的工作区、暂存区和全部可达历史")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    root = parser.parse_args().root.resolve()
    try:
        actual = Path(SYNC.git(root, "rev-parse", "--show-toplevel").stdout.decode().strip()).resolve()
        if actual != root:
            raise SYNC.SyncError("扫描路径必须是Git仓库根目录。")
        files = SYNC.check_worktree(root)
        SYNC.check_git_snapshot(root)
        history = SYNC.check_history(root)
    except (SYNC.SyncError, OSError, ValueError) as error:
        print(f"扫描未通过：{error}", file=sys.stderr)
        return 1
    print(f"扫描通过：{files} 个工作区文件，{history['commits']} 个提交，{history['blobs']} 个历史文本对象，{history['refs']} 个引用；未发现规则内的问题。")
    return 0


if __name__ == "__main__":
    sys.exit(main())

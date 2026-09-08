#!/usr/bin/env python3
"""Sync one reviewed file snapshot; never read browser or runtime data."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

REPOSITORY = "w93139/juben-workbench"
REMOTE = f"https://github.com/{REPOSITORY}.git"
ROOT_FILES = {".gitignore", "README.md", "AGENTS.md", "同步到GitHub.command"}
ROOT_DIRS = {"01-产品需求", "03-前端原型", "04-后端服务", "scripts"}
EXCLUDED_DIRS = {
    ".git", "node_modules", ".next", "out", "dist", "coverage", "test-results",
    "playwright-report", ".venv", "__pycache__", "uploads", "runtime-data", "backups",
}
EXCLUDED_SUFFIXES = {
    ".pem", ".key", ".p12", ".pfx", ".sqlite", ".sqlite3", ".db", ".dump",
    ".log", ".zip", ".mp3", ".mp4", ".wav", ".mov", ".pyc", ".tsbuildinfo",
}
SECRET_PATTERNS = [
    rb"gh[pousr]_[A-Za-z0-9]{30,}", rb"github_pat_[A-Za-z0-9_]{50,}",
    rb"sk-[A-Za-z0-9_-]{20,}", rb"AKIA[A-Z0-9]{16}",
    rb"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----",
]
MAX_SIZE = 10 * 1024 * 1024


class SyncError(Exception):
    pass


def command(root, *args, allowed=(0,)):
    result = subprocess.run(args, cwd=root, capture_output=True)
    if result.returncode not in allowed:
        raise SyncError(f"{args[0]} {args[1]} 未成功（退出码{result.returncode}）。本机修改与已有提交仍保留，请检查网络、登录或Git状态后重试。")
    return result


def git(root, *args, allowed=(0,)):
    return command(root, "git", *args, allowed=allowed)


def check_name(name):
    path = Path(name)
    if path.is_absolute() or ".." in path.parts or any(c in name for c in "\r\n\t"):
        raise SyncError("发现不适合同步的文件路径。")
    allowed = name in ROOT_FILES or (len(path.parts) > 1 and path.parts[0] in ROOT_DIRS)
    blocked = any(part in EXCLUDED_DIRS for part in path.parts)
    blocked |= any(part == ".env" or (part.startswith(".env.") and part != ".env.example") for part in path.parts)
    blocked |= path.suffix.lower() in EXCLUDED_SUFFIXES or path.name == ".DS_Store"
    if not allowed or blocked:
        raise SyncError(f"文件不在同步范围：{json.dumps(name, ensure_ascii=False)}")


def check_data(name, data):
    if len(data) > MAX_SIZE:
        raise SyncError(f"文件超过10MiB，请使用文件存储：{name}")
    try:
        data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise SyncError(f"本次同步只接受文本文件：{name}") from error
    if b"\0" in data:
        raise SyncError(f"发现二进制内容：{name}")
    for pattern in SECRET_PATTERNS:
        match = re.search(pattern, data)
        if match:
            line = data[:match.start()].count(b"\n") + 1
            raise SyncError(f"发现疑似凭证，请先处理本机内容或未推送提交：{name}:{line}（不显示内容）")


def check_worktree(root):
    names = git(root, "ls-files", "--cached", "--others", "--exclude-standard", "-z").stdout.split(b"\0")
    unique = sorted({name.decode("utf-8") for name in names if name})
    for name in unique:
        check_name(name)
        path = root / name
        if path.is_symlink() or (path.exists() and not path.is_file()):
            raise SyncError(f"不自动同步符号链接或嵌套仓库：{name}")
        if path.exists():
            if path.stat().st_size > MAX_SIZE:
                raise SyncError(f"文件超过10MiB：{name}")
            check_data(name, path.read_bytes())
    return len(unique)


def check_git_snapshot(root, ref=None, seen=None):
    seen = set() if seen is None else seen
    rows = git(root, "ls-tree", "-r", "-z", ref).stdout if ref else git(root, "ls-files", "--stage", "-z").stdout
    for row in rows.split(b"\0"):
        if not row:
            continue
        metadata, raw_name = row.split(b"\t", 1)
        fields = metadata.split()
        mode = fields[0]
        oid = fields[2] if ref else fields[1]
        name = raw_name.decode("utf-8")
        check_name(name)
        if mode not in (b"100644", b"100755"):
            raise SyncError(f"不能同步链接或子仓库：{name}")
        if oid not in seen:
            size = int(git(root, "cat-file", "-s", oid.decode()).stdout)
            if size > MAX_SIZE:
                raise SyncError(f"Git版本中的文件超过10MiB：{name}")
            check_data(name, git(root, "cat-file", "blob", oid.decode()).stdout)
            seen.add(oid)


def verify_target(root):
    actual = Path(git(root, "rev-parse", "--show-toplevel").stdout.decode().strip()).resolve()
    if actual != root:
        raise SyncError("请在本项目自己的Git仓库运行同步。")
    if git(root, "symbolic-ref", "--short", "HEAD").stdout.strip() != b"main":
        raise SyncError("同步入口只处理main分支，请先完成当前分支工作。")
    if git(root, "remote", "get-url", "origin").stdout.decode().strip() != REMOTE:
        raise SyncError("origin与指定私有项目仓库不一致，已停止。")
    if git(root, "remote", "get-url", "--push", "--all", "origin").stdout.decode().splitlines() != [REMOTE]:
        raise SyncError("推送地址与指定项目仓库不一致，已停止。")
    repo = json.loads(command(root, "gh", "repo", "view", REPOSITORY, "--json", "nameWithOwner,isPrivate").stdout)
    if repo.get("nameWithOwner") != REPOSITORY or repo.get("isPrivate") is not True:
        raise SyncError("无法确认目标为指定私有仓库，已停止。")
    if git(root, "ls-files", "--unmerged", "-z").stdout:
        raise SyncError("存在尚未处理的合并冲突，请先处理。")
    for marker in ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"):
        path = git(root, "rev-parse", "--git-path", marker).stdout.decode().strip()
        if (root / path).exists():
            raise SyncError("正在合并或整理提交，请完成后再同步。")


def sync(root, message, check_only=False):
    verify_target(root)
    count = check_worktree(root)
    check_git_snapshot(root)
    has_head = git(root, "rev-parse", "--verify", "HEAD", allowed=(0, 128)).returncode == 0
    remote = git(root, "ls-remote", "--exit-code", "--heads", "origin", "refs/heads/main", allowed=(0, 2))
    baseline = None
    if remote.returncode == 0:
        baseline = remote.stdout.split()[0].decode()
        if not check_only:
            git(root, "fetch", "--no-tags", "origin", "main")
            baseline = git(root, "rev-parse", "FETCH_HEAD").stdout.decode().strip()
            if not has_head or git(root, "merge-base", "--is-ancestor", baseline, "HEAD", allowed=(0, 1)).returncode != 0:
                raise SyncError("GitHub存在本机尚未合入的更新。已停止，不覆盖远程；请先处理差异。")
    print(f"已检查 {count} 个文件；目标为私有仓库 {REPOSITORY}。", flush=True)
    if check_only:
        print("检查完成，没有暂存、提交或推送；同步时还会检查未推送的提交历史。")
        return
    git(root, "add", "-A", "--", ".")
    check_git_snapshot(root)
    changed = git(root, "diff", "--cached", "--quiet", allowed=(0, 1)).returncode == 1
    if changed:
        git(root, "commit", "-m", message)
        has_head = True
    if not has_head:
        raise SyncError("没有可同步的文件或提交。")
    revisions = (f"{baseline}..HEAD",) if baseline else ("HEAD",)
    seen = set()
    for commit in git(root, "rev-list", *revisions).stdout.decode().splitlines():
        check_git_snapshot(root, commit, seen)
    git(root, "push", "--no-follow-tags", "--set-upstream", "origin", "HEAD:refs/heads/main")
    local = git(root, "rev-parse", "HEAD").stdout.decode().strip()
    published = git(root, "ls-remote", "--exit-code", "--heads", "origin", "refs/heads/main").stdout.split()[0].decode()
    if local != published:
        raise SyncError("推送后远程又有变化，暂不能确认双方一致；本机提交保留。")
    print(f"同步成功：{local}\nhttps://github.com/{REPOSITORY}\n本机与GitHub版本一致。浏览器创作数据不在此次同步范围。")


def main():
    parser = argparse.ArgumentParser(description="把本项目文件的一次更新同步到指定GitHub私有仓库。")
    parser.add_argument("--message", default="chore: sync workbench updates")
    parser.add_argument("--check", action="store_true", help="只检查文件和目标，不提交或推送")
    args = parser.parse_args()
    if not args.message.strip():
        parser.error("提交说明不能为空")
    try:
        sync(Path(__file__).resolve().parents[1], args.message, args.check)
    except (SyncError, OSError, ValueError) as error:
        print(f"未完成同步：{error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

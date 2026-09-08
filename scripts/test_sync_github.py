import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("workbench_sync", Path(__file__).with_name("sync-github.py"))
SYNC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SYNC)


class SyncIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="workbench-sync-test-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.root = self.base / "project"
        self.root.mkdir()
        self.remote = self.base / "remote.git"
        self.run_git(self.base, "init", "--bare", "--initial-branch=main", str(self.remote))
        self.run_git(self.root, "init", "--initial-branch=main")
        self.run_git(self.root, "config", "user.name", "Sync Test")
        self.run_git(self.root, "config", "user.email", "sync-test@example.invalid")
        self.run_git(self.root, "remote", "add", "origin", str(self.remote))
        self.addCleanup(patch.stopall)
        patch.object(SYNC, "REMOTE", str(self.remote)).start()
        fake_bin = self.base / "bin"
        fake_bin.mkdir()
        fake_gh = fake_bin / "gh"
        fake_gh.write_text("#!/usr/bin/env python3\nimport json, os\nprint(json.dumps({'nameWithOwner': 'w93139/juben-workbench', 'isPrivate': os.environ.get('SYNC_TEST_PRIVATE', 'yes') == 'yes'}))\n")
        fake_gh.chmod(0o755)
        patch.dict(os.environ, {"PATH": str(fake_bin) + os.pathsep + os.environ["PATH"], "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}).start()
        (self.root / "README.md").write_text("test project\n")

    def run_git(self, root, *args, allowed=(0,)):
        result = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True)
        self.assertIn(result.returncode, allowed, result.stderr)
        return result.stdout.strip()

    def sync(self, check=False):
        with contextlib.redirect_stdout(io.StringIO()):
            SYNC.sync(self.root, "test: synchronize snapshot", check)

    def head(self, root):
        return self.run_git(root, "rev-parse", "HEAD")

    def test_first_sync_repeat_check_and_second_update(self):
        self.sync(check=True)
        self.assertEqual(self.run_git(self.root, "diff", "--cached", "--name-only"), "")
        self.run_git(self.root, "rev-parse", "--verify", "HEAD", allowed=(128,))
        self.sync()
        first = self.head(self.root)
        self.assertEqual(first, self.head(self.remote))
        self.sync()
        self.assertEqual(first, self.head(self.root))
        (self.root / "README.md").write_text("second snapshot\n")
        self.sync()
        self.assertNotEqual(first, self.head(self.root))
        self.assertEqual(self.head(self.root), self.head(self.remote))
        self.assertEqual(self.run_git(self.root, "status", "--porcelain"), "")

    def test_remote_ahead_keeps_local_and_remote_changes(self):
        self.sync()
        initial = self.head(self.root)
        other = self.base / "other"
        self.run_git(self.base, "clone", str(self.remote), str(other))
        (other / "README.md").write_text("remote edit\n")
        self.run_git(other, "add", ".")
        self.run_git(other, "-c", "user.name=Other", "-c", "user.email=other@example.invalid", "commit", "-m", "remote update")
        self.run_git(other, "push", "origin", "main")
        remote_head = self.head(self.remote)
        (self.root / "README.md").write_text("local draft\n")
        with self.assertRaisesRegex(SYNC.SyncError, "本机尚未合入"):
            self.sync()
        self.assertEqual(initial, self.head(self.root))
        self.assertEqual(remote_head, self.head(self.remote))
        self.assertEqual((self.root / "README.md").read_text(), "local draft\n")

    def test_rejected_push_can_retry_existing_local_commit(self):
        hook = self.remote / "hooks" / "pre-receive"
        hook.write_text("#!/bin/sh\nexit 1\n")
        hook.chmod(0o755)
        with self.assertRaisesRegex(SYNC.SyncError, "git push 未成功"):
            self.sync()
        local = self.head(self.root)
        self.run_git(self.remote, "rev-parse", "--verify", "HEAD", allowed=(128,))
        hook.unlink()
        self.sync()
        self.assertEqual(local, self.head(self.root))
        self.assertEqual(local, self.head(self.remote))

    def test_out_of_scope_env_link_binary_and_size_are_blocked(self):
        for name, data in [("agent-blueprint/data.md", b"excluded"), ("03-前端原型/.env", b"example"), ("03-前端原型/file.db", b"data"), ("03-前端原型/data.bin", b"\0data"), ("README.md", b"x" * (SYNC.MAX_SIZE + 1))]:
            with self.subTest(name=name):
                path = self.root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
                with self.assertRaises(SYNC.SyncError):
                    self.sync()
                path.unlink()
        (self.root / "README.md").symlink_to(self.base / "outside.md")
        with self.assertRaisesRegex(SYNC.SyncError, "符号链接"):
            self.sync()

    def test_forced_ignored_file_is_rejected(self):
        (self.root / ".gitignore").write_text(".env\n")
        path = self.root / "03-前端原型" / ".env"
        path.parent.mkdir()
        path.write_text("example\n")
        self.run_git(self.root, "add", "-f", str(path))
        with self.assertRaisesRegex(SYNC.SyncError, "不在同步范围"):
            self.sync()
        self.run_git(self.remote, "rev-parse", "--verify", "HEAD", allowed=(128,))

    def test_user_follow_tags_setting_does_not_publish_local_tags(self):
        self.sync()
        self.run_git(self.root, "config", "push.followTags", "true")
        self.run_git(self.root, "tag", "-a", "local-only", "-m", "local annotation")
        (self.root / "README.md").write_text("next update\n")
        self.sync()
        self.assertEqual(self.head(self.root), self.head(self.remote))
        self.assertEqual(self.run_git(self.root, "ls-remote", "--tags", "origin"), "")

    def test_secret_in_unpushed_history_stops_publish_even_after_removal(self):
        self.sync()
        published = self.head(self.remote)
        fake_secret = "sk-" + "x" * 30
        (self.root / "README.md").write_text(fake_secret)
        self.run_git(self.root, "add", ".")
        self.run_git(self.root, "commit", "-m", "test fixture with generated credential")
        (self.root / "README.md").write_text("clean current version\n")
        self.run_git(self.root, "add", ".")
        self.run_git(self.root, "commit", "-m", "remove fixture credential")
        with self.assertRaisesRegex(SYNC.SyncError, "疑似凭证") as caught:
            self.sync()
        self.assertNotIn(fake_secret, str(caught.exception))
        self.assertEqual(published, self.head(self.remote))

    def test_public_target_supported_and_wrong_push_url_blocked(self):
        with patch.dict(os.environ, {"SYNC_TEST_PRIVATE": "no"}):
            self.sync(check=True)
        self.assertEqual(self.run_git(self.root, "diff", "--cached", "--name-only"), "")
        self.run_git(self.root, "remote", "set-url", "--push", "origin", str(self.base / "wrong.git"))
        with self.assertRaisesRegex(SYNC.SyncError, "推送地址"):
            self.sync()

    def test_all_refs_history_and_tree_refs_are_scanned(self):
        self.sync()
        self.run_git(self.root, "update-ref", "refs/codex/test-tree", "HEAD^{tree}")
        self.assertEqual(SYNC.check_history(self.root)["commits"], 1)
        self.run_git(self.root, "checkout", "-b", "local-risk")
        fake = "xai-" + "k" * 30
        (self.root / "README.md").write_text(fake)
        self.run_git(self.root, "add", ".")
        self.run_git(self.root, "commit", "-m", "fixture")
        self.run_git(self.root, "checkout", "main")
        with self.assertRaisesRegex(SYNC.SyncError, "疑似凭证") as caught:
            self.sync(check=True)
        self.assertNotIn(fake, str(caught.exception))

    def test_credential_rules_redact_values(self):
        cases = ["AIza" + "a" * 35, "gsk_" + "a" * 30, "hf_" + "a" * 30,
                 "ASIA" + "A" * 16, "xoxb-" + "1" * 30,
                 "postgres://" + "demo:" + "random-password@host/db",
                 "NEXT_PUBLIC_" + "API_KEY=" + "anything",
                 'api_key: "' + "a" * 24 + '"',
                 "VENDOR_API_" + "KEY=" + "b" * 24,
                 "-----BEGIN " + "RSA PRIVATE KEY-----"]
        for value in cases:
            with self.subTest(prefix=value[:5]):
                with self.assertRaises(SYNC.SyncError) as caught:
                    SYNC.check_data("README.md", value.encode())
                self.assertNotIn(value, str(caught.exception))
        SYNC.check_data("03-前端原型/.env.example", b"API_KEY=\n")

    def test_exact_workflow_allowlist_and_sensitive_files(self):
        SYNC.check_name(".github/workflows/security.yml")
        for name in [".github/workflows/deploy.yml", ".github/private.txt", "03-前端原型/credentials.json", "03-前端原型/.npmrc"]:
            with self.assertRaises(SYNC.SyncError):
                SYNC.check_name(name)

    def test_tag_message_and_historical_forbidden_path_are_checked(self):
        self.sync()
        fake = "ghp_" + "z" * 36
        self.run_git(self.root, "tag", "-a", "unsafe", "-m", fake)
        self.run_git(self.root, "tag", "-a", "nested", "unsafe", "-m", "clean outer tag")
        self.run_git(self.root, "tag", "-d", "unsafe")
        with self.assertRaisesRegex(SYNC.SyncError, "疑似凭证") as caught:
            SYNC.check_history(self.root)
        self.assertNotIn(fake, str(caught.exception))
        self.run_git(self.root, "tag", "-d", "nested")
        path = self.root / "agent-blueprint" / "input.md"
        path.parent.mkdir()
        path.write_text("source must remain local")
        self.run_git(self.root, "add", ".")
        self.run_git(self.root, "commit", "-m", "fixture")
        path.unlink()
        self.run_git(self.root, "add", "-A")
        self.run_git(self.root, "commit", "-m", "remove fixture")
        with self.assertRaisesRegex(SYNC.SyncError, "不在同步范围"):
            SYNC.check_history(self.root)

    def test_commit_message_is_scanned_before_push(self):
        self.sync()
        published = self.head(self.remote)
        (self.root / "README.md").write_text("next version")
        fake = "github_pat_" + "a" * 60
        with self.assertRaisesRegex(SYNC.SyncError, "疑似凭证") as caught:
            with contextlib.redirect_stdout(io.StringIO()):
                SYNC.sync(self.root, fake)
        self.assertNotIn(fake, str(caught.exception))
        self.assertEqual(published, self.head(self.remote))

    def test_scanner_cli_uses_trusted_rules_to_check_other_root(self):
        self.sync()
        scanner = Path(__file__).with_name("check-repository.py")
        fake = "gsk_" + "x" * 30
        (self.root / "README.md").write_text(fake)
        # An untrusted target scanner cannot replace the executable's sibling rules.
        target_scripts = self.root / "scripts"
        target_scripts.mkdir()
        (target_scripts / "check-repository.py").write_text("raise SystemExit(0)\n")
        result = subprocess.run(["python3", str(scanner), "--root", str(self.root)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("疑似凭证", result.stderr)
        self.assertNotIn(fake, result.stdout + result.stderr)

    def test_shallow_history_is_not_claimed_complete(self):
        self.sync()
        shallow = self.base / "shallow"
        self.run_git(self.base, "clone", "--depth=1", self.remote.as_uri(), str(shallow))
        with self.assertRaisesRegex(SYNC.SyncError, "浅克隆"):
            SYNC.check_history(shallow)


if __name__ == "__main__":
    unittest.main()

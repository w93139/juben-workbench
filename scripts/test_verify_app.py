import importlib.util
import contextlib
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("verify_app", Path(__file__).with_name("verify-app.py"))
VERIFY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY)


class IsolatedSourceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="workbench-verify-test-")
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name).resolve()
        self.source = self.base / "source"
        self.source.mkdir()
        self.destination = self.base / "copy"
        self.destination.mkdir()
        self.git("init", "--quiet")
        self.write(".gitignore", ".env*\nruntime-data/\nuploads/\nbackups/\n*.sqlite*\n")
        self.write("README.md", "Synthetic source only.\n")

    def git(self, *args):
        subprocess.run(["git", *args], cwd=self.source, capture_output=True, check=True)

    def write(self, name, content):
        path = self.source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        return path

    def assert_rejected_without_copy(self):
        with patch.object(VERIFY.shutil, "copy2") as copy:
            with self.assertRaises((VERIFY.SYNC.SyncError, ValueError)):
                VERIFY.copy_sources(self.source, self.destination)
            copy.assert_not_called()
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_copies_current_sources_and_skips_deleted_and_ignored_files(self):
        self.write("03-前端原型/src/current.ts", "export const current = 1;\n")
        deleted = self.write("03-前端原型/src/deleted.ts", "old\n")
        self.git("add", ".")
        deleted.unlink()
        self.write("03-前端原型/src/new.ts", "export const added = 2;\n")
        self.write("03-前端原型/.env.local", "synthetic-only\n")
        self.write("03-前端原型/runtime-data/settings.json", "{}\n")
        VERIFY.copy_sources(self.source, self.destination)
        self.assertEqual((self.destination / "03-前端原型/src/current.ts").read_text(), "export const current = 1;\n")
        self.assertTrue((self.destination / "03-前端原型/src/new.ts").is_file())
        for name in ("src/deleted.ts", ".env.local", "runtime-data/settings.json"):
            self.assertFalse((self.destination / "03-前端原型" / name).exists())

    def test_rejects_forced_tracked_runtime_data_and_env_before_copying(self):
        for name in (
            ".env.local", ".envrc", "runtime-data/settings.json", "uploads/original.txt",
            "backups/project.json", "tasks.sqlite", "tasks.sqlite-wal",
        ):
            with self.subTest(name=name):
                relative = f"03-前端原型/{name}"
                path = self.write(relative, "synthetic-only\n")
                self.git("add", "--force", relative)
                self.assert_rejected_without_copy()
                self.git("rm", "--cached", "--force", relative)
                path.unlink()

    def test_rejects_symlinks_at_leaf_or_any_ancestor_without_reading_target(self):
        original = self.write("03-前端原型/src/module.ts", "source\n")
        self.git("add", ".")
        external = self.base / "external"
        external.mkdir()
        (external / "module.ts").write_text("synthetic outside content\n")
        original.unlink()
        original.symlink_to(external / "module.ts")
        self.assert_rejected_without_copy()
        original.unlink()
        original.parent.rmdir()
        original.parent.symlink_to(external, target_is_directory=True)
        self.assert_rejected_without_copy()

    def test_rejects_protected_roots_even_if_force_added(self):
        self.write("agent-blueprint/reference.md", "synthetic protected text\n")
        self.git("add", "--force", "agent-blueprint/reference.md")
        self.assert_rejected_without_copy()

    def test_in_place_requires_explicit_ci_environment_before_any_commands(self):
        with patch.dict(os.environ, {}, clear=True), patch("sys.argv", ["verify-app.py", "--in-place"]):
            with patch.object(VERIFY.subprocess, "check_output") as command, contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as result:
                    VERIFY.main()
                self.assertEqual(result.exception.code, 2)
                command.assert_not_called()


if __name__ == "__main__":
    unittest.main()

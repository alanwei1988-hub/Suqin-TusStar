import builtins
import os
import pathlib
import shutil
import socket
import subprocess
import sys


class WorkspaceAccessError(RuntimeError):
    pass


WORKSPACE_ROOT = os.path.realpath(os.environ["WXWORK_WORKSPACE_ROOT"])
WORKING_DIR = os.path.realpath(os.environ["WXWORK_WORKING_DIR"])
CODE_PATH = os.path.realpath(os.environ["WXWORK_CODE_PATH"])
ALLOWED_READ_ROOTS = [
    os.path.realpath(value)
    for value in os.environ.get("WXWORK_ALLOWED_READ_ROOTS", "").split(os.pathsep)
    if value
]


def _coerce_path(value):
    if isinstance(value, os.PathLike):
        return os.fspath(value)
    if isinstance(value, bytes):
        return os.fsdecode(value)
    if isinstance(value, str):
        return value
    return None


def _resolve_path(value):
    raw = _coerce_path(value)
    if raw is None:
        return None
    candidate = raw
    if not os.path.isabs(candidate):
        candidate = os.path.join(os.getcwd(), candidate)
    return os.path.realpath(candidate)


def _is_under_root(candidate, root):
    return candidate == root or candidate.startswith(root + os.sep)


def _assert_workspace_path(value):
    resolved = _resolve_path(value)
    if resolved is None:
        return value
    if resolved == CODE_PATH:
        return value
    if _is_under_root(resolved, WORKSPACE_ROOT):
        return value
    raise WorkspaceAccessError(f"path escapes workspace: {value}")


def _assert_readable_path(value):
    resolved = _resolve_path(value)
    if resolved is None:
        return value
    if resolved == CODE_PATH:
        return value
    if _is_under_root(resolved, WORKSPACE_ROOT):
        return value
    for root in ALLOWED_READ_ROOTS:
        if _is_under_root(resolved, root):
            return value
    raise WorkspaceAccessError(f"path escapes workspace: {value}")


def _block_subprocess(*_args, **_kwargs):
    raise WorkspaceAccessError("subprocess access is blocked in runPython")


def _block_socket(*_args, **_kwargs):
    raise WorkspaceAccessError("network access is blocked in runPython")


def _patch_path_function(module, name, validator):
    original = getattr(module, name)

    def wrapped(target, *args, **kwargs):
        validator(target)
        return original(target, *args, **kwargs)

    setattr(module, name, wrapped)


def _patch_rename_like(module, name):
    original = getattr(module, name)

    def wrapped(src, dst, *args, **kwargs):
        _assert_workspace_path(src)
        _assert_workspace_path(dst)
        return original(src, dst, *args, **kwargs)

    setattr(module, name, wrapped)


def _patch_glob():
    import glob

    original_glob = glob.glob
    original_iglob = glob.iglob

    def glob_wrapper(pathname, *args, **kwargs):
        _assert_readable_path(pathname)
        return original_glob(pathname, *args, **kwargs)

    def iglob_wrapper(pathname, *args, **kwargs):
        _assert_readable_path(pathname)
        return original_iglob(pathname, *args, **kwargs)

    glob.glob = glob_wrapper
    glob.iglob = iglob_wrapper


def _patch_pathlib():
    original_open = pathlib.Path.open

    def open_wrapper(self, *args, **kwargs):
        mode = kwargs.get("mode")
        if mode is None and args:
            mode = args[0]
        mode = mode or "r"
        if any(flag in mode for flag in ("w", "a", "x", "+")):
            _assert_workspace_path(self)
        else:
            _assert_readable_path(self)
        return original_open(self, *args, **kwargs)

    pathlib.Path.open = open_wrapper

    for name in ["read_text", "read_bytes", "stat", "exists", "is_dir", "is_file", "iterdir", "glob", "rglob"]:
        original = getattr(pathlib.Path, name)

        def make_read_wrapper(fn):
            def wrapper(self, *args, **kwargs):
                _assert_readable_path(self)
                return fn(self, *args, **kwargs)

            return wrapper

        setattr(pathlib.Path, name, make_read_wrapper(original))

    for name in ["write_text", "write_bytes", "mkdir", "unlink", "rename", "replace", "rmdir", "touch"]:
        original = getattr(pathlib.Path, name)

        def make_write_wrapper(fn):
            def wrapper(self, *args, **kwargs):
                _assert_workspace_path(self)
                return fn(self, *args, **kwargs)

            return wrapper

        setattr(pathlib.Path, name, make_write_wrapper(original))


def _install_guards():
    original_open = builtins.open

    def open_wrapper(file, *args, **kwargs):
        mode = kwargs.get("mode")
        if mode is None and args:
            mode = args[0]
        mode = mode or "r"
        if any(flag in mode for flag in ("w", "a", "x", "+")):
            _assert_workspace_path(file)
        else:
            _assert_readable_path(file)
        return original_open(file, *args, **kwargs)

    builtins.open = open_wrapper

    _patch_path_function(os, "listdir", _assert_readable_path)
    _patch_path_function(os, "mkdir", _assert_workspace_path)
    _patch_path_function(os, "makedirs", _assert_workspace_path)
    _patch_path_function(os, "remove", _assert_workspace_path)
    _patch_path_function(os, "unlink", _assert_workspace_path)
    _patch_path_function(os, "rmdir", _assert_workspace_path)
    _patch_path_function(os, "removedirs", _assert_workspace_path)
    _patch_path_function(os, "scandir", _assert_readable_path)
    _patch_path_function(os, "stat", _assert_readable_path)
    _patch_path_function(os, "lstat", _assert_readable_path)
    _patch_path_function(os, "access", _assert_readable_path)
    _patch_path_function(os, "chmod", _assert_workspace_path)
    _patch_path_function(os, "utime", _assert_workspace_path)
    _patch_rename_like(os, "rename")
    _patch_rename_like(os, "replace")

    original_walk = os.walk

    def walk_wrapper(top, *args, **kwargs):
        _assert_readable_path(top)
        return original_walk(top, *args, **kwargs)

    os.walk = walk_wrapper

    original_chdir = os.chdir

    def chdir_wrapper(target):
        _assert_workspace_path(target)
        return original_chdir(target)

    os.chdir = chdir_wrapper
    os.system = _block_subprocess

    if hasattr(os, "popen"):
        os.popen = _block_subprocess

    subprocess.Popen = _block_subprocess
    subprocess.run = _block_subprocess
    subprocess.call = _block_subprocess
    subprocess.check_call = _block_subprocess
    subprocess.check_output = _block_subprocess

    socket.socket = _block_socket
    socket.create_connection = _block_socket

    original_copytree = shutil.copytree

    def copytree_wrapper(src, dst, *args, **kwargs):
        _assert_readable_path(src)
        _assert_workspace_path(dst)
        return original_copytree(src, dst, *args, **kwargs)

    shutil.copytree = copytree_wrapper

    original_rmtree = shutil.rmtree

    def rmtree_wrapper(path, *args, **kwargs):
        _assert_workspace_path(path)
        return original_rmtree(path, *args, **kwargs)

    shutil.rmtree = rmtree_wrapper

    _patch_glob()
    _patch_pathlib()

    def audit_hook(event, args):
        if event.startswith("subprocess"):
            raise WorkspaceAccessError("subprocess access is blocked in runPython")
        if event.startswith("socket"):
            raise WorkspaceAccessError("network access is blocked in runPython")
        if event in {
            "open",
            "os.chdir",
            "os.listdir",
            "os.listdrives",
            "os.mkdir",
            "os.remove",
            "os.rename",
            "os.replace",
            "os.rmdir",
            "os.scandir",
            "shutil.copyfile",
            "shutil.copymode",
            "shutil.copystat",
            "shutil.copytree",
            "shutil.move",
            "shutil.rmtree",
        }:
            for value in args:
                raw = _coerce_path(value)
                if raw is None:
                    continue
                if event in {"open", "os.listdir", "os.scandir"}:
                    _assert_readable_path(raw)
                else:
                    _assert_workspace_path(raw)

    sys.addaudithook(audit_hook)


def main():
    _assert_workspace_path(WORKING_DIR)
    _install_guards()
    os.chdir(WORKING_DIR)
    sys.path[0] = WORKING_DIR
    globals_dict = {
        "__name__": "__main__",
        "__file__": CODE_PATH,
        "__package__": None,
        "__cached__": None,
    }
    with builtins.open(CODE_PATH, "r", encoding="utf-8") as handle:
        code = compile(handle.read(), CODE_PATH, "exec")
    exec(code, globals_dict, globals_dict)


if __name__ == "__main__":
    try:
        main()
    except WorkspaceAccessError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)

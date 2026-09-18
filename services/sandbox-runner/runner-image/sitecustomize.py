#!/usr/bin/env python3
# Loaded by site at interpreter start: gives the sandboxed program a real input() and blocks tkinter.
# The fds are only present for the program process; every other python in the image ignores this.

from __future__ import annotations

import builtins
import json
import os
import sys

REQUEST_FD_ENV = "SNAPJAW_INPUT_REQUEST_FD"
ANSWER_FD_ENV = "SNAPJAW_INPUT_ANSWER_FD"
BLOCKED_MODULE = "tkinter"
BLOCKED_REASON = "No module named 'tkinter'. Snapjaw has no tkinter; use turtle for graphics."


def _open_fd(name: str, mode: str):
    raw = os.environ.get(name)
    if not raw:
        return None
    try:
        return os.fdopen(int(raw), mode, encoding="utf-8", buffering=1)
    except (OSError, ValueError):
        return None


_request = _open_fd(REQUEST_FD_ENV, "w")
_answer = _open_fd(ANSWER_FD_ENV, "r")


def snapjaw_input(prompt: object = "") -> str:
    text = "" if prompt is None else str(prompt)

    # Exactly what CPython does with a non-tty stdin: the prompt goes to stdout, unflushed by us.
    if text:
        sys.stdout.write(text)
        sys.stdout.flush()

    if _request is None or _answer is None:
        raise EOFError("EOF when reading a line")

    _request.write(json.dumps({"prompt": text}) + "\n")

    line = _answer.readline()
    if not line:
        raise EOFError("EOF when reading a line")

    value = line[:-1] if line.endswith("\n") else line

    # The client does not echo for us, so the typed line lands in the transcript like a terminal.
    sys.stdout.write(value + "\n")
    sys.stdout.flush()
    return value


def _importing_module(globals: object) -> str:
    name = (globals or {}).get("__name__")  # type: ignore[union-attr]
    if isinstance(name, str) and name:
        return name

    # tkinter execs "from tkinter import *" into a namespace with no __name__; its caller has one.
    frame = sys._getframe(2)
    while frame is not None:
        name = frame.f_globals.get("__name__")
        if isinstance(name, str) and name:
            return name
        frame = frame.f_back
    return ""


def block_tkinter() -> None:
    real_import = builtins.__import__

    def allowed(source: str) -> bool:
        # turtle is built on tkinter, and tkinter imports its own submodules; user code does not.
        return source == "turtle" or source.startswith("tkinter")

    def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name.split(".")[0] != BLOCKED_MODULE:
            return real_import(name, globals, locals, fromlist, level)

        if not allowed(_importing_module(globals)):
            raise ModuleNotFoundError(BLOCKED_REASON, name=name)
        return real_import(name, globals, locals, fromlist, level)

    builtins.__import__ = guarded_import


if _request is not None and _answer is not None:
    builtins.input = snapjaw_input
    block_tkinter()

#!/usr/bin/env python3
"""Snapjaw in-container executor.

Reads one run request as JSON on stdin, executes the entry file in a fresh
working directory, optionally captures the virtual display, and writes a
single JSON result to stdout after a sentinel line.

The user's program is a child process, so its output can only ever reach the
pipes this helper holds. It cannot contaminate the result payload on this
process's stdout.
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time

RESULT_SENTINEL = "__SNAPJAW_RESULT__"
WORK_ROOT = "/tmp/snapjaw-work"
DISPLAY_NUMBER = 99
XVFB_READY_TIMEOUT_S = 10.0
OUTPUT_TRUNCATION_NOTE = "\n[snapjaw] output truncated\n"


def emit(payload: dict) -> None:
    """Write the result after a sentinel so the runner can ignore stray output."""
    sys.stdout.write(f"\n{RESULT_SENTINEL}\n{json.dumps(payload)}\n")
    sys.stdout.flush()


def fail(message: str) -> None:
    emit({"ok": False, "error": message})
    sys.exit(0)


def safe_join(root: str, name: str) -> str:
    """Materialise `name` under `root`, refusing anything that escapes it."""
    if not name or "/" in name or "\\" in name or name in (".", ".."):
        raise ValueError(f"unsafe file name: {name!r}")
    target = os.path.normpath(os.path.join(root, name))
    if target != os.path.join(root, name) or not target.startswith(root + os.sep):
        raise ValueError(f"unsafe file name: {name!r}")
    return target


class StreamDrain(threading.Thread):
    """Drain a pipe continuously so the child never blocks on a full buffer."""

    def __init__(self, stream, limit: int) -> None:
        super().__init__(daemon=True)
        self.stream = stream
        self.limit = limit
        self.buffer = bytearray()
        self.truncated = False

    def run(self) -> None:
        while True:
            chunk = self.stream.read(8192)
            if not chunk:
                break
            if len(self.buffer) < self.limit:
                self.buffer.extend(chunk[: self.limit - len(self.buffer)])
            else:
                self.truncated = True
        self.stream.close()

    def text(self) -> str:
        value = self.buffer.decode("utf-8", errors="replace")
        if self.truncated:
            value += OUTPUT_TRUNCATION_NOTE
        return value


def start_display(screen: str) -> subprocess.Popen | None:
    display = f":{DISPLAY_NUMBER}"
    socket_path = f"/tmp/.X11-unix/X{DISPLAY_NUMBER}"

    try:
        os.makedirs("/tmp/.X11-unix", exist_ok=True)
    except OSError:
        pass

    for stale in (f"/tmp/.X{DISPLAY_NUMBER}-lock", socket_path):
        try:
            os.remove(stale)
        except OSError:
            pass

    try:
        process = subprocess.Popen(
            ["Xvfb", display, "-screen", "0", screen, "-nolisten", "tcp", "-ac"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except FileNotFoundError:
        return None

    deadline = time.monotonic() + XVFB_READY_TIMEOUT_S
    while time.monotonic() < deadline:
        if process.poll() is not None:
            return None
        if os.path.exists(socket_path):
            return process
        time.sleep(0.05)

    stop_process(process)
    return None


def capture_display() -> bytes | None:
    """Screenshot the virtual display as PNG bytes."""
    display = f":{DISPLAY_NUMBER}"
    attempts = (
        ["import", "-display", display, "-window", "root", "png:-"],
        ["magick", "import", "-display", display, "-window", "root", "png:-"],
        ["xwd", "-display", display, "-root", "-silent"],
    )

    for command in attempts:
        try:
            if command[0] == "xwd":
                xwd = subprocess.run(command, capture_output=True, timeout=15)
                if xwd.returncode != 0 or not xwd.stdout:
                    continue
                converted = subprocess.run(
                    ["convert", "xwd:-", "png:-"],
                    input=xwd.stdout,
                    capture_output=True,
                    timeout=15,
                )
                if converted.returncode == 0 and converted.stdout.startswith(b"\x89PNG"):
                    return converted.stdout
                continue

            result = subprocess.run(command, capture_output=True, timeout=15)
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue

        if result.returncode == 0 and result.stdout.startswith(b"\x89PNG"):
            return result.stdout

    return None


def display_has_window() -> bool:
    """True once a program has actually mapped a top-level window.

    Without this a console-only script that merely mentions turtle in a string
    would return a screenshot of an empty root window.
    """
    try:
        result = subprocess.run(
            ["xwininfo", "-display", f":{DISPLAY_NUMBER}", "-root", "-children"],
            capture_output=True,
            timeout=10,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return True

    if result.returncode != 0:
        return False

    return re.search(rb"^\s+0x[0-9a-fA-F]+\s", result.stdout, re.MULTILINE) is not None


def stop_process(process: subprocess.Popen) -> None:
    """Kill the child and everything it spawned."""
    if process.poll() is not None:
        return
    try:
        os.killpg(os.getpgid(process.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        process.kill()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass


def run(request: dict) -> dict:
    files = request.get("files") or {}
    entry_file = request.get("entryFile") or ""
    timeout_ms = int(request.get("timeoutMs") or 5000)
    capture = bool(request.get("capture"))
    max_output_bytes = int(request.get("maxOutputBytes") or 65536)
    screen = str(request.get("screen") or "1024x768x24")

    policy = request.get("capturePolicy") or {}
    first_capture_at_ms = int(policy.get("firstCaptureAtMs") or 400)
    capture_interval_ms = int(policy.get("captureIntervalMs") or 400)

    if entry_file not in files:
        return {"ok": False, "error": f"entry file {entry_file!r} is not in the project"}

    run_id = str(request.get("runId") or os.urandom(8).hex())
    workdir = os.path.join(WORK_ROOT, run_id)
    shutil.rmtree(workdir, ignore_errors=True)
    os.makedirs(workdir, exist_ok=True)

    try:
        for name, content in files.items():
            path = safe_join(workdir, str(name))
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(content if isinstance(content, str) else str(content))
    except (ValueError, OSError) as exc:
        return {"ok": False, "error": f"could not write project files: {exc}"}

    entry_path = os.path.join(workdir, entry_file)

    display_process = start_display(screen) if capture else None

    environment = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": "/tmp",
        "LANG": "C.UTF-8",
        "PYTHONIOENCODING": "utf-8",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONUNBUFFERED": "1",
        "MPLBACKEND": "Agg",
        "TMPDIR": workdir,
    }
    if display_process is not None:
        environment["DISPLAY"] = f":{DISPLAY_NUMBER}"

    started = time.monotonic()
    try:
        process = subprocess.Popen(
            [sys.executable, entry_path],
            cwd=workdir,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=environment,
            start_new_session=True,
        )
    except OSError as exc:
        if display_process is not None:
            stop_process(display_process)
        shutil.rmtree(workdir, ignore_errors=True)
        return {"ok": False, "error": f"could not start the program: {exc}"}

    assert process.stdout is not None and process.stderr is not None
    out_drain = StreamDrain(process.stdout, max_output_bytes)
    err_drain = StreamDrain(process.stderr, max_output_bytes)
    out_drain.start()
    err_drain.start()

    frame: bytes | None = None
    previous_frame: bytes | None = None
    timed_out = False
    settled = False
    last_capture_at = 0.0

    while True:
        if process.poll() is not None:
            break

        elapsed_ms = (time.monotonic() - started) * 1000
        if elapsed_ms >= timeout_ms:
            timed_out = True
            break

        if (
            display_process is not None
            and elapsed_ms >= first_capture_at_ms
            and (time.monotonic() - last_capture_at) * 1000 >= capture_interval_ms
        ):
            last_capture_at = time.monotonic()
            shot = capture_display()
            if shot is not None and display_has_window():
                # Two identical frames means the window has stopped changing,
                # so a turtle/tkinter program blocked in its main loop can end
                # now instead of burning the whole timeout.
                if previous_frame is not None and shot == previous_frame:
                    frame = shot
                    settled = True
                    break
                previous_frame = shot
                frame = shot

        time.sleep(0.05)

    duration_ms = int((time.monotonic() - started) * 1000)

    # About to terminate a program that is still running: take one last look
    # while its window is still on the display.
    if display_process is not None and frame is None and process.poll() is None:
        shot = capture_display()
        if shot is not None and display_has_window():
            frame = shot

    if process.poll() is None:
        stop_process(process)

    out_drain.join(timeout=5)
    err_drain.join(timeout=5)

    if display_process is not None:
        stop_process(display_process)

    shutil.rmtree(workdir, ignore_errors=True)
    for stale in (f"/tmp/.X{DISPLAY_NUMBER}-lock",):
        try:
            os.remove(stale)
        except OSError:
            pass

    exit_code = process.returncode if not timed_out else -1

    return {
        "ok": True,
        "stdout": out_drain.text(),
        "stderr": err_drain.text(),
        "exitCode": exit_code,
        "timedOut": timed_out,
        "durationMs": duration_ms,
        "image": base64.b64encode(frame).decode("ascii") if frame else None,
        "hadDisplay": display_process is not None,
        "settled": settled,
    }


def main() -> None:
    try:
        raw = sys.stdin.read()
    except OSError as exc:
        fail(f"could not read run request: {exc}")
        return

    try:
        request = json.loads(raw)
    except ValueError as exc:
        fail(f"could not parse run request: {exc}")
        return

    if not isinstance(request, dict):
        fail("run request must be a JSON object")
        return

    try:
        emit({"ok": True, **run(request)})
    except Exception as exc:  # noqa: BLE001 - the runner must always get a result
        emit({"ok": False, "error": f"{type(exc).__name__}: {exc}"})


if __name__ == "__main__":
    main()

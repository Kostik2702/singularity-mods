"""Drive an interactive Claude Code session in a pseudo-terminal and dump what it paints.

The live check of the sidebar: `claude plugin test` draws trees but paints nothing,
and four layout and ordering defects were only seen here (2026-10-11). Windows only.

Setup, once, outside the repo:
    python -m venv <venv> && <venv>/Scripts/python -m pip install pywinpty pyte
Usage:
    <venv>/Scripts/python tools/drive-tui.py <cwd> <outdir> "<prompt>"
Writes screen-<n>-<label>.txt (the emulated 170x50 screen, one file per snapshot)
into outdir; the sidebar is the columns right of the transcript (from about 95).
The session runs a real model turn and exits with Ctrl+C.
"""
import os
import shutil
import sys
import threading
import time

import pyte
from winpty import PtyProcess

CLAUDE = shutil.which("claude") or os.path.expanduser(r"~\.local\bin\claude.exe")
COLS, ROWS = 170, 50


def main() -> int:
    cwd, outdir, prompt = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(outdir, exist_ok=True)
    screen = pyte.Screen(COLS, ROWS)
    stream = pyte.Stream(screen)
    lock = threading.Lock()
    proc = PtyProcess.spawn([CLAUDE], dimensions=(ROWS, COLS), cwd=cwd)
    raw = open(os.path.join(outdir, "raw.log"), "w", encoding="utf-8", errors="replace")

    def reader() -> None:
        while proc.isalive():
            try:
                data = proc.read(65536)
            except EOFError:
                break
            except Exception:
                time.sleep(0.05)
                continue
            if data:
                raw.write(data)
                with lock:
                    stream.feed(data)

    threading.Thread(target=reader, daemon=True).start()
    shots = [0]

    def text() -> str:
        with lock:
            return "\n".join(line.rstrip() for line in screen.display)

    def dump(label: str) -> str:
        shots[0] += 1
        body = text()
        with open(os.path.join(outdir, f"screen-{shots[0]:02d}-{label}.txt"), "w", encoding="utf-8") as f:
            f.write(body)
        return body

    def wait_for(needles, timeout: float) -> bool:
        end = time.time() + timeout
        while time.time() < end:
            body = text()
            if any(n in body for n in needles):
                return True
            time.sleep(0.5)
        return False

    # Start-up: the prompt is ready when the input hint shows; a trust dialog gets Enter.
    ready = wait_for(["for shortcuts", "? for", "Try \"", "bypass", "auto mode"], 60)
    if "trust" in text().lower() and "folder" in text().lower():
        proc.write("\r")
        ready = wait_for(["for shortcuts", "? for"], 30)
    time.sleep(4)
    dump("ready" if ready else "not-ready")

    proc.write(prompt)
    time.sleep(1)
    proc.write("\r")

    # While the turn runs: a snapshot every 3 s, kept when the screen changed.
    last = ""
    end = time.time() + 240
    while time.time() < end:
        time.sleep(3)
        body = text()
        if body != last:
            dump("run")
            last = body
        if "Explore" in body and ("✓ Explore" in body) and ("ждёт тебя" in body or "итог:" in body):
            time.sleep(3)
            dump("settled")
            break

    dump("final")
    proc.write("\x03")
    time.sleep(1)
    proc.write("\x03")
    time.sleep(2)
    try:
        proc.terminate(force=True)
    except Exception:
        pass
    raw.close()
    print(f"snapshots: {shots[0]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

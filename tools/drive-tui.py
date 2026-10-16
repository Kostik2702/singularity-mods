"""Drive an interactive Claude Code session in a pseudo-terminal and dump what it paints.

The live check of the sidebar and the transcript: `claude plugin test` draws trees but
paints nothing, and layout and ordering defects were only ever seen here (2026-10-11,
2026-10-16). Windows (pywinpty) and macOS / Linux (the standard pty module).

Setup, once, outside the repo:
    python3 -m venv <venv> && <venv>/bin/pip install pyte          (macOS / Linux)
    python -m venv <venv> && <venv>/Scripts/pip install pywinpty pyte  (Windows)
Usage:
    <venv>/bin/python tools/drive-tui.py <cwd> <outdir> "<prompt>" [--seconds 240] [--cols 170] [--rows 50]
Writes screen-<n>-<label>.txt (the emulated screen, one file per snapshot) into outdir:
one when the prompt is ready, one each time the screen changes while the turn runs, and
the last when the screen has been still for SETTLE_S seconds. The sidebar is the columns
right of the transcript. Text only: colours and pictures (kitty graphics) are not kept.
The session runs a real model turn and exits with Ctrl+C.
"""
import os
import shutil
import sys
import threading
import time

import pyte

SETTLE_S = 12


class Proc:
    """A child in a pseudo-terminal: read() what it paints, write() keys, stop()."""

    def __init__(self, argv, cwd, cols, rows):
        if os.name == 'nt':
            from winpty import PtyProcess  # pylint: disable=import-outside-toplevel

            self._win = PtyProcess.spawn(argv, dimensions=(rows, cols), cwd=cwd)
            return
        import fcntl  # pylint: disable=import-outside-toplevel
        import pty  # pylint: disable=import-outside-toplevel
        import struct  # pylint: disable=import-outside-toplevel
        import subprocess  # pylint: disable=import-outside-toplevel
        import termios  # pylint: disable=import-outside-toplevel

        self._win = None
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
        env = dict(os.environ, TERM='xterm-256color', COLUMNS=str(cols), LINES=str(rows))
        self._child = subprocess.Popen(argv, cwd=cwd, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        self._fd = master

    def alive(self) -> bool:
        return self._win.isalive() if self._win is not None else self._child.poll() is None

    def read(self) -> str:
        if self._win is not None:
            return self._win.read(65536)
        try:
            return os.read(self._fd, 65536).decode('utf-8', errors='replace')
        except OSError:
            raise EOFError from None

    def write(self, text: str) -> None:
        if self._win is not None:
            self._win.write(text)
        else:
            os.write(self._fd, text.encode('utf-8'))

    def stop(self) -> None:
        try:
            if self._win is not None:
                self._win.terminate(force=True)
            else:
                self._child.terminate()
                self._child.wait(timeout=5)
        except Exception:
            pass


def option(name: str, default: int) -> int:
    if name in sys.argv:
        at = sys.argv.index(name)
        if at + 1 < len(sys.argv):
            return int(sys.argv[at + 1])
    return default


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    cwd, outdir, prompt = sys.argv[1], sys.argv[2], sys.argv[3]
    seconds = option('--seconds', 240)
    cols, rows = option('--cols', 170), option('--rows', 50)
    claude = shutil.which('claude') or os.path.expanduser('~/.local/bin/claude')
    os.makedirs(outdir, exist_ok=True)
    screen = pyte.Screen(cols, rows)
    stream = pyte.Stream(screen)
    lock = threading.Lock()
    proc = Proc([claude], cwd, cols, rows)
    raw = open(os.path.join(outdir, 'raw.log'), 'w', encoding='utf-8', errors='replace')

    def reader() -> None:
        while proc.alive():
            try:
                data = proc.read()
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
            return '\n'.join(line.rstrip() for line in screen.display)

    def dump(label: str) -> str:
        shots[0] += 1
        body = text()
        with open(os.path.join(outdir, f'screen-{shots[0]:02d}-{label}.txt'), 'w', encoding='utf-8') as f:
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
    hints = ['for shortcuts', '? for', '? —', 'Try "', 'bypass', 'auto mode', 'accept edits', 'Омниссия']
    ready = wait_for(hints, 60)
    if 'trust' in text().lower() and 'folder' in text().lower():
        proc.write('\r')
        ready = wait_for(hints, 30)
    time.sleep(6)
    dump('ready' if ready else 'not-ready')

    proc.write(prompt)
    time.sleep(1)
    proc.write('\r')

    # While the turn runs: a snapshot each time the screen changed; settled when it has
    # been still for SETTLE_S seconds.
    last, still_since = '', time.time()
    end = time.time() + seconds
    while time.time() < end:
        time.sleep(1.5)
        body = text()
        if body != last:
            dump('run')
            last, still_since = body, time.time()
        elif time.time() - still_since >= SETTLE_S:
            break

    dump('final')
    proc.write('\x03')
    time.sleep(1)
    proc.write('\x03')
    time.sleep(2)
    proc.stop()
    raw.close()
    print(f'snapshots: {shots[0]} in {outdir}')
    return 0


if __name__ == '__main__':
    sys.exit(main())

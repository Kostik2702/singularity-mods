"""Synthesize the slate's sounds into mission-control/sounds/ (the warhammer look).

Every sound is made here from sines, square and saw waves and noise, with the standard
library alone, so the files are this project's own:
  vox.wav        a vox chirp through static: a main turn ended
  servo.wav      a servo's whir rising: a long rite begins
  rite-done.wav  a short solemn chord, a choir's breath: a rite done
  heresy.wav     a klaxon, twice: a rite failed
  awake.wav      a rising arpeggio over a hum: the cogitator wakes
Usage: python tools/make-sounds.py   (from the repo root)
"""
import math
import os
import random
import struct
import sys
import wave

RATE = 22050
random.seed(40000)


def envelope(i: int, n: int, attack: float, release: float) -> float:
    t = i / RATE
    total = n / RATE
    a = min(1.0, t / attack) if attack > 0 else 1.0
    r = min(1.0, (total - t) / release) if release > 0 else 1.0
    return max(0.0, min(a, r))


def square(phase: float) -> float:
    return 1.0 if math.sin(phase) >= 0 else -1.0


def saw(phase: float) -> float:
    return 2.0 * ((phase / (2 * math.pi)) % 1.0) - 1.0


def write(path: str, samples: list) -> None:
    peak = max(1e-9, max(abs(s) for s in samples))
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1.0, min(1.0, s / peak * 0.9)) * 32767)) for s in samples))


def vox() -> list:
    out = []
    for freq, length in ((1320, 0.07), (0, 0.03), (990, 0.09)):
        n = int(length * RATE)
        for i in range(n):
            tone = 0.0 if freq == 0 else 0.55 * square(2 * math.pi * freq * i / RATE)
            out.append((tone + 0.25 * (random.random() * 2 - 1)) * envelope(i, n, 0.004, 0.02))
    tail = int(0.12 * RATE)
    out.extend(0.18 * (random.random() * 2 - 1) * (1 - i / tail) for i in range(tail))
    return out


def servo() -> list:
    n = int(0.65 * RATE)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / n
        freq = 110 + 170 * t * t
        phase += 2 * math.pi * freq / RATE
        tremolo = 0.75 + 0.25 * math.sin(2 * math.pi * 28 * i / RATE)
        out.append((0.6 * saw(phase) + 0.15 * (random.random() * 2 - 1)) * tremolo * envelope(i, n, 0.03, 0.12))
    return out


def chord() -> list:
    n = int(1.3 * RATE)
    notes = (220.0, 261.63, 329.63, 440.0)   # A minor, low and open
    out = []
    for i in range(n):
        vib = 1 + 0.004 * math.sin(2 * math.pi * 5.2 * i / RATE)
        s = sum(math.sin(2 * math.pi * f * vib * i / RATE) + 0.3 * math.sin(4 * math.pi * f * vib * i / RATE) for f in notes)
        out.append(s * envelope(i, n, 0.18, 0.6))
    return out


def klaxon() -> list:
    out = []
    for _ in range(2):
        for freq in (440, 330):
            n = int(0.2 * RATE)
            for i in range(n):
                out.append(0.7 * square(2 * math.pi * freq * i / RATE) * envelope(i, n, 0.005, 0.03))
        out.extend(0.0 for _ in range(int(0.06 * RATE)))
    return out


def awake() -> list:
    out = []
    notes = (196.0, 246.94, 293.66, 392.0, 493.88)
    step = int(0.14 * RATE)
    n = step * len(notes) + int(0.5 * RATE)
    for i in range(n):
        hum = 0.25 * math.sin(2 * math.pi * 98 * i / RATE)
        s = hum
        for k, f in enumerate(notes):
            start = k * step
            if i >= start:
                j = i - start
                s += 0.5 * math.sin(2 * math.pi * f * i / RATE) * math.exp(-j / (0.35 * RATE))
        out.append(s * envelope(i, n, 0.05, 0.3))
    return out


def main() -> int:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(root, 'mission-control', 'sounds')
    os.makedirs(out_dir, exist_ok=True)
    for name, make in (('vox', vox), ('servo', servo), ('rite-done', chord), ('heresy', klaxon), ('awake', awake)):
        path = os.path.join(out_dir, f'{name}.wav')
        write(path, make())
        print(path, f'{os.path.getsize(path)} bytes')
    return 0


if __name__ == '__main__':
    sys.exit(main())

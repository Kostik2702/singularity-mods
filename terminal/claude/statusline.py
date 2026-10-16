#!/usr/bin/env python3
"""The Claude Code status line as a cogitator's instrument strip (the warhammer look).

Reads the session's JSON on stdin (schema: code.claude.com/docs/en/statusline) and prints
two lines in the amber of the data-slate:

   ✠ OPUS 5.5 ▐ [1M] ⁜ усердие:high · думает ══╡ ⌂ ~/projects/x ╞══
   ДУХ МАШИНЫ ▕██████▒▒▒▒▏ 60% 602k/1M · своб. 398k ┃ ⧗ 5ч ▕█▒▒▒▏ 9% ↻4ч13м ┃ ✠ ДЕСЯТИНА $34.43

Every section draws only with its data (rate limits come after the first answer of a
Pro/Max plan, the context window is empty before the first call). A narrow terminal
(COLUMNS under 100) drops the path, the output count and the cost. Python 3.9 (the
system python3 of macOS): no match, no PEP 604. Set by tools/install.mjs, which keeps the
status line it replaced and puts it back on --uninstall.
"""
import json
import os
import sys
import time

RESET = "\033[0m"
BOLD = "\033[1m"


def fg(hex_color):
    r, g, b = int(hex_color[1:3], 16), int(hex_color[3:5], 16), int(hex_color[5:7], 16)
    return "\033[38;2;{};{};{}m".format(r, g, b)


def bg(hex_color):
    r, g, b = int(hex_color[1:3], 16), int(hex_color[3:5], 16), int(hex_color[5:7], 16)
    return "\033[48;2;{};{};{}m".format(r, g, b)


# The slate's palette (mission-control/hooks/lib/theme.ts, WARHAMMER).
INK = fg("#ffbf4d")
INK2 = fg("#e09a2e")
MUTED = fg("#9a7238")
ACCENT = fg("#ffd27a")
BRASS = fg("#a8823c")
TRACK = fg("#3a2a10")
WARN = fg("#ff9f1c")
CRIT = fg("#f03a2e")
GOOD = fg("#c4d65a")
SURFACE_BG = bg("#ffd27a")
SURFACE_INK = fg("#0e0a05")


def by_load(pct):
    """Amber at rest, orange to watch, scarlet to act."""
    if pct is None:
        return MUTED
    if pct >= 80:
        return CRIT
    if pct >= 50:
        return WARN
    return ACCENT


def human(n):
    """1234 -> 1.2k, 242000 -> 242k, 1000000 -> 1M."""
    if n is None:
        return "?"
    n = float(n)
    if n >= 1_000_000:
        return "{:.1f}M".format(n / 1_000_000).replace(".0M", "M")
    if n >= 1_000:
        return "{:.0f}k".format(n / 1_000)
    return "{:.0f}".format(n)


def gauge(pct, width):
    """A gauge between brass stops: ▕████▒▒▒▒▏, its fill coloured by the load."""
    if pct is None:
        return BRASS + "▕" + TRACK + "▒" * width + BRASS + "▏" + RESET
    filled = int(round(min(max(pct, 0), 100) / 100 * width))
    return BRASS + "▕" + by_load(pct) + "█" * filled + TRACK + "▒" * (width - filled) + BRASS + "▏" + RESET


def resets_in(epoch):
    """How soon a limit's window resets: more useful than when."""
    if not epoch:
        return None
    left = int(epoch) - int(time.time())
    if left <= 0:
        return "вот-вот"
    hours, minutes = divmod(left // 60, 60)
    if hours >= 24:
        return "{}д{}ч".format(hours // 24, hours % 24)
    if hours:
        return "{}ч{:02d}м".format(hours, minutes)
    return "{}м".format(minutes)


def short_path(path):
    if not path:
        return ""
    home = os.path.expanduser("~")
    if path == home:
        return "~"
    if path.startswith(home + os.sep):
        return "~" + path[len(home):]
    return path


def limit_chunk(label, window, compact):
    """One limit window: 5ч ▕█▒▒▒▒▏ 9% ↻4ч13м."""
    if not isinstance(window, dict):
        return None
    pct = window.get("used_percentage")
    if pct is None:
        return None
    text = "{}{}{} ".format(MUTED, label, RESET)
    if not compact:
        text += gauge(pct, 5) + " "
    text += "{}{:.0f}%{}".format(by_load(pct), pct, RESET)
    left = resets_in(window.get("resets_at"))
    if left:
        text += " {}↻{}{}".format(MUTED, left, RESET)
    return text


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    if not isinstance(data, dict):
        return 0
    try:
        columns = int(os.environ.get("COLUMNS") or 0)
    except ValueError:
        columns = 0
    compact = 0 < columns < 100
    sep = " {}┃{} ".format(BRASS, RESET)
    lines = []

    # --- the first line: who works, how, and where -------------------------------
    model = data.get("model") or {}
    ctx = data.get("context_window") or {}
    size = ctx.get("context_window_size")
    name = (model.get("display_name") or model.get("id") or "?").upper()
    head = SURFACE_BG + SURFACE_INK + BOLD + " ✠ " + name + " " + RESET + BRASS + "▐" + RESET
    if size:
        head += " {}[{}]{}".format(MUTED, human(size), RESET)
    modes = []
    if data.get("fast_mode"):
        modes.append(WARN + "форсаж" + RESET)
    effort = (data.get("effort") or {}).get("level")
    if effort:
        modes.append("{}усердие:{}{}{}".format(MUTED, INK2, effort, RESET))
    if (data.get("thinking") or {}).get("enabled"):
        modes.append(INK2 + "думает" + RESET)
    agent = (data.get("agent") or {}).get("name")
    if agent:
        modes.append("{}агент:{}{}{}".format(MUTED, INK2, agent, RESET))
    if modes:
        head += " {}⁜{} ".format(ACCENT, RESET) + (" {}·{} ".format(MUTED, RESET)).join(modes)
    cwd = short_path(data.get("cwd") or (data.get("workspace") or {}).get("current_dir"))
    if cwd and not compact:
        head += " {}══╡{} {}⌂ {}{} {}╞══{}".format(BRASS, RESET, MUTED, INK, cwd, BRASS, RESET)
    lines.append(head)

    # --- the second line: the Machine Spirit's memory, the limits, the tithe -----
    used_pct = ctx.get("used_percentage")
    used_tokens = ctx.get("total_input_tokens")
    out_tokens = ctx.get("total_output_tokens")
    second = []
    if used_pct is not None or used_tokens is not None:
        piece = "{}{}ДУХ МАШИНЫ{} ".format(BOLD, ACCENT, RESET) + gauge(used_pct, 8 if compact else 12)
        if used_pct is not None:
            piece += " {}{:.0f}%{}".format(by_load(used_pct), used_pct, RESET)
        if used_tokens is not None and size:
            # used_percentage counts input tokens (cache included): used and free come from
            # the same figure, or the gauge and the numbers would disagree.
            free = max(size - used_tokens, 0)
            piece += " {}{}/{} · своб. {}{}".format(MUTED, human(used_tokens), human(size), human(free), RESET)
        if out_tokens and not compact:
            piece += " {}(вывод {}){}".format(MUTED, human(out_tokens), RESET)
        second.append(piece)
    limits = data.get("rate_limits") or {}
    parts = [p for p in (limit_chunk("5ч", limits.get("five_hour"), compact), limit_chunk("7д", limits.get("seven_day"), compact)) if p]
    if parts:
        second.append("{}⧗{} ".format(ACCENT, RESET) + (" {}·{} ".format(MUTED, RESET)).join(parts))
    cost = (data.get("cost") or {}).get("total_cost_usd")
    if cost is not None and not compact:
        second.append("{}✠ ДЕСЯТИНА{} {}${:.2f}{}".format(MUTED, RESET, INK, cost, RESET))
    if second:
        lines.append(" " + sep.join(second))

    sys.stdout.write("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())

# singularity-mods

Claude Code mods of the Singularity setup. One so far: **mission-control**.

## mission-control

A sidebar for Claude Code with three tabs:

- **Агенты** — mission control. Answers who is working right now, what each one is doing, and why:
  - the main agent and every subagent (teammates and workflow agents included), nested by who spawned whom;
  - for each working agent:
    - its task;
    - its reason («зачем»: the last sentence it wrote before acting);
    - the call it runs now, with a live timer;
  - an ended agent folds to one line with the start of its report;
  - agents ended in earlier turns fold into «… ещё N завершённых раньше»;
  - a working agent silent for five minutes shows «нет вестей»;
  - `▶` marks the agent whose transcript is open beside the tab;
  - below the tree, a feed of recent calls of every agent, newest first.
- **Процессы** — long actions and how far they got, so a download, a training run or a dataset build is never a black box:
  - what counts: every background command (`run_in_background`, ctrl+b, a command moved to the background by its timeout), every foreground command past 5 s, and every `Monitor`. Background subagents stay on Агенты;
  - for each running one:
    - what it is: a label from the command (Скачивание, Обучение, Подготовка данных, Оценка, Установка, Сборка, Тесты, Сервер, Наблюдение, Команда) and the call's own description;
    - its gist («суть»), from the command: «скачивает model.bin ← huggingface.co», «обучает: train.py»;
    - its reason («зачем»): the last sentence the agent wrote before the call;
    - who started it (главный, or the subagent's name or type), how long it runs, background or foreground;
    - progress read live from its output: a bar with percent, count, time left, rate, epoch, loss, and the last output line. Read formats: tqdm, keras, pip/rich, git, wget, curl, `epoch/step N/M`, `[N/M]`, a bare percent. With no scale in the output it shows the output's size, and flags output silent for two minutes;
  - an ended one folds into «Завершены» with its outcome and exit code, for 30 minutes;
  - the tab comes to the front by itself, with a toast, when a new long action begins (not while you hold a pane's keyboard). Агенты shows «◷ N долгих процессов» as a pointer.
- **Память** — how much context arrives from memory (hook injections, CLAUDE.md, `mb search` / `mb code`), prompt cache, turns, context and limits, vault health. This was the standalone mod `mem-meter` before.

| Command | Does |
|---|---|
| `/mc` | open the Агенты tab |
| `/mc close` | close it |
| `/mc clear` | drop ended agents and the feed of earlier turns |
| `/jobs` | open the Процессы tab |
| `/jobs close · clear` | close it · drop ended jobs |
| `/mem` | open the Память tab |
| `/mem close · hide · show · quiet · reset` | close the tab · hide/show the band above the prompt · soft alerts on/off · reset search and turn counters |

Tool for the model: `mcp__mission-control__snapshot`, the whole state as JSON (agents, feed, jobs, memory figures, pane status).

How Процессы sees a job (probed live 2026-10-14; the engine has no list of background shells for a plugin):
- every Bash call, foreground included, writes its output as it goes to `<tmp>/claude-<uid>/<cwd slug>/<session id>/tasks/<id>.output`. The folder is found once per session by the session id under the temp roots, or learned from the first background launch's result;
- a background job's file is named in its launch result; a foreground call's is the one new file since it began, attached only when exactly one is new;
- the end: the `[exited with code N]` line the engine appends to a background output, the task's notification (`prompt.submit`, origin `task-notification`), a `TaskStop`, a monitor's deadline, or the call's own return for a foreground command;
- the files are polled once a second while a job runs: a stat, and the last 8 KB only when the file grew (`tail -c` above 1 MB).

### Load it

Claude Code loads the mod straight from this folder, watched and hot-reloaded. In `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "E:/Project/singularity-mods/mission-control" } }
```

Restart Claude Code after setting it, since `env` is read at start.

The tabs open by themselves in a fullscreen terminal from 144 columns (from 110 once you have opened one yourself). `/mc` and `/mem` open them at any width.

### Develop

```bash
tools/verify.sh            # control bytes → claude plugin validate → claude plugin test → tsc
node tools/prove-tests.mjs # planted bugs: the suite must go red on every one
```

Before any session has loaded the mod, tsc needs the engine's types:

```bash
CLAUDE_CODE_TYPES=<…/plugin-authoring/types/claude-code.d.ts> tools/verify.sh
```

After a session has loaded the mod, the engine lays them in `mission-control/.claude-plugin/types/`, which is git-ignored.

The tests draw trees but paint nothing. The live check paints them:
- `tools/drive-tui.py` runs a real interactive session in a pseudo-terminal (170×50) and saves the screens it paints. Setup and usage are in its header (Windows, `pywinpty` + `pyte` in a venv outside the repo).
- It found four defects no test could see:
  - the tab shown by default;
  - a label squeezed onto the reason's second line;
  - a reason wrapping to three lines;
  - a trimmed space.

Run it after any change to the drawing.

Layout:

| Path | What lives there |
|---|---|
| `hooks/register.tsx` | the module entry and lifecycle: `session.start`, `turn.complete`, `/mem`, `/mc`, `/jobs`, the snapshot tool, timers (the jobs' output poll among them), opening and raising the tabs |
| `hooks/jobs/` | `model.ts` (pure: a command in words, progress from output text, notifications, job rows), `hooks.tsx` (shell, Monitor and TaskStop calls, task notifications, tab render), `pane.tsx` (pure drawing) |
| `hooks/mission/` | `model.ts` (pure reducers and text helpers), `hooks.tsx` (agent observers, tab render), `pane.tsx` (pure drawing) |
| `hooks/memory/` | memory observers, the band above the prompt, the Память tab |
| `hooks/lib/` | pure helpers shared by both: palette and charts, tool calls in words, `mb` output parsing |
| `tests/` | `claude plugin test` suites; `helpers.ts` stands in for the engine beneath the plugin |

Rules the engine enforces, all found by probes (`claude plugin validate` refuses a module that breaks one):

- one hooks module per plugin, and no imports from outside the plugin folder;
- an atom passed to `read`/`update` must be made by `atom(...)` in the same file, so each file declares the atoms it uses, with identical keys and initial values;
- `$` may only be passed into a function declared in the same file, never into an imported one;
- an event takes one hook without a matcher per module; that is why the events both features need live in `register.tsx`;
- never name a variable `h`: JSX compiles to the global `h(...)`.

In tests the kit's `$` has no `state` noun. Read exact state through the snapshot tool (`tests/helpers.ts` → `snapshot($)`), and what the person sees through `$.ui.mount`.

### Troubleshoot

- **A failure inside an observer is fail-open by design.** Every hook that only watches (`tool.call`, `agent.spawn`, `turn.*`, `session.start`, …) ends in a `.catch` that lets the event go on, so a broken part of the mod can never block a tool, a prompt or the model's stream. Such a failure leaves no line in the transcript; what you see is a stale or missing row. Compare with `mcp__mission-control__snapshot`.
- **A module that does not load at all** (a syntax error, a rule of the engine broken) does show: a dim line in the transcript naming the plugin and the reason, and every detail in the debug log (`claude --debug`). Run `tools/verify.sh` before saving changes into a live folder.
- **A drawing that throws** shows its own error in place of the tab or the band (`mission-control: вкладка «Агенты» упала: …`), never an empty column.
- **A tab that does not show:** call `mcp__mission-control__snapshot`. Its `agentsPaneStatus` and `paneStatus` say what `$.ui.open` answered.
- **A job that does not show, or shows no progress:** the snapshot's `jobs` and `jobsDir`. `jobsDir: null` means the tasks folder was not found: background jobs still show (their launch names the file), a foreground one shows its time but no progress. A job with `outputPath` and `progress: null` prints nothing the parser knows: its last line still shows.
- **An agent row that is missing or stale:** the snapshot's `agents` is the raw state. The list reconcile runs every 2 s while a subagent works.
- **Design and decisions:** `docs/specs/2026-10-11-mission-control-design.md` and `docs/plans/2026-10-11-mission-control.md`.

### Uninstall

Remove `CLAUDE_CODE_PLUGIN_DIRS` from `~/.claude/settings.json` and restart Claude Code.

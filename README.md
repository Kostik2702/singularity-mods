# singularity-mods

Claude Code mods of the Singularity setup. One so far: **mission-control**.

## mission-control

A sidebar for Claude Code with two tabs:

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
- **Память** — how much context arrives from memory (hook injections, CLAUDE.md, `mb search` / `mb code`), prompt cache, turns, context and limits, vault health. This was the standalone mod `mem-meter` before.

| Command | Does |
|---|---|
| `/mc` | open the Агенты tab |
| `/mc close` | close it |
| `/mc clear` | drop ended agents and the feed of earlier turns |
| `/mem` | open the Память tab |
| `/mem close · hide · show · quiet · reset` | close the tab · hide/show the band above the prompt · soft alerts on/off · reset search and turn counters |

Tool for the model: `mcp__mission-control__snapshot`, the whole state as JSON (agents, feed, memory figures, pane status).

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
node tools/prove-tests.mjs # 10 planted bugs: the suite must go red on every one
```

Before any session has loaded the mod, tsc needs the engine's types:

```bash
CLAUDE_CODE_TYPES=<…/plugin-authoring/types/claude-code.d.ts> tools/verify.sh
```

After a session has loaded the mod, the engine lays them in `mission-control/.claude-plugin/types/`, which is git-ignored.

Layout:

| Path | What lives there |
|---|---|
| `hooks/register.tsx` | the module entry and lifecycle: `session.start`, `turn.complete`, `/mem`, `/mc`, the snapshot tool, timers, opening the tabs |
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

- **A hook that fails live** leaves a dim line in the transcript: `mission-control: <event> hook skipped: …`. The debug log (`claude --debug`) has every one.
- **A tab that does not show:** call `mcp__mission-control__snapshot`. Its `agentsPaneStatus` and `paneStatus` say what `$.ui.open` answered.
- **An agent row that is missing or stale:** the snapshot's `agents` is the raw state. The list reconcile runs every 2 s while a subagent works.
- **Design and decisions:** `docs/specs/2026-10-11-mission-control-design.md` and `docs/plans/2026-10-11-mission-control.md`.

### Uninstall

Remove `CLAUDE_CODE_PLUGIN_DIRS` from `~/.claude/settings.json` and restart Claude Code.

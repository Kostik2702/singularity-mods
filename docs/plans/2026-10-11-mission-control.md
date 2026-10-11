# Mission Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the `mem-meter` Claude Code mod into this repository as the production-ready plugin `mission-control`, and add a sidebar tab «Агенты» that shows, live, what the main agent and every subagent is doing and why.

**Architecture:** One plugin, one hooks module (`hooks/register.tsx`) that wires two features: `memory/` (the existing mem-meter, its activity log removed) and `mission/` (new). Shared pure code lives in `lib/`. The mission feature turns engine events (`agent.spawn`, `turn.start`, `turn.step`, `tool.call`, `turn.complete`, `$.agent.list()`) into `AgentRow`s through pure reducers in `mission/model.ts`. A pure `drawAgentsPane` draws the rows as a tree plus an activity feed.

**Tech Stack:** Claude Code 2.1.296 function-hooks mods (TSX, `claude-code` API, `claude-code/testing`), TypeScript 5.6.3 (`strict`, `noUncheckedIndexedAccess`, `jsxFactory: h`), Node 24 for repo tools, Git Bash.

**Spec:** `docs/specs/2026-10-11-mission-control-design.md`. Read it with this plan.

## Deviations from the spec (found by probes, 2026-10-11)

- **No shared `hooks/state.ts`.** The engine's scan accepts an atom in `read`/`update` only when `atom(...)` made it in the same file. With a shared `state.ts` the module fails to load (`hooks module did not load: the state library's update takes a source the scan can read`). Every file that reads or writes a value declares its own atom, with the same `{ plugin, key }` and the same initial value. `validate` lists reads and writes across all files.
- **Tests cannot `read($, atom)`.** The test `$` has no `state` noun. Exact state checks go through the plugin's own tool: `$.tool.call({ tool: 'mcp__mission-control__snapshot' })` returns `{ result: <json> }`. The hook answers without `next`, so no tool registration is needed in tests.
- **`AgentRow.phaseAt`** (when the current phase began) is added, for «думает 12с». **`CurrentAction.id`** (the call's `tool_use_id`) is added, so a call's end finds its row.
- **A spawn that returns neither `agentId` nor `deny`** (an internal-build remote agent) gets no row: nothing will ever end it, and it would keep the 1 s tick alive forever.
- **The main row resets on `turn.start`, not on `prompt.submit`.** `turn.start` fires for every main turn, including continuations without a typed prompt, and fires after `prompt.submit` has counted the turn. So the turn index is already current, whatever the hook order. `prompt.submit` still counts turns (memory feature).

## Global Constraints

- Plugin name `mission-control`, version `0.2.0`. State key `'mission-control'`. Pane ids: `agents` (title «Агенты»), `mem-meter` (title «Память», id kept for the person's "asked" history). Commands: `/mc [close|clear]`, `/mem [close|hide|show|quiet|reset]`. Tool: `mcp__mission-control__snapshot`.
- Limits: `MAX_AGENTS = 100`, `MAX_ACTIONS = 300`, intent and report ≤ 160 characters, task ≤ 240, description ≤ 120. «нет вестей» after `SILENT_MS = 5 * 60_000` without an event. Redraw tick 1000 ms, list reconcile 2000 ms, both only while a subagent or main works.
- Never name a variable `h` in any `.tsx`/`.ts` under `hooks/`: JSX compiles to the global `h(...)`.
- Every observer hook (`prompt.submit`, `prompt.attachment`, `tool.call`, `agent.spawn`, `turn.start`, `turn.complete`, `session.start`, `session.measure`) ends with `.catch(($, e, next) => next(e))` (fail-open). Commands end with a `.catch` that answers `{ text }` with the error. Every `ui.render` ends with a `.catch` that draws the error.
- The `turn.step` hook is `async function*` and forwards the stream with `yield* next(e)` only, never chunk by chunk. Its result may be `undefined` (seen in the test kit), so read it as `(res as TurnStepResult | undefined)?.answer ?? ''`. Post-processing sits inside `try/catch` and always `return res`.
- All user-facing text is Russian. Palette only from `hooks/lib/viz.ts` `COLORS`. A status is always an icon plus a word.
- Text files: no raw control bytes (other than `\t \n \r`), no BOM, LF line endings (`.gitattributes`).
- Tests run on both `terminal` and `desktop` surfaces wherever a pane or band is mounted.
- Verification command: `tools/verify.sh` → `== verify: PASS`. Before the mod has ever been loaded by a session, set `CLAUDE_CODE_TYPES=C:/Users/Admin/AppData/Local/Temp/claude/bundled-skills/2.1.296/606a859993e1a62c4adf56a92e851a92/plugin-authoring/types/claude-code.d.ts`.

## Review Focus

1. **Many agents at once, nested** (6 working subagents, two levels deep): every name stays on screen, and the 4-line blocks do not push the feed out. Test: Task 6 `six working agents, nested, all visible`.
2. **A narrow dock** (`bodyColumns: 30`): nothing throws, names and icons stay visible, long text is cut, not wrapped into chaos. Test: Task 6 `a 30-column dock still draws every agent`.
3. **Loops no row follows** (the engine's own compaction/memory forks raise `turn.step`/`tool.call` with an `agentId` no spawn named): no phantom rows. Feed label `↳фон`. Tests: Task 4 `a loop no row follows is left alone`, Task 6 `an unknown loop's call is labelled ↳фон`.
4. **Markdown-heavy or huge narration** (tables, fenced code, 5 000-character answers): «зачем» stays one clean sentence of ≤ 160 characters. Tests: Task 3 `a fenced code block and a table never become the reason`, `a 5000-character answer gives one clipped sentence`.
5. **The mod loads mid-session** (hot reload, or the env var set while agents work): agents known only from `$.agent.list()` appear with type and description, ended ones fold away. Test: Task 4 `an agent we never saw is added from the list`; live check in Task 8.

---

## File Structure

```
E:\Project\singularity-mods\
  .gitattributes                  * text=auto eol=lf
  .gitignore                      **/.claude-plugin/types/  .tmp/  node_modules/
  README.md                       what, load, commands, develop, troubleshoot (Task 8)
  tools/verify.sh                 control bytes → validate → test → tsc; exit 0 only when all pass
  tools/check-bytes.mjs           fails on raw control bytes / BOM in text files
  tools/fallback-tsconfig.mjs     tsconfig for tsc before the engine laid types beside the mod
  tools/prove-tests.mjs           mutation smoke: planted bugs must turn the suite red (Task 7)
  docs/specs/…, docs/plans/…
  mission-control/
    .claude-plugin/plugin.json    name, version, author, types
    hooks/hooks.json              { "modules": ["./register.tsx"] }
    hooks/register.tsx            session.start (tool, pane order), snapshot tool, registerMission, registerMemory
    hooks/lib/viz.ts              moved unchanged from hooks/viz.ts
    hooks/lib/actions.ts          moved unchanged from hooks/actions.ts
    hooks/lib/parse.ts            moved unchanged from hooks/parse.ts
    hooks/memory/hooks.tsx        memory hooks, /mem, band, Memory tab render, openMemoryPane
    hooks/memory/pane.tsx         drawMemoryPane (pure) = old pane.tsx minus the activity log
    hooks/mission/model.ts        pure: text helpers, AgentRow reducers, tree, limits
    hooks/mission/hooks.tsx       mission hooks, /mc, ticks, Agents tab render, openAgentsPane
    hooks/mission/pane.tsx        drawAgentsPane (pure)
    types/index.d.ts              state contract
    tests/helpers.ts              engine-beneath stub, event raisers, snapshot, mount
    tests/actions.test.ts, parse.test.ts, viz.test.ts   moved imports only
    tests/memory.test.ts          was band.test.ts
    tests/mission-text.test.ts    Task 3
    tests/mission-model.test.ts   Task 4
    tests/mission-events.test.ts  Task 5
    tests/mission-pane.test.ts    Task 6
    tsconfig.json                 extends ./.claude-plugin/types/tsconfig.json
```

---

### Task 1: Repository tooling and the as-is import of mem-meter

**Files:**
- Create: `.gitattributes`, `tools/verify.sh`, `tools/check-bytes.mjs`, `tools/fallback-tsconfig.mjs`
- Modify: `.gitignore`
- Create (copy): `mission-control/**` from `C:/Users/Admin/.claude/skills/mem-meter/**`, plus `mission-control/tsconfig.json`

**Interfaces:**
- Produces: `tools/verify.sh` (exit 0 = all green), `tools/check-bytes.mjs <paths…>` (exit 1 on any control byte), `tools/fallback-tsconfig.mjs <claude-code.d.ts> <mod>` (prints a tsconfig to stdout).

- [ ] **Step 1: Write `.gitattributes` and `.gitignore`**

`.gitattributes`:
```
* text=auto eol=lf
```
`.gitignore`:
```
**/.claude-plugin/types/
.tmp/
node_modules/
```

- [ ] **Step 2: Write `tools/check-bytes.mjs`**

```js
// Fails when a text file holds a raw control byte (other than tab, LF, CR) or a BOM.
// The Edit/Write boundary has put U+0000 into source before (TKH-094), and no
// compiler, linter or test of this repo would notice it.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

const TEXT = new Set(['.ts', '.tsx', '.mjs', '.js', '.json', '.md', '.sh'])

function* walk(path) {
  if (statSync(path).isFile()) {
    yield path
    return
  }
  for (const name of readdirSync(path)) {
    if (name === '.git' || name === 'node_modules' || name === '.tmp') continue
    const child = join(path, name)
    if (child.replaceAll('\\', '/').endsWith('.claude-plugin/types')) continue
    yield* walk(child)
  }
}

let files = 0
let bad = 0
for (const root of process.argv.slice(2)) {
  for (const file of walk(root)) {
    if (!TEXT.has(extname(file))) continue
    files += 1
    const text = readFileSync(file, 'utf8')
    if (text.charCodeAt(0) === 0xfeff) {
      console.log(`${file}: BOM`)
      bad += 1
    }
    text.split('\n').forEach((line, i) => {
      for (const ch of line) {
        const code = ch.codePointAt(0) ?? 0
        if (code < 32 && code !== 9 && code !== 13) {
          console.log(`${file}:${i + 1}: control byte U+${code.toString(16).padStart(4, '0')}`)
          bad += 1
        }
      }
    })
  }
}
console.log(`check-bytes: ${files} files, ${bad} problems`)
process.exit(bad === 0 ? 0 : 1)
```

- [ ] **Step 3: Prove the byte guard catches a planted byte, then passes on a clean file**

Run:
```bash
mkdir -p .tmp/bytes && node -e "require('fs').writeFileSync('.tmp/bytes/bad.ts', 'const a = 1' + String.fromCharCode(0) + '\n')" && node tools/check-bytes.mjs .tmp/bytes; echo "EXIT=$?"
node -e "require('fs').writeFileSync('.tmp/bytes/bad.ts', 'const a = 1\n')" && node tools/check-bytes.mjs .tmp/bytes; echo "EXIT=$?"
```
Expected: the first prints `.tmp/bytes/bad.ts:1: control byte U+0000` and `EXIT=1`; the second prints `check-bytes: 1 files, 0 problems` and `EXIT=0`. Note: `.tmp` is skipped only when it is a child of a walked folder; here it is the root argument, so it is scanned.

- [ ] **Step 4: Write `tools/fallback-tsconfig.mjs`**

```js
// Prints a tsconfig that type-checks the mod before any session has loaded it (the
// engine lays .claude-plugin/types/ beside a mod only when it loads it): the
// engine's own compiler options, the given claude-code.d.ts included by path.
import { resolve } from 'node:path'

const [types, mod] = process.argv.slice(2)
if (types === undefined || mod === undefined) {
  console.error('usage: node tools/fallback-tsconfig.mjs <claude-code.d.ts> <mod folder>')
  process.exit(2)
}
const abs = path => resolve(path).replaceAll('\\', '/')
const config = {
  compilerOptions: {
    target: 'es2023',
    lib: ['es2023'],
    module: 'esnext',
    moduleResolution: 'bundler',
    strict: true,
    noUncheckedIndexedAccess: true,
    noEmit: true,
    skipLibCheck: true,
    jsx: 'react',
    jsxFactory: 'h',
    jsxFragmentFactory: 'Fragment',
    types: [],
  },
  include: [abs(types), abs(`${mod}/hooks`), abs(`${mod}/types`), abs(`${mod}/tests`)],
}
console.log(JSON.stringify(config, null, 2))
```

- [ ] **Step 5: Write `tools/verify.sh`**

```bash
#!/usr/bin/env bash
# Verifies the mission-control mod: control bytes, manifest and module scan, tests, types.
# Run from anywhere in Git Bash: tools/verify.sh
# Before any session has loaded the mod, point tsc at the engine's types:
#   CLAUDE_CODE_TYPES=<path to plugin-authoring/types/claude-code.d.ts> tools/verify.sh
set -u
cd "$(dirname "$0")/.." || exit 2
MOD=mission-control
TSC_PKG=typescript@5.6.3
mkdir -p .tmp
fail=0
step() { printf '\n== %s\n' "$1"; }

step "control bytes"
node tools/check-bytes.mjs "$MOD" docs tools README.md || fail=1

step "claude plugin validate"
claude plugin validate "$MOD" > .tmp/validate.log 2>&1
code=$?
cat .tmp/validate.log
[ $code -eq 0 ] || fail=1

step "claude plugin test"
claude plugin test "$MOD" > .tmp/test.log 2>&1
code=$?
tail -n 40 .tmp/test.log
[ $code -eq 0 ] || fail=1

step "tsc"
if [ -f "$MOD/.claude-plugin/types/tsconfig.json" ]; then
  npx -y -p "$TSC_PKG" tsc -p "$MOD"
  code=$?
elif [ -n "${CLAUDE_CODE_TYPES:-}" ] && [ -f "${CLAUDE_CODE_TYPES}" ]; then
  node tools/fallback-tsconfig.mjs "$CLAUDE_CODE_TYPES" "$MOD" > .tmp/tsconfig.fallback.json
  npx -y -p "$TSC_PKG" tsc -p .tmp/tsconfig.fallback.json
  code=$?
else
  echo "no engine types: load the mod in a session once, or set CLAUDE_CODE_TYPES"
  code=1
fi
[ $code -eq 0 ] || fail=1

if [ $fail -eq 0 ]; then printf '\n== verify: PASS\n'; else printf '\n== verify: FAIL\n'; fi
exit $fail
```

README.md does not exist until Task 8. `check-bytes` would crash on the missing path. Until then, run verify with the README path present by creating a one-line placeholder `README.md` containing `# singularity-mods` in this step; Task 8 replaces it.

- [ ] **Step 6: Copy mem-meter byte for byte and add the tsconfig**

```bash
cp -r C:/Users/Admin/.claude/skills/mem-meter mission-control
diff -r C:/Users/Admin/.claude/skills/mem-meter mission-control && echo IDENTICAL
```
Expected: `IDENTICAL`. Then write `mission-control/tsconfig.json`:
```json
{
  "extends": "./.claude-plugin/types/tsconfig.json"
}
```

- [ ] **Step 7: Run verify on the imported copy**

Run: `CLAUDE_CODE_TYPES=C:/Users/Admin/AppData/Local/Temp/claude/bundled-skills/2.1.296/606a859993e1a62c4adf56a92e851a92/plugin-authoring/types/claude-code.d.ts bash tools/verify.sh; echo "EXIT=$?"`
Expected:
- `29 pass`, `0 fail`;
- validate passes (warnings allowed);
- tsc prints nothing;
- `== verify: PASS`, `EXIT=0`.

If tsc fails on the untouched copy, record the errors in the learnings: they are pre-existing, and Task 2 must end with a clean tsc.

- [ ] **Step 8: Commit**

```bash
git add .gitattributes .gitignore README.md tools mission-control
git commit -m "chore: import mem-meter as-is and add repo verification tools"
```

---

### Task 2: Rename to mission-control, split into lib/memory/mission, drop the log from the Memory tab

**Files:**
- Move: `hooks/viz.ts → hooks/lib/viz.ts`, `hooks/actions.ts → hooks/lib/actions.ts`, `hooks/parse.ts → hooks/lib/parse.ts`, `hooks/pane.tsx → hooks/memory/pane.tsx`, `tests/band.test.ts → tests/memory.test.ts`
- Create: `hooks/memory/hooks.tsx`, `hooks/mission/hooks.tsx` (activity feed only, for now)
- Rewrite: `hooks/register.tsx`, `types/index.d.ts`, `.claude-plugin/plugin.json`
- Modify: `hooks/memory/pane.tsx`, `tests/actions.test.ts`, `tests/parse.test.ts`, `tests/viz.test.ts`, `tests/memory.test.ts`

(All paths below are under `mission-control/`.)

**Interfaces:**
- Produces:
  - `registerMemory(on: On): void` and `openMemoryPane($: EngineInterface): Promise<void>`, `MEMORY_PANE = 'mem-meter'` — from `hooks/memory/hooks.tsx`;
  - `registerMission(on: On): void` — from `hooks/mission/hooks.tsx`;
  - the full contract in `types/index.d.ts`: `Action` with `agentId: string | null`, `AgentPhase`, `CurrentAction`, `AgentRow`, and the state keys `agents` and `agentsPaneStatus`.

- [ ] **Step 1: Update the tests first (they must fail on the old code)**

`git mv tests/band.test.ts tests/memory.test.ts`, then in `tests/memory.test.ts`:
- replace every `plugin: 'mem-meter'` with `plugin: 'mission-control'`;
- replace every `title: 'Память → контекст'` with `title: 'Память'` (in `PANE_UP` and in each mount);
- in the test `the pane logs actions in words and shows cache use after a turn`, rename it to `the Memory tab shows cache use after a turn and no activity log`. Delete the two lines that expect `/поискал в памяти «кэш промпта»/` and `/прочитал CLAUDE-CODE-CLI-CUSTOMIZATION\.md/`, and add in their place:
```ts
    expect(await ui.find({ text: /поискал в памяти/ })).toBeUndefined()
    expect(await ui.find({ text: /Сейчас · ход|Ход \d/ })).toBeUndefined()
```
In `tests/actions.test.ts` change the imports to `'../hooks/lib/actions'` and `'../hooks/lib/viz'`; in `tests/parse.test.ts` to `'../hooks/lib/parse'`; in `tests/viz.test.ts` to `'../hooks/lib/viz'`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `claude plugin test mission-control; echo "EXIT=$?"`
Expected: `EXIT=1`; the unit files fail to load (`cannot find module ../hooks/lib/...`) and the memory tests fail (no plugin `mission-control`).

- [ ] **Step 3: Move the files**

```bash
cd mission-control
mkdir -p hooks/lib hooks/memory hooks/mission
git mv hooks/viz.ts hooks/lib/viz.ts
git mv hooks/actions.ts hooks/lib/actions.ts
git mv hooks/parse.ts hooks/lib/parse.ts
git mv hooks/pane.tsx hooks/memory/pane.tsx
cd ..
```
`hooks/lib/actions.ts` imports `./parse`, which is still beside it: no edit.

- [ ] **Step 4: Rewrite `.claude-plugin/plugin.json`**

```json
{
  "name": "mission-control",
  "version": "0.2.0",
  "description": "Sidebar mission control for Claude Code: what the main agent and every subagent is doing and why, and how much context arrives from memory",
  "author": { "name": "Kostyantyn Hrytsuk" },
  "types": "./types/index.d.ts"
}
```

- [ ] **Step 5: Rewrite `types/index.d.ts`**

```ts
/** One settings-hook injection the model read (SessionStart, UserPromptSubmit, PreToolUse...). */
export type HookInjection = {
  /** Hash of event + text: the same injection carried again is not counted twice. */
  id: string
  event: string
  tokens: number
  chars: number
  preview: string
  turn: number
}

/** One Bash/PowerShell call that ran `mb search` or `mb code`. */
export type MbCall = {
  id: string
  kind: 'search' | 'code'
  queries: string[]
  /** Result rows parsed from the output; null when the output has no rows to parse (`mb code`). */
  hits: number | null
  memHits: number
  codeHits: number
  best: number | null
  tokens: number
  paths: string[]
  turn: number
  isAgent: boolean
  isError: boolean
}

/** One finished turn: how much memory reached the model during it. */
export type TurnRow = {
  index: number
  searches: number
  /** Estimated tokens of the turn's mb search / mb code outputs. */
  searchTokens: number
  hookTokens: number
  /** Wall time of the turn, as turn.complete reports it. */
  durationMs?: number
  /** Tool calls of the turn, subagents' included, and how many of them changed files. */
  actions?: number
  edits?: number
  /** The turn's API usage summed over its responses (turn.complete's `usage`). */
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
}

/** One tool call in plain words: the activity feed of every loop. */
export type Action = {
  id: string
  turn: number
  kind: 'memory' | 'read' | 'edit' | 'delete' | 'run' | 'web' | 'agent' | 'ask' | 'other'
  run: string
  done: string
  target: string
  status: 'run' | 'ok' | 'error' | 'denied'
  /** The loop that made the call: a subagent's id, null on the main loop. */
  agentId: string | null
  startedAt: number
  ms: number | null
}

/** An instruction file (CLAUDE.md and its imports) with the engine's own token count. */
export type ClaudeMdFile = { path: string; tokens: number }

export type Usage = {
  /** Input tokens the last response was answered over (the live context fill). */
  tokens: number | null
  percent: number | null
  window: number
  fiveHour: number | null
  sevenDay: number | null
}

/** Vault state read from Singularity's cached files (no `mb` process is run). */
export type Alerts = {
  plans: number
  doctorWarn: number
  doctorFail: number
  /** Why the vault could not be read (config missing, fs refused); null when it was. */
  error: string | null
}

/**
 * Where an agent's loop stands. "No news" is not a phase: it is drawn for a
 * working row that has sent no event for a while (isSilent).
 */
export type AgentPhase =
  | 'starting'
  | 'thinking'
  | 'acting'
  | 'waiting'
  | 'idle'
  | 'done'
  | 'failed'
  | 'aborted'
  | 'denied'

/** A loop's latest tool call; it stays after its end, carrying the outcome. */
export type CurrentAction = {
  /** The call's tool_use_id: how its end finds it. */
  id: string
  kind: Action['kind']
  run: string
  done: string
  target: string
  status: Action['status']
  startedAt: number
  ms: number | null
}

/** One model loop of the session: main, or a subagent, teammate or workflow agent. */
export type AgentRow = {
  /** 'main', the agent's id, or `denied:<tool_use_id>` for a refused spawn. */
  id: string
  /** null for main only; 'main' for an agent the main loop spawned. */
  parentId: string | null
  /** The main loop's turn it was spawned in; -1 when unknown and already ended. */
  turn: number
  /** subagentType; 'главный' for main. */
  type: string
  name: string | null
  /** The Agent call's few-word description, ≤ 120. */
  description: string
  /** The prompt in one plain line, ≤ 240. */
  task: string
  model: string | null
  isBackground: boolean
  isTeammate: boolean
  workflowRunId: string | null
  phase: AgentPhase
  /** When the current phase began: "думает 12с". */
  phaseAt: number
  startedAt: number
  endedAt: number | null
  /** The last event of its loop: a working row silent for long is "no news". */
  lastEventAt: number
  steps: number
  tools: number
  /** The last sentence of its latest step text: what it does next and why, ≤ 160. */
  intent: string | null
  current: CurrentAction | null
  /** The first sentence of its report (or a refusal's reason), ≤ 160. */
  report: string | null
  /** Tokens its turns reported, all kinds summed. */
  tokens: number
  /** The parent's Agent call id. */
  toolUseId: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'mission-control': {
      hooks: HookInjection[]
      calls: MbCall[]
      reads: string[]
      claudeMd: ClaudeMdFile[]
      turns: TurnRow[]
      turn: number
      usage: Usage | null
      alerts: Alerts | null
      isHidden: boolean
      isQuiet: boolean
      /** The Memory tab's last `$.ui.open` outcome: 'placed', or why not. */
      paneStatus: string | null
      /** The Agents tab's last `$.ui.open` outcome. */
      agentsPaneStatus: string | null
      actions: Action[]
      /** When the last main turn ended ($.clock.now() ms): how long the prompt cache has idled. */
      lastTurnEndAt: number | null
      agents: AgentRow[]
    }
  }
}
```

- [ ] **Step 6: Edit `hooks/memory/pane.tsx` (the old pane minus the activity log)**

Exact edits:
1. Imports become:
```tsx
import type { ElementTable, RenderChildren } from 'claude-code'

import type { Alerts, ClaudeMdFile, HookInjection, MbCall, TurnRow, Usage } from '../../types'
import { fmtTokens } from '../lib/parse'
import { COLORS, allocate, bigText, fmtDur, meter, pct, plural, rule, sparkline } from '../lib/viz'
```
2. Rename `export type PaneData` to `export type MemoryPaneData` and delete its `actions: readonly Action[]` field.
3. Delete `const LOG_ROWS = 8`, the `STATUS_ICON` record and the `verbColor` function.
4. Rename `export function drawPane(table: ElementTable, d: PaneData, …)` to `export function drawMemoryPane(table: ElementTable, d: MemoryPaneData, cols: number, rows: number)`.
5. Delete the whole block from `// ── Activity log: the newest turn that did anything, oldest step at the top ──` through the end of the `const logBlock = …` expression.
6. In the returned tree, delete `{section(logTitle, logBlock)}`.
7. Change the footer text `/mem close · quiet · reset` to `/mem close · quiet · reset · /mc`.

Keep `clip` (the search block uses it) and `plural`/`fmtDur` (the turns and cache blocks use them).

- [ ] **Step 7: Write `hooks/memory/hooks.tsx`**

```tsx
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Alerts, ClaudeMdFile, HookInjection, MbCall, TurnRow, Usage } from '../../types'
import {
  countDoctor,
  estimateTokens,
  findMbInvocations,
  fmtTokens,
  hashText,
  matchesHitPath,
  parseSearchOutput,
  shortEvent,
} from '../lib/parse'
import type { MbInvocation } from '../lib/parse'
import { COLORS } from '../lib/viz'
import { drawMemoryPane } from './pane'

export const MEMORY_PANE = 'mem-meter'
const MEMORY_TITLE = 'Память'
const MAX_HOOKS = 100
const MAX_CALLS = 200
const MAX_TURNS = 50
const ALERTS_EVERY_MS = 5 * 60_000

/** Hard alerts: a figure past these shows on the band even while the pane is up. */
const CTX_ALERT = 80
const FIVE_HOUR_ALERT = 80
const SEVEN_DAY_ALERT = 90

// The engine's scan accepts only an atom made in the same file: every file declares
// the values it reads or writes, with the same key and initial value as the others.
const hooksA = atom({ plugin: 'mission-control', key: 'hooks' } as const, [])
const callsA = atom({ plugin: 'mission-control', key: 'calls' } as const, [])
const readsA = atom({ plugin: 'mission-control', key: 'reads' } as const, [])
const claudeMdA = atom({ plugin: 'mission-control', key: 'claudeMd' } as const, [])
const turnsA = atom({ plugin: 'mission-control', key: 'turns' } as const, [])
const turnA = atom({ plugin: 'mission-control', key: 'turn' } as const, 0)
const usageA = atom({ plugin: 'mission-control', key: 'usage' } as const, null)
const alertsA = atom({ plugin: 'mission-control', key: 'alerts' } as const, null)
const hiddenA = atom({ plugin: 'mission-control', key: 'isHidden' } as const, false)
const quietA = atom({ plugin: 'mission-control', key: 'isQuiet' } as const, false)
const paneStatusA = atom({ plugin: 'mission-control', key: 'paneStatus' } as const, null)
const actionsA = atom({ plugin: 'mission-control', key: 'actions' } as const, [])
const lastEndA = atom({ plugin: 'mission-control', key: 'lastTurnEndAt' } as const, null)

type $ = EngineInterface

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function recordInjection($: $, event: string, text: string): Promise<void> {
  const id = hashText(`${event}\n${text}`)
  const turn = await read($, turnA)
  const row: HookInjection = {
    id,
    event,
    tokens: estimateTokens(text),
    chars: text.length,
    preview: text.split('\n').find(line => line.trim().length > 0)?.trim().slice(0, 120) ?? '',
    turn,
  }
  await update($, hooksA, list => (list.some(inj => inj.id === id) ? list : [...list, row].slice(-MAX_HOOKS)))
}

async function recordMbCall(
  $: $,
  id: string,
  invocations: MbInvocation[],
  text: string,
  flags: { isError: boolean; isAgent: boolean },
): Promise<void> {
  const isSearch = invocations.some(i => i.kind === 'search')
  const parsed = isSearch ? parseSearchOutput(text, invocations.every(i => i.isCodeOnly)) : null
  const call: MbCall = {
    id,
    kind: isSearch ? 'search' : 'code',
    queries: invocations.map(i => i.query),
    hits: parsed?.hits ?? null,
    memHits: parsed?.memHits ?? 0,
    codeHits: parsed?.codeHits ?? 0,
    best: parsed?.best ?? null,
    tokens: estimateTokens(text),
    paths: parsed?.paths ?? [],
    turn: await read($, turnA),
    isAgent: flags.isAgent,
    isError: flags.isError,
  }
  await update($, callsA, list => [...list.filter(c => c.id !== id), call].slice(-MAX_CALLS))
}

/** The engine's own token count per instruction file, from the /context breakdown. */
async function refreshClaudeMd($: $): Promise<void> {
  let files: readonly { path: string; tokens: number }[] | undefined
  try {
    files = (await $.session.usage({ breakdown: 'summary' })).context.breakdown?.memoryFiles
  } catch {
    return // no session bound yet (or no breakdown on this host): keep the last figures
  }
  if (files === undefined) return
  const rows: ClaudeMdFile[] = files.map(f => ({ path: f.path, tokens: f.tokens }))
  await update($, claudeMdA, () => rows)
}

async function readText($: $, path: string): Promise<string> {
  const body = await $.fs.read(path)
  if (typeof body !== 'string') throw new Error(`${path}: not text`)
  return body
}

/** Vault location from Singularity's per-machine config, as its own hooks resolve it. */
async function vaultPath($: $): Promise<string> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (home === undefined) throw new Error('no USERPROFILE/HOME')
  const cfg = JSON.parse(await readText($, `${home}/.singularity.json`)) as { vault_path?: unknown }
  if (typeof cfg.vault_path !== 'string') throw new Error('.singularity.json has no vault_path')
  return cfg.vault_path
}

/** Reads the same cached files session_start.py reads; never runs `mb` (a cold run takes ~20 s). */
async function refreshAlerts($: $): Promise<void> {
  const next: Alerts = { plans: 0, doctorWarn: 0, doctorFail: 0, error: null }
  try {
    const vault = await vaultPath($)
    if (await $.fs.exists(`${vault}/compaction-plans`)) {
      const entries = await $.fs.list(`${vault}/compaction-plans`)
      next.plans = entries.filter(f => f.kind === 'file' && f.name.endsWith('.md')).length
    }
    if (await $.fs.exists(`${vault}/.mb/doctor-last.json`)) {
      const doctor = countDoctor(await readText($, `${vault}/.mb/doctor-last.json`))
      next.doctorWarn = doctor.warn
      next.doctorFail = doctor.fail
    }
  } catch (err) {
    next.error = reason(err)
  }
  await update($, alertsA, () => next)
}

/** Is the Memory tab on screen right now (open, placed and shown)? Unknown counts as no: the band then carries the meter. */
async function isPaneUp($: $): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(p => p.id === MEMORY_PANE && p.isPlaced && p.isShown)
  } catch {
    return false
  }
}

/** Opens the Memory tab unless it is open; records what the engine answered, so a tab that never shows can be explained. */
export async function openMemoryPane($: $): Promise<void> {
  try {
    if ((await $.ui.panes()).some(p => p.id === MEMORY_PANE)) {
      await update($, paneStatusA, () => 'already open')
      return
    }
    const opened = await $.ui.open({ id: MEMORY_PANE, title: MEMORY_TITLE })
    await update($, paneStatusA, () => (opened.isPlaced ? 'placed' : `not placed: ${opened.reason}`))
  } catch (err) {
    await update($, paneStatusA, () => `open failed: ${reason(err)}`)
  }
}

function sum(list: readonly { tokens: number }[]): number {
  return list.reduce((acc, x) => acc + x.tokens, 0)
}

/** Totals and counts per settings-hook event, in first-seen order. */
function byEvent(hooks: readonly HookInjection[]): { event: string; tokens: number; count: number }[] {
  const totals = new Map<string, { tokens: number; count: number }>()
  for (const inj of hooks) {
    const t = totals.get(inj.event) ?? { tokens: 0, count: 0 }
    totals.set(inj.event, { tokens: t.tokens + inj.tokens, count: t.count + 1 })
  }
  return [...totals.entries()].map(([event, t]) => ({ event, ...t }))
}

type AlertItem = { text: string; level: 'error' | 'warning' | 'soft' }

function hardAlerts(usage: Usage | null, alerts: Alerts | null): AlertItem[] {
  const items: AlertItem[] = []
  if (usage?.percent != null && usage.percent >= CTX_ALERT) {
    items.push({ text: `контекст ${usage.percent}%`, level: usage.percent >= 90 ? 'error' : 'warning' })
  }
  if (usage?.fiveHour != null && usage.fiveHour >= FIVE_HOUR_ALERT) {
    items.push({ text: `5h ${Math.round(usage.fiveHour)}%`, level: usage.fiveHour >= 95 ? 'error' : 'warning' })
  }
  if (usage?.sevenDay != null && usage.sevenDay >= SEVEN_DAY_ALERT) {
    items.push({ text: `7d ${Math.round(usage.sevenDay)}%`, level: 'warning' })
  }
  if (alerts !== null && alerts.doctorFail > 0) items.push({ text: `doctor FAIL×${alerts.doctorFail}`, level: 'error' })
  return items
}

function softAlerts(alerts: Alerts | null): AlertItem[] {
  if (alerts === null) return []
  const items: AlertItem[] = []
  if (alerts.plans > 0) items.push({ text: `compaction-планов ${alerts.plans}`, level: 'soft' })
  if (alerts.doctorWarn > 0) items.push({ text: `doctor WARN×${alerts.doctorWarn}`, level: 'soft' })
  if (alerts.error !== null) items.push({ text: `vault не прочитан: ${alerts.error}`, level: 'soft' })
  return items
}

/** Everything the band and the Memory tab read, in one place. */
async function memoryData($: $) {
  const hooks = await read($, hooksA)
  const calls = await read($, callsA)
  const reads = await read($, readsA)
  const claudeMd = await read($, claudeMdA)
  const turns = await read($, turnsA)
  const usage = await read($, usageA)
  const alerts = await read($, alertsA)
  const searches = calls.filter(c => c.kind === 'search')
  const hits = searches.reduce((acc, c) => acc + (c.hits ?? 0), 0)
  const best = searches.reduce<number | null>((acc, c) => (c.best !== null && (acc === null || c.best > acc) ? c.best : acc), null)
  const codeQueries = calls.filter(c => c.kind === 'code').length + searches.filter(c => c.codeHits > 0).length
  const shown = new Set(calls.flatMap(c => c.paths)).size
  const turn = await read($, turnA)
  const lastTurnEndAt = await read($, lastEndA)
  const now = await $.clock.now()
  return { hooks, calls, reads, claudeMd, turns, usage, alerts, searches, hits, best, codeQueries, shown, turn, lastTurnEndAt, now }
}

export function registerMemory(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mem',
      description: 'Память → контекст: вкладка «Память»; /mem close|hide|show|quiet|reset',
      argumentHint: '[close|hide|show|quiet|reset]',
    })
    await refreshAlerts($)
    $.clock.every(ALERTS_EVERY_MS, () => void refreshAlerts($))
    // Idle times are drawn from the clock: redraw once a minute so they stay true.
    $.clock.every(60_000, () => $.ui.invalidate('ui.render'))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    await update($, turnA, n => n + 1)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Every text the engine injects for the model, raised on every request that carries it
  // (seen live: SessionStart's text arrived after a mid-session load); only a settings
  // hook's (Singularity's) is memory, and the hash keeps each one counted once.
  on('prompt.attachment', async ($, e, next) => {
    const answer = await next(e)
    if (e.origin.kind === 'hook' && answer.text !== null && answer.text.length > 0) {
      await recordInjection($, e.origin.event, answer.text)
    }
    return answer
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const invocations = findMbInvocations(e.command)
    if (invocations.length === 0) return next(e)
    const ran = await next(e)
    if (ran.deny === undefined) {
      await recordMbCall($, e.tool_use_id, invocations, ran.text ?? '', {
        isError: ran.isError === true,
        isAgent: e.agentId !== undefined,
      })
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    const invocations = findMbInvocations(e.command)
    if (invocations.length === 0) return next(e)
    const ran = await next(e)
    if (ran.deny === undefined) {
      await recordMbCall($, e.tool_use_id, invocations, ran.text ?? '', {
        isError: ran.isError === true,
        isAgent: e.agentId !== undefined,
      })
    }
    return ran
  }).catch(($, e, next) => next(e))

  // A Read of a file a search returned: the hit was used, not only listed.
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const hit = matchesHitPath(e.file_path, (await read($, callsA)).flatMap(c => c.paths))
    if (hit !== undefined) await update($, readsA, list => (list.includes(hit) ? list : [...list, hit]))
    return ran
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const answer = await next(e)
    const window = (kind: string): number | null => e.rateLimits.find(w => w.kind === kind)?.percentUsed ?? null
    const usage: Usage = {
      tokens: e.context.tokens ?? null,
      percent: e.context.percent ?? null,
      window: e.context.window,
      fiveHour: window('five_hour'),
      sevenDay: window('seven_day'),
    }
    await update($, usageA, () => usage)
    return answer
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const answer = await next(e)
    if (e.agentId !== undefined) return answer
    const index = await read($, turnA)
    const calls = (await read($, callsA)).filter(c => c.turn === index)
    const hooks = (await read($, hooksA)).filter(inj => inj.turn === index)
    const acts = (await read($, actionsA)).filter(a => a.turn === index)
    const u = e.usage
    const row: TurnRow = {
      index,
      searches: calls.length,
      searchTokens: sum(calls),
      hookTokens: sum(hooks),
      durationMs: e.durationMs,
      actions: acts.length,
      edits: acts.filter(a => a.kind === 'edit' || a.kind === 'delete').length,
      input: u?.input_tokens ?? 0,
      output: u?.output_tokens ?? 0,
      cacheRead: u?.cache_read_input_tokens ?? 0,
      cacheWrite: u?.cache_creation_input_tokens ?? 0,
    }
    await update($, turnsA, list => [...list.filter(t => t.index !== index), row].slice(-MAX_TURNS))
    const endedAt = await $.clock.now()
    await update($, lastEndA, () => endedAt)
    await refreshClaudeMd($)
    return answer
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'mem' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'close') {
      await $.ui.close({ id: MEMORY_PANE })
      return { text: 'mission-control: вкладка «Память» закрыта, счётчики снова на полосе над вводом (/mem — открыть).' }
    }
    if (arg === 'hide') {
      await update($, hiddenA, () => true)
      return { text: 'mission-control: полоса памяти скрыта (/mem show — вернуть).' }
    }
    if (arg === 'show') {
      await update($, hiddenA, () => false)
      return { text: 'mission-control: полоса памяти показана.' }
    }
    if (arg === 'quiet') {
      const isQuiet = !(await read($, quietA))
      await update($, quietA, () => isQuiet)
      return { text: `mission-control: мягкие тревоги на полосе (compaction-планы, doctor WARN) ${isQuiet ? 'скрыты' : 'показаны'}.` }
    }
    if (arg === 'reset') {
      await update($, callsA, () => [])
      await update($, readsA, () => [])
      await update($, turnsA, () => [])
      return { text: 'mission-control: счётчики поиска и ходов сброшены (инъекции хуков, CLAUDE.md, агенты и лента оставлены).' }
    }
    await refreshAlerts($)
    await refreshClaudeMd($)
    const opened = await $.ui.open({ id: MEMORY_PANE, title: MEMORY_TITLE })
    await update($, paneStatusA, () => (opened.isPlaced ? 'placed' : `not placed: ${opened.reason}`))
    return { text: opened.isPlaced ? 'mission-control: вкладка «Память» открыта.' : `mission-control: вкладка не встала: ${opened.reason}` }
  }).catch(($, e, next) => ({ text: `mission-control: /mem упала: ${reason(next.error)}` }))

  // The band: hard alerts while the Memory tab is up; without it, the one-line meter as well.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, hiddenA))) return next(e)
    const isPane = await isPaneUp($)
    const s = await memoryData($)
    const items = [...hardAlerts(s.usage, s.alerts), ...(isPane || (await read($, quietA)) ? [] : softAlerts(s.alerts))]
    if (isPane && items.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const events = byEvent(s.hooks).map(ev => `${shortEvent(ev.event)} ${fmtTokens(ev.tokens)}`).join(' · ')
    const last = s.turns.at(-1)

    return (
      <Box flexDirection="column">
        {!isPane && (
          <Text wrap="truncate-end">
            <Text dimColor>память ▸ </Text>
            <Text>хуки ≈{fmtTokens(sum(s.hooks))}</Text>
            {events.length > 0 && <Text dimColor> ({events})</Text>}
            <Text dimColor> │ </Text>
            <Text>CLAUDE.md {s.claudeMd.length > 0 ? fmtTokens(sum(s.claudeMd)) : '?'}</Text>
            <Text dimColor> │ </Text>
            <Text color={s.searches.length > 0 ? COLORS.search : COLORS.ink2}>поиск ×{s.searches.length}</Text>
            {s.searches.length > 0 && (
              <Text dimColor>
                {' '}· {s.hits} hits · best {s.best === null ? '—' : s.best.toFixed(2)} · ≈{fmtTokens(sum(s.searches))} · прочит {s.reads.length}/{s.shown}
              </Text>
            )}
            <Text dimColor> │ </Text>
            <Text>код ×{s.codeQueries}</Text>
            {last !== undefined && last.searches === 0 && <Text color={COLORS.warning}> │ ⚠ прошлый ход без поиска</Text>}
          </Text>
        )}
        {items.length > 0 && (
          <Text wrap="truncate-end">
            <Text dimColor>⚠ </Text>
            {items.map((item, i) => (
              <Text color={item.level === 'soft' ? COLORS.muted : item.level === 'error' ? COLORS.critical : COLORS.warning}>
                {i > 0 ? ' · ' : ''}
                {item.text}
              </Text>
            ))}
          </Text>
        )}
      </Box>
    )
  }).catch(($, e, next) => {
    // A drawing that throws must say so where the person looks, not leave the slot silently empty.
    const { Text } = $.ui.resolve(e)
    return (
      <Text color="error" wrap="truncate-end">
        mission-control: полоса памяти упала: {reason(next.error)}
      </Text>
    )
  })

  // The Memory tab: a dark surface filling the column, drawn by pane.tsx from the session's figures.
  on('ui.render', { component: 'Pane', requestId: MEMORY_PANE }, async ($, e) => {
    const s = await memoryData($)
    return drawMemoryPane($.ui.resolve(e), s, e.props.bodyColumns, e.props.scroll.bodyRows)
  }).catch(($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" backgroundColor={COLORS.surface} paddingX={1}>
        <Text color={COLORS.critical} bold>
          mission-control: вкладка «Память» упала
        </Text>
        <Text color={COLORS.ink2} wrap="wrap">
          {reason(next.error)}
        </Text>
      </Box>
    )
  })
}
```

- [ ] **Step 8: Write `hooks/mission/hooks.tsx` (activity feed only; Task 5 rewrites it)**

```tsx
import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { Action } from '../../types'
import { describeAction } from '../lib/actions'

const SNAPSHOT_TOOL = 'mcp__mission-control__snapshot'
const MAX_ACTIONS = 300

// The engine's scan accepts only an atom made in the same file (see memory/hooks.tsx).
const actionsA = atom({ plugin: 'mission-control', key: 'actions' } as const, [])
const turnA = atom({ plugin: 'mission-control', key: 'turn' } as const, 0)

export function registerMission(on: On): void {
  // Every tool call, in plain words: logged as it starts, settled as it ends.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool === SNAPSHOT_TOOL) return next(e)
    const startedAt = await $.clock.now()
    const id = e.tool_use_id ?? `${tool}-${startedAt}`
    const words = describeAction(tool, e as unknown as Record<string, unknown>)
    const action: Action = { id, turn: await read($, turnA), ...words, status: 'run', agentId: e.agentId ?? null, startedAt, ms: null }
    await update($, actionsA, list => [...list, action].slice(-MAX_ACTIONS))
    const ran = await next(e)
    const status: Action['status'] = ran.deny !== undefined ? 'denied' : ran.isError === true ? 'error' : 'ok'
    const ms = (await $.clock.now()) - startedAt
    await update($, actionsA, list => list.map(a => (a.id === id ? { ...a, status, ms } : a)))
    return ran
  }).catch(($, e, next) => next(e))
}
```

- [ ] **Step 9: Rewrite `hooks/register.tsx`**

```tsx
import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'

import { openMemoryPane, registerMemory } from './memory/hooks'
import { registerMission } from './mission/hooks'

const SNAPSHOT_TOOL = 'mcp__mission-control__snapshot'

// Read by the snapshot tool. Declared here because the engine's scan accepts only an
// atom made in the same file; the other files declare the same keys for themselves.
const hooksA = atom({ plugin: 'mission-control', key: 'hooks' } as const, [])
const callsA = atom({ plugin: 'mission-control', key: 'calls' } as const, [])
const readsA = atom({ plugin: 'mission-control', key: 'reads' } as const, [])
const claudeMdA = atom({ plugin: 'mission-control', key: 'claudeMd' } as const, [])
const turnsA = atom({ plugin: 'mission-control', key: 'turns' } as const, [])
const turnA = atom({ plugin: 'mission-control', key: 'turn' } as const, 0)
const usageA = atom({ plugin: 'mission-control', key: 'usage' } as const, null)
const alertsA = atom({ plugin: 'mission-control', key: 'alerts' } as const, null)
const paneStatusA = atom({ plugin: 'mission-control', key: 'paneStatus' } as const, null)
const agentsPaneStatusA = atom({ plugin: 'mission-control', key: 'agentsPaneStatus' } as const, null)
const actionsA = atom({ plugin: 'mission-control', key: 'actions' } as const, [])
const lastEndA = atom({ plugin: 'mission-control', key: 'lastTurnEndAt' } as const, null)
const agentsA = atom({ plugin: 'mission-control', key: 'agents' } as const, [])

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'snapshot',
      description:
        'mission-control state as JSON: agents (main and every subagent: phase, task, intent, current action, report), the activity feed, and the memory figures (settings-hook injections, CLAUDE.md tokens, mb search / mb code calls, turns, usage, vault alerts). Read-only.',
    })
    // After a reload a pane may be up with the old module's drawing: redraw once it is (re)opened.
    void openMemoryPane($)
      .then(() => $.ui.invalidate('ui.render'))
      .catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: SNAPSHOT_TOOL }, async $ => {
    let panes: unknown = []
    try {
      panes = await $.ui.panes()
    } catch {
      // no surface bound (a test, a headless start): the rest still answers
    }
    const state = {
      turn: await read($, turnA),
      agents: await read($, agentsA),
      actions: (await read($, actionsA)).slice(-30),
      hooks: await read($, hooksA),
      claudeMd: await read($, claudeMdA),
      calls: await read($, callsA),
      reads: await read($, readsA),
      turns: await read($, turnsA),
      usage: await read($, usageA),
      alerts: await read($, alertsA),
      paneStatus: await read($, paneStatusA),
      agentsPaneStatus: await read($, agentsPaneStatusA),
      panes,
      lastTurnEndAt: await read($, lastEndA),
    }
    return { result: JSON.stringify(state, null, 1) }
  })

  registerMission(on)
  registerMemory(on)
}
```

- [ ] **Step 10: Run the tests**

Run: `claude plugin test mission-control; echo "EXIT=$?"`
Expected: `EXIT=0`, `29 pass`. The memory test count is unchanged; the renamed test now asserts that there is no log.

- [ ] **Step 11: Run full verify**

Run: `CLAUDE_CODE_TYPES=<path> bash tools/verify.sh; echo "EXIT=$?"`
Expected: `== verify: PASS`. Validate lists hooks for `register.tsx` with state reads/writes for `mission-control.*` and no `gating hook without .catch` lines except `tool.call{tool=mcp__mission-control__snapshot}`, which answers for itself and needs none.

- [ ] **Step 12: Commit**

```bash
git add -A mission-control
git commit -m "refactor: rename mem-meter to mission-control, split into lib/memory/mission"
```

---

### Task 3: Text helpers — what an agent says it does and why

**Files:**
- Create: `mission-control/hooks/mission/model.ts` (text part)
- Test: `mission-control/tests/mission-text.test.ts`

**Interfaces:**
- Produces (from `hooks/mission/model.ts`):
  - `INTENT_MAX = 160`, `TASK_MAX = 240`, `DESCRIPTION_MAX = 120`;
  - `clip(text: string, max: number): string`;
  - `plainText(text: string): string`;
  - `sentences(text: string): string[]`;
  - `lastSentence(text: string): string | null`;
  - `firstSentence(text: string): string | null`;
  - `taskLine(prompt: string): string`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from 'claude-code/testing'

import { clip, firstSentence, lastSentence, plainText, taskLine } from '../hooks/mission/model'

describe('lastSentence', () => {
  test('takes the last sentence: what the agent does next', () => {
    expect(lastSentence('Факты собраны. Мульти-панели в доке становятся табами. Проверю, как размещаются панели.')).toBe(
      'Проверю, как размещаются панели.',
    )
  })

  test('English, and a question at the end', () => {
    expect(lastSentence('Found the parser. Now checking the regex?')).toBe('Now checking the regex?')
  })

  test('markdown marks, inline code, emphasis and links are reduced to their words', () => {
    expect(lastSentence('**Итог:** читаю `parse.ts` и [доку](https://x.y/z).')).toBe('Итог: читаю parse.ts и доку.')
    expect(lastSentence('Это *важно* сейчас.')).toBe('Это важно сейчас.')
  })

  test('a fenced code block and a table never become the reason', () => {
    const text = 'Сверяю вывод mb search с регэкспом.\n\n```ts\nconst x = 1.\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |'
    expect(lastSentence(text)).toBe('Сверяю вывод mb search с регэкспом.')
  })

  test('a line break ends a sentence; a list item is a sentence', () => {
    expect(lastSentence('План:\n- прочитать types\n- проверить test')).toBe('проверить test')
  })

  test('decimals and paths do not split a sentence', () => {
    expect(lastSentence('Лучший балл 0.68 у reference/A.md. Открываю E:/x/y.ts сейчас')).toBe('Открываю E:/x/y.ts сейчас')
  })

  test('nothing worth saying gives null', () => {
    expect(lastSentence('')).toBeNull()
    expect(lastSentence('   \n\n  ')).toBeNull()
    expect(lastSentence('```\ncode only\n```')).toBeNull()
    expect(lastSentence('---')).toBeNull()
  })

  test('a 5000-character answer gives one clipped sentence', () => {
    const out = lastSentence(`Начало. ${'слово '.repeat(1000)}конец.`) ?? ''
    expect([...out].length).toBe(160)
    expect(out.endsWith('…')).toBe(true)
    expect(out.includes('\n')).toBe(false)
  })
})

test('firstSentence takes the point a report opens with', () => {
  expect(firstSentence('Корень: регэксп не ловит отрицательные баллы. Детали ниже.\n\n## Детали\n...')).toBe(
    'Корень: регэксп не ловит отрицательные баллы.',
  )
  expect(firstSentence('')).toBeNull()
})

test('taskLine: a prompt as one line of words, code dropped, cut to 240', () => {
  expect(taskLine('## Задача\nНайди корень бага в parse.ts.\n```\nstack\n```\nОтчитайся кратко.')).toBe(
    'Задача Найди корень бага в parse.ts. Отчитайся кратко.',
  )
  expect([...taskLine('x '.repeat(500))].length).toBe(240)
})

test('plainText drops table rows and keeps the words of a heading', () => {
  expect(plainText('## Итог\n| a | b |\n|---|---|\nготово').split('\n').filter(Boolean)).toEqual(['Итог', 'готово'])
})

test('clip counts code points, so an emoji is never split', () => {
  expect(clip('ab🙂cd', 4)).toBe('ab🙂…')
  expect(clip('abc', 4)).toBe('abc')
})
```

- [ ] **Step 2: Run to see it fail**

Run: `claude plugin test mission-control; echo "EXIT=$?"`
Expected: `EXIT=1`, `tests\mission-text.test.ts: (fail) the file did not load` (module `../hooks/mission/model` missing).

- [ ] **Step 3: Write `hooks/mission/model.ts` (text part)**

```ts
// Mission control's model: pure functions from engine facts to agent rows, and the
// text helpers that say what an agent is doing and why. No `$` here: the hooks feed
// facts in, the tests call these directly.

export const INTENT_MAX = 160
export const TASK_MAX = 240
export const DESCRIPTION_MAX = 120

/** Cuts to `max` characters, counted in code points so no emoji is split; an ellipsis marks the cut. */
export function clip(text: string, max: number): string {
  const chars = [...text]
  if (chars.length <= max) return text
  return `${chars.slice(0, Math.max(1, max - 1)).join('').trimEnd()}…`
}

/** Markdown down to plain words: code blocks and table rows dropped, marks stripped, links to their text. */
export function plainText(text: string): string {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, '\n')
    .replace(/^[ \t]*\|.*\|[ \t]*$/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
    .replace(/\*\*|__|~~/g, '')
    .replace(/(^|[\s(«"])[*_]([^*_\n]+)[*_](?=[\s).,!?:;»"]|$)/gm, '$1$2')
}

/** The plain sentences of a text, in order: split after . ! ? … followed by a space, and at line breaks. */
export function sentences(text: string): string[] {
  return plainText(text)
    .split(/\n+/)
    .flatMap(line => line.split(/(?<=[.!?…])\s+/))
    .map(part => part.replace(/\s+/g, ' ').trim())
    .filter(part => /[\p{L}\p{N}]/u.test(part))
}

/** What a step's text says last: before a tool call that is what the agent does next, and why. */
export function lastSentence(text: string): string | null {
  const last = sentences(text).at(-1)
  return last === undefined ? null : clip(last, INTENT_MAX)
}

/** What a text says first: a subagent's report opens with its point. */
export function firstSentence(text: string): string | null {
  const first = sentences(text)[0]
  return first === undefined ? null : clip(first, INTENT_MAX)
}

/** A task prompt as one line of plain words from its start. */
export function taskLine(prompt: string): string {
  return clip(sentences(prompt).join(' '), TASK_MAX)
}
```

- [ ] **Step 4: Run the tests**

Run: `claude plugin test mission-control; echo "EXIT=$?"`
Expected: `EXIT=0`, all mission-text tests pass. If `decimals and paths…` fails because the lookbehind regex is unsupported, the runtime lacks lookbehind. Replace the split with `line.match(/[^.!?…]+(?:[.!?…]+(?=\s|$)|$)/g) ?? []` and run again.

- [ ] **Step 5: Commit**

```bash
git add mission-control/hooks/mission/model.ts mission-control/tests/mission-text.test.ts
git commit -m "feat(mission): text helpers for an agent's intent, task and report"
```

---

### Task 4: Agent rows — reducers, tree, limits

**Files:**
- Modify: `mission-control/hooks/mission/model.ts` (append the row part)
- Test: `mission-control/tests/mission-model.test.ts`

**Interfaces:**
- Consumes: Task 3 helpers; the `AgentRow`, `AgentPhase` and `CurrentAction` types from `types/index.d.ts`.
- Produces (from `hooks/mission/model.ts`):
  - constants `MAIN = 'main'`, `MAIN_TYPE = 'главный'`, `MAX_AGENTS = 100`, `SILENT_MS = 300_000`;
  - phase checks `isEnded(phase)`, `isWorking(phase)`;
  - `mainRow(now): AgentRow`;
  - types `SpawnFacts`, `CompleteFacts`, `ListedAgent`;
  - reducers:
    - `applyTurnStart(rows, { turn, now })`
    - `applySpawn(rows, SpawnFacts)`
    - `applyStepStart(rows, { agentId, now })`
    - `applyStepEnd(rows, { agentId, answer, now })`
    - `applyToolStart(rows, { agentId, action, now })`
    - `applyToolEnd(rows, { agentId, id, status, ms, now })`
    - `applyComplete(rows, CompleteFacts)`
    - `applyList(rows, ListedAgent[], { turn, now })`
  - `phaseFromList(status, held)`, `trimAgents(rows)`, `clearEnded(rows)`;
  - `isSilent(row, now)`, `needsTick(rows, now)`, `needsReconcile(rows)`;
  - types `TreeLine = { row, depth, lead, indent }` and `Tree = { lines, hidden }`; `buildTree(rows, turn, now): Tree`.

  Every reducer takes `readonly AgentRow[]` and returns a new `AgentRow[]`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow, CurrentAction } from '../types'
import {
  MAIN,
  MAX_AGENTS,
  SILENT_MS,
  applyComplete,
  applyList,
  applySpawn,
  applyStepEnd,
  applyStepStart,
  applyToolEnd,
  applyToolStart,
  applyTurnStart,
  buildTree,
  clearEnded,
  isSilent,
  needsReconcile,
  needsTick,
  phaseFromList,
} from '../hooks/mission/model'
import type { SpawnFacts } from '../hooks/mission/model'

const T0 = 1_000_000

function facts(over: Partial<SpawnFacts> = {}): SpawnFacts {
  return {
    agentId: 'a1',
    deny: null,
    toolUseId: 'tu1',
    parentAgentId: null,
    subagentType: 'investigator',
    description: 'корень бага в parse.ts',
    prompt: 'Найди корень бага.',
    model: 'claude-test',
    name: null,
    isBackground: false,
    isTeammate: false,
    workflowRunId: null,
    turn: 1,
    now: T0,
    ...over,
  }
}

function row(rows: readonly AgentRow[], id: string): AgentRow {
  const found = rows.find(r => r.id === id)
  if (found === undefined) throw new Error(`no row ${id}`)
  return found
}

const call = (id: string, at: number): CurrentAction => ({
  id,
  kind: 'read',
  run: 'читаю',
  done: 'прочитал',
  target: 'parse.ts',
  status: 'run',
  startedAt: at,
  ms: null,
})

describe('a subagent from spawn to report', () => {
  test('spawn → step → tool → step → complete', () => {
    let rows = applySpawn([], facts())
    expect(row(rows, MAIN).phase).toBe('idle')
    expect(row(rows, 'a1')).toMatchObject({ parentId: MAIN, phase: 'starting', task: 'Найди корень бага.', turn: 1 })
    rows = applyStepStart(rows, { agentId: 'a1', now: T0 + 1000 })
    expect(row(rows, 'a1')).toMatchObject({ phase: 'thinking', steps: 1, phaseAt: T0 + 1000 })
    rows = applyStepEnd(rows, { agentId: 'a1', answer: 'Смотрю парсер. Сверяю вывод mb search с регэкспом.', now: T0 + 2000 })
    expect(row(rows, 'a1').intent).toBe('Сверяю вывод mb search с регэкспом.')
    rows = applyToolStart(rows, { agentId: 'a1', action: call('c1', T0 + 2000), now: T0 + 2000 })
    expect(row(rows, 'a1')).toMatchObject({ phase: 'acting', tools: 1 })
    rows = applyToolEnd(rows, { agentId: 'a1', id: 'c1', status: 'ok', ms: 300, now: T0 + 2300 })
    expect(row(rows, 'a1').current).toMatchObject({ id: 'c1', status: 'ok', ms: 300 })
    rows = applyStepEnd(rows, { agentId: 'a1', answer: '', now: T0 + 2500 })
    expect(row(rows, 'a1').intent).toBe('Сверяю вывод mb search с регэкспом.')
    rows = applyComplete(rows, { agentId: 'a1', reason: 'answer', answer: 'Корень: регэксп. Детали ниже.', tokens: 1200, now: T0 + 9000 })
    expect(row(rows, 'a1')).toMatchObject({ phase: 'done', endedAt: T0 + 9000, report: 'Корень: регэксп.', tokens: 1200 })
    expect(row(rows, MAIN).phase).toBe('idle')
  })

  test('a refused spawn is a row that says why', () => {
    const rows = applySpawn([], facts({ agentId: null, deny: 'agent type coder is not allowed here', subagentType: 'coder', toolUseId: 'tu9' }))
    expect(row(rows, 'denied:tu9')).toMatchObject({ phase: 'denied', type: 'coder', report: 'agent type coder is not allowed here', endedAt: T0 })
  })

  test('a spawn with neither an id nor a deny adds nothing', () => {
    expect(applySpawn([], facts({ agentId: null })).map(r => r.id)).toEqual([MAIN])
  })

  test('a teammate idles after its turn; aborted and error end a subagent', () => {
    let rows = applySpawn([], facts({ agentId: 't1', isTeammate: true }))
    rows = applySpawn(rows, facts({ agentId: 'a2', toolUseId: 'tu2' }))
    rows = applySpawn(rows, facts({ agentId: 'a3', toolUseId: 'tu3' }))
    rows = applyComplete(rows, { agentId: 't1', reason: 'answer', answer: 'ok', tokens: 0, now: T0 })
    rows = applyComplete(rows, { agentId: 'a2', reason: 'aborted', answer: '', tokens: 0, now: T0 })
    rows = applyComplete(rows, { agentId: 'a3', reason: 'error', answer: '', tokens: 0, now: T0 })
    expect([row(rows, 't1').phase, row(rows, 'a2').phase, row(rows, 'a3').phase]).toEqual(['idle', 'aborted', 'failed'])
  })

  test('a loop no row follows is left alone (the engine’s own forks)', () => {
    let rows = applySpawn([], facts())
    rows = applyStepStart(rows, { agentId: 'compact-fork', now: T0 })
    rows = applyToolStart(rows, { agentId: 'compact-fork', action: call('c9', T0), now: T0 })
    rows = applyComplete(rows, { agentId: 'compact-fork', reason: 'answer', answer: 'x', tokens: 5, now: T0 })
    expect(rows.map(r => r.id)).toEqual([MAIN, 'a1'])
  })

  test('a second spawn under a known id resumes it; a step after its end runs it again', () => {
    let rows = applySpawn([], facts())
    rows = applyComplete(rows, { agentId: 'a1', reason: 'answer', answer: 'ok', tokens: 0, now: T0 + 10 })
    rows = applyStepStart(rows, { agentId: 'a1', now: T0 + 20 })
    expect(row(rows, 'a1')).toMatchObject({ phase: 'thinking', endedAt: null })
    rows = applySpawn(rows, facts({ now: T0 + 30 }))
    expect(rows.filter(r => r.id === 'a1').length).toBe(1)
    expect(row(rows, 'a1').phase).toBe('starting')
  })

  test('a tool end that is not the current call leaves the current one running', () => {
    let rows = applySpawn([], facts())
    rows = applyToolStart(rows, { agentId: 'a1', action: call('c1', T0), now: T0 })
    rows = applyToolStart(rows, { agentId: 'a1', action: call('c2', T0 + 1), now: T0 + 1 })
    rows = applyToolEnd(rows, { agentId: 'a1', id: 'c1', status: 'ok', ms: 5, now: T0 + 5 })
    expect(row(rows, 'a1').current).toMatchObject({ id: 'c2', status: 'run' })
  })
})

describe('main', () => {
  test('turn start: thinking, counters reset; complete: idle with what it said last', () => {
    let rows = applyTurnStart([], { turn: 3, now: T0 })
    expect(row(rows, MAIN)).toMatchObject({ phase: 'thinking', turn: 3, steps: 0, tools: 0, startedAt: T0, endedAt: null })
    rows = applyToolStart(rows, { agentId: null, action: call('c1', T0 + 10), now: T0 + 10 })
    rows = applyComplete(rows, { agentId: null, reason: 'answer', answer: 'Готово. Утверждаешь дизайн?', tokens: 10, now: T0 + 5000 })
    expect(row(rows, MAIN)).toMatchObject({ phase: 'idle', endedAt: T0 + 5000, intent: 'Утверждаешь дизайн?', tools: 1 })
    rows = applyTurnStart(rows, { turn: 4, now: T0 + 9000 })
    expect(row(rows, MAIN)).toMatchObject({ phase: 'thinking', turn: 4, tools: 0, intent: null, current: null })
  })

  test('an interrupted main turn is aborted', () => {
    const rows = applyComplete(applyTurnStart([], { turn: 1, now: T0 }), { agentId: null, reason: 'aborted', answer: '', tokens: 0, now: T0 + 1 })
    expect(row(rows, MAIN).phase).toBe('aborted')
  })
})

describe('the engine list', () => {
  test('phaseFromList maps every status, and our own end knows more than a listed end', () => {
    expect(phaseFromList('pending', 'starting')).toBe('starting')
    expect(phaseFromList('pending', 'thinking')).toBe('thinking')
    expect(phaseFromList('running', 'acting')).toBe('acting')
    expect(phaseFromList('running', 'starting')).toBe('thinking')
    expect(phaseFromList('running', 'done')).toBe('thinking')
    expect(phaseFromList('waiting', 'thinking')).toBe('waiting')
    expect(phaseFromList('idle', 'thinking')).toBe('idle')
    expect(phaseFromList('completed', 'acting')).toBe('done')
    expect(phaseFromList('failed', 'acting')).toBe('failed')
    expect(phaseFromList('killed', 'acting')).toBe('aborted')
    expect(phaseFromList('completed', 'aborted')).toBe('aborted')
    expect(phaseFromList('mystery', 'thinking')).toBe('thinking')
  })

  test('an agent we never saw is added from the list; an ended one counts as earlier', () => {
    const rows = applyList(
      [],
      [
        { id: 'x1', type: 'Explore', description: 'find callers', status: 'running', isTeammate: false },
        { id: 'x0', type: 'Plan', description: 'old plan', status: 'completed', isTeammate: false },
        { id: 'x2', type: 'Explore', description: 'nested', status: 'running', parentId: 'x1', isTeammate: false },
      ],
      { turn: 2, now: T0 },
    )
    expect(row(rows, 'x1')).toMatchObject({ phase: 'thinking', parentId: MAIN, turn: 2, task: '', description: 'find callers' })
    expect(row(rows, 'x0')).toMatchObject({ phase: 'done', turn: -1, endedAt: T0 })
    expect(row(rows, 'x2').parentId).toBe('x1')
  })

  test('a listed status changes a known row and stamps its end once', () => {
    let rows = applySpawn([], facts())
    rows = applyList(rows, [{ id: 'a1', type: 'investigator', description: 'd', status: 'completed', isTeammate: false }], { turn: 1, now: T0 + 50 })
    expect(row(rows, 'a1')).toMatchObject({ phase: 'done', endedAt: T0 + 50 })
  })
})

describe('the tree', () => {
  test('children under their parent in spawn order, with connectors', () => {
    let rows = applyTurnStart([], { turn: 1, now: T0 })
    rows = applySpawn(rows, facts({ agentId: 'a1' }))
    rows = applySpawn(rows, facts({ agentId: 'a2', toolUseId: 'tu2', subagentType: 'Explore', parentAgentId: 'a1' }))
    rows = applySpawn(rows, facts({ agentId: 'a3', toolUseId: 'tu3', subagentType: 'coder' }))
    const tree = buildTree(rows, 1, T0)
    expect(tree.lines.map(l => `${l.lead}${l.row.id}`)).toEqual(['main', '├─a1', '│ └─a2', '└─a3'])
    expect(tree.lines.map(l => l.indent)).toEqual(['  ', '│   ', '│     ', '    '])
    expect(tree.lines.map(l => l.depth)).toEqual([0, 1, 2, 1])
    expect(tree.hidden).toBe(0)
  })

  test('an orphan hangs under main; a parent cycle is cut, no row is lost', () => {
    let rows = applySpawn([], facts({ agentId: 'o1', parentAgentId: 'ghost' }))
    rows = applySpawn(rows, facts({ agentId: 'c1', toolUseId: 'tu2', parentAgentId: 'c2' }))
    rows = applySpawn(rows, facts({ agentId: 'c2', toolUseId: 'tu3', parentAgentId: 'c1' }))
    const ids = buildTree(rows, 1, T0).lines.map(l => l.row.id)
    expect(ids.sort()).toEqual(['c1', 'c2', MAIN, 'o1'].sort())
  })

  test('ended agents of earlier turns fold into hidden; working ones and their parents always show', () => {
    let rows = applyTurnStart([], { turn: 1, now: T0 })
    rows = applySpawn(rows, facts({ agentId: 'old' }))
    rows = applyComplete(rows, { agentId: 'old', reason: 'answer', answer: 'ok', tokens: 0, now: T0 })
    rows = applySpawn(rows, facts({ agentId: 'parent', toolUseId: 'tu2' }))
    rows = applySpawn(rows, facts({ agentId: 'child', toolUseId: 'tu3', parentAgentId: 'parent' }))
    rows = applyComplete(rows, { agentId: 'parent', reason: 'answer', answer: 'ok', tokens: 0, now: T0 })
    rows = applyTurnStart(rows, { turn: 2, now: T0 + 10 })
    const tree = buildTree(rows, 2, T0 + 10)
    expect(tree.lines.map(l => l.row.id)).toEqual([MAIN, 'parent', 'child'])
    expect(tree.hidden).toBe(1)
  })
})

describe('limits and timers', () => {
  test('past MAX_AGENTS the oldest ended rows leave; main and working ones stay', () => {
    let rows: AgentRow[] = []
    for (let i = 0; i < MAX_AGENTS + 5; i += 1) {
      rows = applySpawn(rows, facts({ agentId: `a${i}`, toolUseId: `tu${i}` }))
      if (i >= 2) rows = applyComplete(rows, { agentId: `a${i}`, reason: 'answer', answer: 'ok', tokens: 0, now: T0 })
    }
    expect(rows.length).toBe(MAX_AGENTS)
    expect(rows.some(r => r.id === MAIN)).toBe(true)
    expect(rows.some(r => r.id === 'a0')).toBe(true)
    expect(rows.some(r => r.id === 'a2')).toBe(false)
  })

  test('clearEnded keeps main, working and idle rows', () => {
    let rows = applySpawn([], facts({ agentId: 'w' }))
    rows = applySpawn(rows, facts({ agentId: 'd', toolUseId: 'tu2' }))
    rows = applySpawn(rows, facts({ agentId: 't', toolUseId: 'tu3', isTeammate: true }))
    rows = applyComplete(rows, { agentId: 'd', reason: 'answer', answer: 'ok', tokens: 0, now: T0 })
    rows = applyComplete(rows, { agentId: 't', reason: 'answer', answer: 'ok', tokens: 0, now: T0 })
    expect(clearEnded(rows).map(r => r.id)).toEqual([MAIN, 'w', 't'])
  })

  test('silence: a working subagent past SILENT_MS without an event; never main, never a waiting one', () => {
    let rows = applyTurnStart([], { turn: 1, now: T0 })
    rows = applySpawn(rows, facts({ agentId: 'a1' }))
    rows = applySpawn(rows, facts({ agentId: 'a2', toolUseId: 'tu2' }))
    rows = applyList(rows, [{ id: 'a2', type: 'x', description: '', status: 'waiting', isTeammate: false }], { turn: 1, now: T0 })
    const later = T0 + SILENT_MS + 1
    expect(isSilent(row(rows, 'a1'), T0 + SILENT_MS)).toBe(false)
    expect(isSilent(row(rows, 'a1'), later)).toBe(true)
    expect(isSilent(row(rows, MAIN), later)).toBe(false)
    expect(isSilent(row(rows, 'a2'), later)).toBe(false)
  })

  test('ticks run only while something works and is not silent; the list is read only for working subagents', () => {
    const idle = applySpawn([], facts({ agentId: null }))
    expect(needsTick(idle, T0)).toBe(false)
    expect(needsReconcile(idle)).toBe(false)
    const thinking = applyTurnStart([], { turn: 1, now: T0 })
    expect(needsTick(thinking, T0)).toBe(true)
    expect(needsReconcile(thinking)).toBe(false)
    const sub = applySpawn([], facts())
    expect(needsReconcile(sub)).toBe(true)
    expect(needsTick(sub, T0 + SILENT_MS + 1)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `claude plugin test mission-control; echo "EXIT=$?"`
Expected: `EXIT=1`; `mission-model.test.ts` fails to load (`MAIN` and the reducers are not exported).

- [ ] **Step 3: Append the row part to `hooks/mission/model.ts`**

Add `import type { AgentPhase, AgentRow, CurrentAction } from '../../types'` at the top of the file (above the constants). Then append:

```ts
export const MAIN = 'main'
export const MAIN_TYPE = 'главный'
/** Rows kept at most: past this the oldest ended ones leave, never main or a working one. */
export const MAX_AGENTS = 100
/** A working subagent with no event for this long is drawn as "no news". */
export const SILENT_MS = 5 * 60_000

const ENDED: ReadonlySet<AgentPhase> = new Set<AgentPhase>(['done', 'failed', 'aborted', 'denied'])
const WORKING: ReadonlySet<AgentPhase> = new Set<AgentPhase>(['starting', 'thinking', 'acting', 'waiting'])

/** done, failed, aborted or denied: nothing changes unless the agent is resumed. */
export function isEnded(phase: AgentPhase): boolean {
  return ENDED.has(phase)
}

/** starting, thinking, acting or waiting: its clock is running. */
export function isWorking(phase: AgentPhase): boolean {
  return WORKING.has(phase)
}

/** The main loop's row before it has done anything. */
export function mainRow(now: number): AgentRow {
  return {
    id: MAIN,
    parentId: null,
    turn: 0,
    type: MAIN_TYPE,
    name: null,
    description: '',
    task: '',
    model: null,
    isBackground: false,
    isTeammate: false,
    workflowRunId: null,
    phase: 'idle',
    phaseAt: now,
    startedAt: now,
    endedAt: null,
    lastEventAt: now,
    steps: 0,
    tools: 0,
    intent: null,
    current: null,
    report: null,
    tokens: 0,
    toolUseId: null,
  }
}

/** `rows` with row `id` replaced by `fn(row)`; the same rows when there is no such row. */
function patch(rows: readonly AgentRow[], id: string, fn: (row: AgentRow) => AgentRow): AgentRow[] {
  return rows.map(r => (r.id === id ? fn(r) : r))
}

/** Rows with the main row in them (it is made on first use). */
function withMain(rows: readonly AgentRow[], now: number): AgentRow[] {
  return rows.some(r => r.id === MAIN) ? [...rows] : [mainRow(now), ...rows]
}

/** The row a loop's event belongs to: main when the event names no agent. */
function loopId(agentId: string | null): string {
  return agentId ?? MAIN
}

/** At most MAX_AGENTS rows: the oldest ended ones leave first; main and working ones always stay. */
export function trimAgents(rows: readonly AgentRow[]): AgentRow[] {
  let excess = rows.length - MAX_AGENTS
  if (excess <= 0) return [...rows]
  const drop = new Set<string>()
  for (const r of rows) {
    if (excess <= 0) break
    if (r.id !== MAIN && isEnded(r.phase)) {
      drop.add(r.id)
      excess -= 1
    }
  }
  return rows.filter(r => !drop.has(r.id))
}

/** Rows without the ended agents: main and every working or idle one stay. */
export function clearEnded(rows: readonly AgentRow[]): AgentRow[] {
  return rows.filter(r => r.id === MAIN || !isEnded(r.phase))
}

/** The main loop starts a turn: it thinks, its counters, last action and reason start over. */
export function applyTurnStart(rows: readonly AgentRow[], at: { turn: number; now: number }): AgentRow[] {
  return patch(withMain(rows, at.now), MAIN, r => ({
    ...r,
    turn: at.turn,
    phase: 'thinking',
    phaseAt: at.now,
    startedAt: at.now,
    endedAt: null,
    lastEventAt: at.now,
    steps: 0,
    tools: 0,
    current: null,
    intent: null,
  }))
}

/** What an Agent call settled to, as the agent.spawn hook saw it. */
export type SpawnFacts = {
  /** The started agent's id; null when nothing started. */
  agentId: string | null
  /** The refusal's reason; null when not refused. */
  deny: string | null
  toolUseId: string
  parentAgentId: string | null
  subagentType: string
  description: string
  prompt: string
  model: string | null
  name: string | null
  isBackground: boolean
  isTeammate: boolean
  workflowRunId: string | null
  /** The main loop's turn at the spawn. */
  turn: number
  now: number
}

function newAgent(f: SpawnFacts, id: string): AgentRow {
  return {
    id,
    parentId: f.parentAgentId ?? MAIN,
    turn: f.turn,
    type: f.subagentType,
    name: f.name,
    description: clip(f.description.trim(), DESCRIPTION_MAX),
    task: taskLine(f.prompt),
    model: f.model,
    isBackground: f.isBackground,
    isTeammate: f.isTeammate,
    workflowRunId: f.workflowRunId,
    phase: 'starting',
    phaseAt: f.now,
    startedAt: f.now,
    endedAt: null,
    lastEventAt: f.now,
    steps: 0,
    tools: 0,
    intent: null,
    current: null,
    report: null,
    tokens: 0,
    toolUseId: f.toolUseId,
  }
}

/**
 * An Agent call settled: a started agent gets its row under its parent, a refused
 * one a row saying why. A spawn with neither (an internal-build remote agent) gets
 * none: nothing would ever end it.
 */
export function applySpawn(rows: readonly AgentRow[], f: SpawnFacts): AgentRow[] {
  const base = withMain(rows, f.now)
  if (f.deny !== null) {
    const id = `denied:${f.toolUseId}`
    if (base.some(r => r.id === id)) return base
    return trimAgents([...base, { ...newAgent(f, id), phase: 'denied', endedAt: f.now, report: clip(f.deny, INTENT_MAX) }])
  }
  if (f.agentId === null) return base
  if (base.some(r => r.id === f.agentId)) {
    return patch(base, f.agentId, r => ({ ...r, phase: 'starting', phaseAt: f.now, endedAt: null, lastEventAt: f.now }))
  }
  return trimAgents([...base, newAgent(f, f.agentId)])
}

/** A model request begins in a loop: it thinks. A loop no row follows (the engine's own forks) is left alone. */
export function applyStepStart(rows: readonly AgentRow[], at: { agentId: string | null; now: number }): AgentRow[] {
  const base = at.agentId === null ? withMain(rows, at.now) : [...rows]
  return patch(base, loopId(at.agentId), r => ({
    ...r,
    phase: 'thinking',
    phaseAt: at.now,
    lastEventAt: at.now,
    steps: r.steps + 1,
    endedAt: null,
  }))
}

/** A model request ended: its text's last sentence is the loop's reason for what it does next. */
export function applyStepEnd(rows: readonly AgentRow[], at: { agentId: string | null; answer: string; now: number }): AgentRow[] {
  const intent = lastSentence(at.answer)
  return patch([...rows], loopId(at.agentId), r => ({ ...r, lastEventAt: at.now, intent: intent ?? r.intent }))
}

/** A tool call begins in a loop: it acts, and the call is its current action. */
export function applyToolStart(
  rows: readonly AgentRow[],
  at: { agentId: string | null; action: CurrentAction; now: number },
): AgentRow[] {
  const base = at.agentId === null ? withMain(rows, at.now) : [...rows]
  return patch(base, loopId(at.agentId), r => ({
    ...r,
    phase: 'acting',
    phaseAt: at.now,
    lastEventAt: at.now,
    tools: r.tools + 1,
    current: at.action,
  }))
}

/** A tool call ended: its loop's current action takes the outcome, if it is still the current one. */
export function applyToolEnd(
  rows: readonly AgentRow[],
  at: { agentId: string | null; id: string; status: CurrentAction['status']; ms: number; now: number },
): AgentRow[] {
  return patch([...rows], loopId(at.agentId), r => ({
    ...r,
    lastEventAt: at.now,
    current: r.current !== null && r.current.id === at.id ? { ...r.current, status: at.status, ms: at.ms } : r.current,
  }))
}

/** What turn.complete said about a loop's turn. */
export type CompleteFacts = {
  agentId: string | null
  reason: 'answer' | 'aborted' | 'refusal' | 'error'
  answer: string
  tokens: number
  now: number
}

/** A loop's turn ended: main waits for the person, a subagent is done (a teammate idles), failed or stopped. */
export function applyComplete(rows: readonly AgentRow[], f: CompleteFacts): AgentRow[] {
  const base = f.agentId === null ? withMain(rows, f.now) : [...rows]
  return patch(base, loopId(f.agentId), r => {
    const isMain = r.id === MAIN
    const phase: AgentPhase =
      f.reason === 'aborted' ? 'aborted' : f.reason === 'answer' ? (isMain || r.isTeammate ? 'idle' : 'done') : 'failed'
    return {
      ...r,
      phase,
      phaseAt: f.now,
      endedAt: f.now,
      lastEventAt: f.now,
      tokens: r.tokens + f.tokens,
      intent: isMain ? (lastSentence(f.answer) ?? r.intent) : r.intent,
      report: isMain ? r.report : (firstSentence(f.answer) ?? r.report),
    }
  })
}

/** One row of $.agent.list(), reduced to what the rows use. */
export type ListedAgent = {
  id: string
  type: string
  description: string
  status: string
  parentId?: string
  name?: string
  isTeammate: boolean
}

const FROM_STATUS: Record<string, AgentPhase> = {
  pending: 'starting',
  waiting: 'waiting',
  idle: 'idle',
  completed: 'done',
  failed: 'failed',
  killed: 'aborted',
}

/** The phase a listed status means, given what we hold: running keeps our finer phase, our own end knows more. */
export function phaseFromList(status: string, held: AgentPhase): AgentPhase {
  if (status === 'running') return held === 'thinking' || held === 'acting' ? held : 'thinking'
  const listed = FROM_STATUS[status]
  if (listed === undefined) return held
  if (listed === 'starting' && isWorking(held)) return held
  if (isEnded(listed) && isEnded(held)) return held
  return listed
}

function listedRow(item: ListedAgent, turn: number, now: number): AgentRow {
  const phase = phaseFromList(item.status, 'starting')
  const ended = isEnded(phase)
  return {
    ...mainRow(now),
    id: item.id,
    parentId: item.parentId ?? MAIN,
    turn: ended ? -1 : turn,
    type: item.type,
    name: item.name ?? null,
    description: clip(item.description.trim(), DESCRIPTION_MAX),
    isTeammate: item.isTeammate,
    phase,
    endedAt: ended ? now : null,
  }
}

/** Squares the rows with the engine's list: its status wins where ours is stale, and agents we never saw are added. */
export function applyList(rows: readonly AgentRow[], listed: readonly ListedAgent[], at: { turn: number; now: number }): AgentRow[] {
  let next = withMain(rows, at.now)
  for (const item of listed) {
    const known = next.find(r => r.id === item.id)
    if (known === undefined) {
      next = [...next, listedRow(item, at.turn, at.now)]
      continue
    }
    const phase = phaseFromList(item.status, known.phase)
    if (phase === known.phase) continue
    next = patch(next, item.id, r => ({ ...r, phase, phaseAt: at.now, endedAt: isEnded(phase) ? (r.endedAt ?? at.now) : null }))
  }
  return trimAgents(next)
}

/** A working subagent that sent nothing for SILENT_MS: drawn as "no news". Never main, never one that waits. */
export function isSilent(r: AgentRow, now: number): boolean {
  return r.id !== MAIN && r.phase !== 'waiting' && isWorking(r.phase) && now - r.lastEventAt > SILENT_MS
}

/** Is a timer on screen running? Working rows that are not silent. */
export function needsTick(rows: readonly AgentRow[], now: number): boolean {
  return rows.some(r => isWorking(r.phase) && !isSilent(r, now))
}

/** Is the engine's list worth reading? Only while a subagent works. */
export function needsReconcile(rows: readonly AgentRow[]): boolean {
  return rows.some(r => r.id !== MAIN && isWorking(r.phase))
}

/** One drawn agent: `lead` goes before its own line, `indent` before its detail lines. */
export type TreeLine = { row: AgentRow; depth: number; lead: string; indent: string }
export type Tree = { lines: TreeLine[]; hidden: number }

/**
 * The rows as a tree under main, in spawn order. Shown: main, every agent not
 * ended, every agent of `turn`, and the ancestors of those; the rest (ended in
 * earlier turns) is counted in `hidden`. An unknown parent or a parent cycle
 * hangs the row under main, so no row is ever lost.
 */
export function buildTree(rows: readonly AgentRow[], turn: number, now: number): Tree {
  const main = rows.find(r => r.id === MAIN) ?? mainRow(now)
  const others = rows.filter(r => r.id !== MAIN)
  const byId = new Map(others.map(r => [r.id, r]))
  const parent = new Map<string, string>()
  for (const r of others) {
    parent.set(r.id, r.parentId !== null && r.parentId !== r.id && byId.has(r.parentId) ? r.parentId : MAIN)
  }
  for (const r of others) {
    const seen = new Set<string>()
    let cur = r.id
    while (cur !== MAIN) {
      if (seen.has(cur)) {
        parent.set(cur, MAIN)
        break
      }
      seen.add(cur)
      cur = parent.get(cur) ?? MAIN
    }
  }
  const keep = new Set<string>()
  for (const r of others) {
    if (isEnded(r.phase) && r.turn !== turn) continue
    let cur: string = r.id
    while (cur !== MAIN && !keep.has(cur)) {
      keep.add(cur)
      cur = parent.get(cur) ?? MAIN
    }
  }
  const children = new Map<string, AgentRow[]>()
  for (const r of others) {
    if (!keep.has(r.id)) continue
    const p = parent.get(r.id) ?? MAIN
    children.set(p, [...(children.get(p) ?? []), r])
  }
  const lines: TreeLine[] = [{ row: main, depth: 0, lead: '', indent: '  ' }]
  const walk = (of: string, pad: string, depth: number): void => {
    const kids = children.get(of) ?? []
    kids.forEach((kid, i) => {
      const isLast = i === kids.length - 1
      const stem = isLast ? '  ' : '│ '
      lines.push({ row: kid, depth, lead: `${pad}${isLast ? '└─' : '├─'}`, indent: `${pad}${stem}  ` })
      walk(kid.id, `${pad}${stem}`, depth + 1)
    })
  }
  walk(MAIN, '', 1)
  return { lines, hidden: others.length - keep.size }
}
```

- [ ] **Step 4: Run the tests**

Run: `claude plugin test mission-control; echo "EXIT=$?"`
Expected: `EXIT=0`, all mission-model tests pass.

- [ ] **Step 5: Commit**

```bash
git add mission-control/hooks/mission/model.ts mission-control/tests/mission-model.test.ts
git commit -m "feat(mission): agent rows, tree and limits as pure reducers"
```

---

### Task 5: Event wiring — the engine's events become agent rows

**Files:**
- Rewrite: `mission-control/hooks/mission/hooks.tsx`
- Create: `mission-control/tests/helpers.ts`
- Test: `mission-control/tests/mission-events.test.ts`

**Interfaces:**
- Consumes:
  - the Task 4 reducers;
  - `describeAction(tool, input): { kind, run, done, target }` from `lib/actions`.
- Produces:
  - `registerMission(on: On): void`, `openAgentsPane($: EngineInterface): Promise<void>`, `AGENTS_PANE = 'agents'`;
  - test helpers `engineBeneath(on, opts?)`, `spawn($, args)`, `step($, agentId?)`, `complete($, args)`, `toolCall($, args, agentId?)`, `snapshot($)`, `mountAgents($, surface, opts?)`.

  `engineBeneath` returns `{ clock, say(text), list(rows) }`.

- [ ] **Step 1: Write `tests/helpers.ts`**

```ts
// Test helpers: the engine beneath the plugin, the events mission control hooks, and
// the two ways to look at the result — the plugin's own snapshot tool (exact state;
// a test's `$` has no state noun) and a mounted Agents tab (what the person sees).
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { Action, AgentRow } from '../types'

export const PLUGIN = 'mission-control'
const SNAPSHOT_TOOL = 'mcp__mission-control__snapshot'
export const T0 = 1_000_000

export type Snapshot = { turn: number; agents: AgentRow[]; actions: Action[]; agentsPaneStatus: string | null }

type SpawnAnswer = string | { deny: string }

/**
 * Answers, beneath the plugin, every event mission control raises or hooks, as a
 * session would. `say` queues the text the next model step streams; `list` sets what
 * $.agent.list() returns; spawns take ids from `spawns` in order.
 */
export function engineBeneath(on: On, opts: { spawns?: SpawnAnswer[] } = {}) {
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, {})
  // What session.start calls: the kit has no bottom for these.
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__mission-control__${e.name}` } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.close', () => ({ value: undefined }))
  const spawns: SpawnAnswer[] = [...(opts.spawns ?? ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'])]
  const texts: string[] = []
  let listed: unknown[] = []
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer, usage: e.usage }))
  on('agent.spawn', () => {
    const next = spawns.shift() ?? 'a-extra'
    return typeof next === 'string' ? { model: 'claude-test', agentId: next } : { deny: next.deny }
  })
  on('agent.list', () => ({ value: listed }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.step', async function* (_$, e) {
    const text = texts.shift() ?? ''
    if (text.length > 0) yield { kind: 'text' as const, index: 0, text }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage: null }
    return { turnId: e.turnId, index: e.index, answer: text, toolUses: [] }
  })
  on('tool.call', { tool: 'Glob' }, () => ({ result: { filenames: [], durationMs: 1, numFiles: 0, truncated: false }, text: '' }))
  on('tool.call', { tool: 'Read' }, () => ({
    result: { type: 'text', file: { filePath: 'x', content: 'x', numLines: 1, startLine: 1, totalLines: 1 } },
    text: 'x',
  }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'boom', stderr: '', interrupted: false }, text: 'boom', isError: true }))
  return {
    clock,
    say: (text: string): void => {
      texts.push(text)
    },
    list: (rows: unknown[]): void => {
      listed = rows
    },
  }
}

let seq = 0

export async function spawn(
  $: Engine,
  args: { subagentType: string; description: string; prompt?: string; parentAgentId?: string; name?: string },
) {
  seq += 1
  return $.agent.spawn({
    tool_use_id: `tu-${seq}`,
    prompt: args.prompt ?? `Задача: ${args.description}.`,
    description: args.description,
    subagentType: args.subagentType,
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-test',
    background: false,
    fork: false,
    ...(args.parentAgentId === undefined ? {} : { parentAgentId: args.parentAgentId }),
    ...(args.name === undefined ? {} : { name: args.name }),
  })
}

/** One model step in a loop; the plugin sees its end once the stream is read through. */
export async function step($: Engine, agentId?: string): Promise<void> {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-test', messageCount: 1, ...(agentId === undefined ? {} : { agentId }) })
  for await (const _chunk of stream) {
    // drain
  }
}

export async function complete($: Engine, args: { agentId?: string; answer: string; reason?: 'answer' | 'aborted' | 'error' }): Promise<void> {
  await $.turn.complete({
    answer: args.answer,
    durationMs: 1000,
    isAborted: args.reason === 'aborted',
    turnId: 't',
    reason: args.reason ?? 'answer',
    usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 0, model: 'claude-test' },
    ...(args.agentId === undefined ? {} : { agentId: args.agentId }),
  })
}

/** A tool call in a loop. The kit keeps `agentId` though ToolCallArgs' comment says it is dropped (probe 2026-10-11). */
export async function toolCall($: Engine, args: Record<string, unknown> & { tool: string }, agentId?: string): Promise<void> {
  await $.tool.call({ ...args, ...(agentId === undefined ? {} : { agentId }) } as never)
}

export async function snapshot($: Engine): Promise<Snapshot> {
  const answer = (await $.tool.call({ tool: SNAPSHOT_TOOL } as never)) as unknown as { result?: unknown }
  return JSON.parse(String(answer.result)) as Snapshot
}

export async function mountAgents(
  $: Engine,
  surface: 'terminal' | 'desktop',
  opts: { cols?: number; rows?: number; viewAgentId?: string } = {},
) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: 'agents',
    props: {
      title: 'Агенты',
      isFocused: false,
      bodyColumns: opts.cols ?? 64,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: opts.rows ?? 60 },
      view: opts.viewAgentId === undefined ? {} : { agentId: opts.viewAgentId },
    },
  })
}
```

- [ ] **Step 2: Write the failing event tests `tests/mission-events.test.ts`**

```ts
import { expect, test } from 'claude-code/testing'

import { MAIN } from '../hooks/mission/model'
import { complete, engineBeneath, snapshot, spawn, step, toolCall } from './helpers'

test('a subagent’s life reaches the rows through the engine’s events', async ($, on) => {
  const engine = engineBeneath(on)
  await $.prompt.submit({ text: 'найди баг' })
  await $.turn.start({ text: 'найди баг', turnId: 't1' })
  const spawned = await spawn($, {
    subagentType: 'investigator',
    description: 'корень бага в parse.ts',
    prompt: 'Найди корень бага в parse.ts. Отчитайся.',
  })
  expect(spawned.agentId).toBe('a1')
  engine.say('Смотрю парсер. Сверяю вывод mb search с регэкспом.')
  await step($, 'a1')
  await toolCall($, { tool: 'Glob', pattern: '*.ts' }, 'a1')
  await complete($, { agentId: 'a1', answer: 'Корень: регэксп не ловит минус. Детали ниже.' })

  const s = await snapshot($)
  const a1 = s.agents.find(r => r.id === 'a1')
  expect(a1).toMatchObject({
    type: 'investigator',
    parentId: MAIN,
    turn: 1,
    phase: 'done',
    steps: 1,
    tools: 1,
    intent: 'Сверяю вывод mb search с регэкспом.',
    report: 'Корень: регэксп не ловит минус.',
    task: 'Найди корень бага в parse.ts. Отчитайся.',
    tokens: 330,
  })
  expect(a1?.current).toMatchObject({ done: 'нашёл файлы', target: '*.ts', status: 'ok' })
  expect(s.actions.at(-1)).toMatchObject({ agentId: 'a1', done: 'нашёл файлы', status: 'ok' })
  expect(s.agents.find(r => r.id === MAIN)).toMatchObject({ phase: 'thinking', turn: 1 })
})

test('main: a turn thinks, a tool makes it act with the reason it gave, the end leaves it waiting', async ($, on) => {
  const engine = engineBeneath(on)
  await $.prompt.submit({ text: 'go' })
  await $.turn.start({ text: 'go', turnId: 't1' })
  engine.say('Проверю типы. Читаю claude-code.d.ts.')
  await step($)
  await toolCall($, { tool: 'Read', file_path: 'C:/x/claude-code.d.ts' })
  let main = (await snapshot($)).agents.find(r => r.id === MAIN)
  expect(main).toMatchObject({ phase: 'acting', steps: 1, tools: 1, intent: 'Читаю claude-code.d.ts.' })
  expect(main?.current).toMatchObject({ done: 'прочитал', target: 'claude-code.d.ts', status: 'ok' })
  await complete($, { answer: 'Готово. Утверждаешь?' })
  main = (await snapshot($)).agents.find(r => r.id === MAIN)
  expect(main).toMatchObject({ phase: 'idle', intent: 'Утверждаешь?' })
})

test('a refused spawn, a nested spawn and the engine list', async ($, on) => {
  const engine = engineBeneath(on, { spawns: ['a1', { deny: 'coder is not allowed here' }, 'a2'] })
  await $.prompt.submit({ text: 'go' })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await spawn($, { subagentType: 'investigator', description: 'корень' })
  await spawn($, { subagentType: 'coder', description: 'правка' })
  await spawn($, { subagentType: 'Explore', description: 'поиск вызовов', parentAgentId: 'a1' })
  let s = await snapshot($)
  expect(s.agents.find(r => r.type === 'coder')).toMatchObject({ phase: 'denied', report: 'coder is not allowed here' })
  expect(s.agents.find(r => r.id === 'a2')).toMatchObject({ parentId: 'a1', phase: 'starting' })

  // session.start registers the timers (the kit's mock clock answers $.clock.every). Then the
  // list changes, and the 2 s reconcile — not the start's one-off read — must pick it up.
  await $.session.start({ cwd: 'E:/Project/singularity-mods', surface: 'terminal', isInteractive: true })
  engine.list([
    { id: 'a1', type: 'investigator', description: 'корень', status: 'completed' },
    { id: 'x9', type: 'Plan', description: 'план до загрузки мода', status: 'running' },
  ])
  s = await snapshot($)
  expect(s.agents.find(r => r.id === 'x9')).toBeUndefined()
  await engine.clock.advance(2000)
  s = await snapshot($)
  expect(s.agents.find(r => r.id === 'a1')?.phase).toBe('done')
  expect(s.agents.find(r => r.id === 'x9')).toMatchObject({ type: 'Plan', phase: 'thinking', description: 'план до загрузки мода' })
  // expect(s.agentsPaneStatus).toBe('placed') // Task 6
})

test('a failing tool is recorded as an error and its result passes through unchanged', async ($, on) => {
  engineBeneath(on)
  const ran = (await $.tool.call({ tool: 'Bash', command: 'false' } as never)) as unknown as { text?: string; isError?: boolean }
  expect(ran).toMatchObject({ text: 'boom', isError: true })
  const s = await snapshot($)
  expect(s.actions.at(-1)).toMatchObject({ status: 'error', agentId: null })
  expect(s.agents.find(r => r.id === MAIN)?.current).toMatchObject({ status: 'error' })
})
```

About the list test:
- The kit has a bottom only for `$.state` and `session.append`. That is why `engineBeneath` answers `command.register`, `tool.register`, `ui.invalidate`, `ui.close` and `$.env` itself. Without those answers, `session.start` would reject before it registers the timers.
- `agentsPaneStatus === 'placed'` proves that `register.tsx`'s `session.start` opened the Agents tab. This line only passes after Task 6 Step 4, so add it in Task 6, not here; in this task leave it commented out with `// Task 6`.

- [ ] **Step 3: Run to see it fail**

Run: `claude plugin test mission-control; echo "EXIT=$?"`
Expected: `EXIT=1`; `mission-events` fails on `expect(spawned.agentId)…` or on the snapshot: `agents` stays `[]` or holds only main, since nothing writes agent rows yet.

- [ ] **Step 4: Rewrite `hooks/mission/hooks.tsx`**

```tsx
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, TurnStepResult } from 'claude-code'

import type { Action, CurrentAction } from '../../types'
import { describeAction } from '../lib/actions'
import { COLORS } from '../lib/viz'
import {
  applyComplete,
  applyList,
  applySpawn,
  applyStepEnd,
  applyStepStart,
  applyToolEnd,
  applyToolStart,
  applyTurnStart,
  clearEnded,
  needsReconcile,
  needsTick,
} from './model'
import type { ListedAgent } from './model'
import { drawAgentsPane } from './pane'

export const AGENTS_PANE = 'agents'
const AGENTS_TITLE = 'Агенты'
const SNAPSHOT_TOOL = 'mcp__mission-control__snapshot'
const MAX_ACTIONS = 300
/** Timers on screen are redrawn once a second, and only while something works. */
const TICK_MS = 1000
/** The engine's own agent list is read every 2 s, and only while a subagent works. */
const LIST_MS = 2000

// The engine's scan accepts only an atom made in the same file: every file declares
// the values it reads or writes, with the same key and initial value as the others.
const agentsA = atom({ plugin: 'mission-control', key: 'agents' } as const, [])
const actionsA = atom({ plugin: 'mission-control', key: 'actions' } as const, [])
const turnA = atom({ plugin: 'mission-control', key: 'turn' } as const, 0)
const agentsPaneStatusA = atom({ plugin: 'mission-control', key: 'agentsPaneStatus' } as const, null)

type $ = EngineInterface

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Opens the Agents tab unless it is open; records what the engine answered, so a tab that never shows can be explained. */
export async function openAgentsPane($: $): Promise<void> {
  try {
    if ((await $.ui.panes()).some(p => p.id === AGENTS_PANE)) {
      await update($, agentsPaneStatusA, () => 'already open')
      return
    }
    const opened = await $.ui.open({ id: AGENTS_PANE, title: AGENTS_TITLE })
    await update($, agentsPaneStatusA, () => (opened.isPlaced ? 'placed' : `not placed: ${opened.reason}`))
  } catch (err) {
    await update($, agentsPaneStatusA, () => `open failed: ${reason(err)}`)
  }
}

/** Redraws while something works, so its timers stay true; does nothing when all is quiet. */
async function tick($: $): Promise<void> {
  try {
    if (needsTick(await read($, agentsA), await $.clock.now())) $.ui.invalidate('ui.render')
  } catch {
    // a missed redraw is drawn by the next tick
  }
}

/** Squares the rows with $.agent.list(); `always` reads it even when nothing works (a load, a reload). */
async function reconcile($: $, always: boolean): Promise<void> {
  try {
    if (!always && !needsReconcile(await read($, agentsA))) return
    const listed: ListedAgent[] = (await $.agent.list()).map(a => ({
      id: a.id,
      type: a.type,
      description: a.description,
      status: a.status,
      ...(a.parentId === undefined ? {} : { parentId: a.parentId }),
      ...(a.name === undefined ? {} : { name: a.name }),
      isTeammate: a.teammateId !== undefined,
    }))
    const turn = await read($, turnA)
    const now = await $.clock.now()
    await update($, agentsA, rows => applyList(rows, listed, { turn, now }))
  } catch {
    // no session bound yet, or a host without agents: the events still keep the rows
  }
}

export function registerMission(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mc',
      description: 'Mission control: кто из агентов чем занят и почему; /mc close|clear',
      argumentHint: '[close|clear]',
    })
    $.clock.every(TICK_MS, () => void tick($))
    $.clock.every(LIST_MS, () => void reconcile($, false))
    // A reload (or the mod set up mid-session) finds agents already at work: learn them now.
    void reconcile($, true)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const res = await next(e)
    const turn = await read($, turnA)
    const now = await $.clock.now()
    await update($, agentsA, rows => applyTurnStart(rows, { turn, now }))
    return res
  }).catch(($, e, next) => next(e))

  // One model request: the loop thinks while it streams; its text's last sentence is the reason.
  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId ?? null
    try {
      const now = await $.clock.now()
      await update($, agentsA, rows => applyStepStart(rows, { agentId, now }))
    } catch {
      // the step goes on unobserved
    }
    const res = yield* next(e)
    try {
      // `res` is undefined when nothing streamed beneath (seen in the test kit): read it defensively.
      const answer = (res as TurnStepResult | undefined)?.answer ?? ''
      if (answer.length > 0) {
        const now = await $.clock.now()
        await update($, agentsA, rows => applyStepEnd(rows, { agentId, answer, now }))
      }
    } catch {
      // never let the observer fail the model's stream
    }
    return res
  })

  // Every tool call, in plain words: the feed, and the calling loop's current action.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool === SNAPSHOT_TOOL) return next(e)
    const agentId = e.agentId ?? null
    const startedAt = await $.clock.now()
    const id = e.tool_use_id ?? `${tool}-${startedAt}`
    const words = describeAction(tool, e as unknown as Record<string, unknown>)
    const action: Action = { id, turn: await read($, turnA), ...words, status: 'run', agentId, startedAt, ms: null }
    const current: CurrentAction = { id, ...words, status: 'run', startedAt, ms: null }
    await update($, actionsA, list => [...list, action].slice(-MAX_ACTIONS))
    await update($, agentsA, rows => applyToolStart(rows, { agentId, action: current, now: startedAt }))
    const ran = await next(e)
    const status: Action['status'] = ran.deny !== undefined ? 'denied' : ran.isError === true ? 'error' : 'ok'
    const endedAt = await $.clock.now()
    const ms = endedAt - startedAt
    await update($, actionsA, list => list.map(a => (a.id === id ? { ...a, status, ms } : a)))
    await update($, agentsA, rows => applyToolEnd(rows, { agentId, id, status, ms, now: endedAt }))
    return ran
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const res = await next(e)
    const now = await $.clock.now()
    const turn = await read($, turnA)
    await update($, agentsA, rows =>
      applySpawn(rows, {
        agentId: res.agentId ?? null,
        deny: res.deny ?? null,
        toolUseId: e.tool_use_id,
        parentAgentId: e.parentAgentId ?? null,
        subagentType: e.subagentType,
        description: e.description,
        prompt: e.prompt,
        model: res.model ?? e.model ?? null,
        name: e.name ?? null,
        isBackground: e.background,
        isTeammate: e.isTeammate === true,
        workflowRunId: e.workflow?.runId ?? null,
        turn,
        now,
      }),
    )
    return res
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    const now = await $.clock.now()
    const u = e.usage
    const tokens =
      u === undefined ? 0 : (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
    await update($, agentsA, rows => applyComplete(rows, { agentId: e.agentId ?? null, reason: e.reason, answer: e.answer, tokens, now }))
    return res
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'mc' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'close') {
      await $.ui.close({ id: AGENTS_PANE })
      return { text: 'mission-control: вкладка «Агенты» закрыта (/mc — открыть).' }
    }
    if (arg === 'clear') {
      const turn = await read($, turnA)
      await update($, agentsA, rows => clearEnded(rows))
      await update($, actionsA, list => list.filter(a => a.turn === turn))
      return { text: 'mission-control: завершённые агенты и лента прошлых ходов убраны.' }
    }
    if (arg.length > 0) return { text: `mission-control: не знаю «${arg}». /mc — открыть вкладку, /mc close, /mc clear.` }
    const opened = await $.ui.open({ id: AGENTS_PANE, title: AGENTS_TITLE })
    await update($, agentsPaneStatusA, () => (opened.isPlaced ? 'placed' : `not placed: ${opened.reason}`))
    return { text: opened.isPlaced ? 'mission-control: вкладка «Агенты» открыта.' : `mission-control: вкладка не встала: ${opened.reason}` }
  }).catch(($, e, next) => ({ text: `mission-control: /mc упала: ${reason(next.error)}` }))

  // The Agents tab: drawn by pane.tsx from the rows and the feed.
  on('ui.render', { component: 'Pane', requestId: AGENTS_PANE }, async ($, e) => {
    const data = {
      agents: await read($, agentsA),
      actions: await read($, actionsA),
      turn: await read($, turnA),
      now: await $.clock.now(),
      viewAgentId: e.props.view.agentId ?? null,
    }
    return drawAgentsPane($.ui.resolve(e), data, e.props.bodyColumns, e.props.scroll.bodyRows)
  }).catch(($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" backgroundColor={COLORS.surface} paddingX={1}>
        <Text color={COLORS.critical} bold>
          mission-control: вкладка «Агенты» упала
        </Text>
        <Text color={COLORS.ink2} wrap="wrap">
          {reason(next.error)}
        </Text>
      </Box>
    )
  })
}
```

This file imports `drawAgentsPane` from `./pane`, which Task 6 writes. So that this task runs on its own, create `hooks/mission/pane.tsx` now with a minimal body that Task 6 replaces:
```tsx
import type { ElementTable } from 'claude-code'

import type { Action, AgentRow } from '../../types'

export type AgentsPaneData = {
  agents: readonly AgentRow[]
  actions: readonly Action[]
  turn: number
  now: number
  viewAgentId: string | null
}

export function drawAgentsPane(table: ElementTable, d: AgentsPaneData, cols: number, rows: number) {
  const { Text } = table
  return <Text>агентов: {d.agents.length} ({cols}×{rows})</Text>
}
```

- [ ] **Step 5: Run the tests**

Run: `claude plugin test mission-control; echo "EXIT=$?"`
Expected: `EXIT=0`, the four mission-events tests pass and the earlier suites stay green.

- [ ] **Step 6: Commit**

```bash
git add mission-control/hooks/mission mission-control/tests/helpers.ts mission-control/tests/mission-events.test.ts
git commit -m "feat(mission): wire agent.spawn, turn.start/step/complete, tool.call and the agent list into rows"
```

---

### Task 6: The Agents tab — tree, reasons, feed, `/mc`, tab order

**Files:**
- Rewrite: `mission-control/hooks/mission/pane.tsx`
- Modify: `mission-control/hooks/register.tsx` (session.start opens Agents first)
- Test: `mission-control/tests/mission-pane.test.ts`

**Interfaces:**
- Consumes: `buildTree`, `isEnded`, `isWorking`, `isSilent`, `MAIN` (Task 4); `COLORS`, `fmtDur`, `plural`, `rule` (`lib/viz`); `fmtTokens` (`lib/parse`).
- Produces:
  - `drawAgentsPane(table: ElementTable, d: AgentsPaneData, cols: number, rows: number)`;
  - `agentName(row: AgentRow): string`;
  - `AgentsPaneData = { agents, actions, turn, now, viewAgentId }`.

- [ ] **Step 1: Write the failing pane tests `tests/mission-pane.test.ts`**

```ts
import { expect, test } from 'claude-code/testing'

import { complete, engineBeneath, mountAgents, spawn, step, toolCall } from './helpers'

const SURFACES = ['terminal', 'desktop'] as const

test('a working subagent shows its task, its reason and what it does now, on every surface', async ($, on) => {
  const engine = engineBeneath(on)
  await $.prompt.submit({ text: 'go' })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await spawn($, { subagentType: 'investigator', description: 'корень бага в parse.ts' })
  engine.say('Смотрю парсер. Сверяю вывод mb search с регэкспом.')
  await step($, 'a1')
  await toolCall($, { tool: 'Glob', pattern: '*.ts' }, 'a1')
  for (const surface of SURFACES) {
    const ui = await mountAgents($, surface)
    expect(await ui.find({ text: /◌ главный · ход 1/ })).toBeDefined()
    expect(await ui.find({ text: /└─● investigator · 0с · 1 шаг/ })).toBeDefined()
    expect(await ui.find({ text: /задача: корень бага в parse\.ts/ })).toBeDefined()
    expect(await ui.find({ text: /зачем: «Сверяю вывод mb search с регэкспом\.»/ })).toBeDefined()
    expect(await ui.find({ text: /✓ нашёл файлы \*\.ts/ })).toBeDefined()
    expect(await ui.find({ text: /↳investigator\s+✓ нашёл файлы \*\.ts/ })).toBeDefined()
    await ui.unmount()
  }
})

test('main thinking shows its time; ended, refused and nested agents read at a glance', async ($, on) => {
  const engine = engineBeneath(on, { spawns: ['a1', { deny: 'coder is not allowed here' }, 'a2'] })
  await $.prompt.submit({ text: 'go' })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await spawn($, { subagentType: 'investigator', description: 'корень' })
  await spawn($, { subagentType: 'coder', description: 'правка' })
  await spawn($, { subagentType: 'Explore', description: 'вызовы', parentAgentId: 'a1' })
  await complete($, { agentId: 'a1', answer: 'Корень: регэксп. Детали ниже.' })
  await engine.clock.advance(12_000)
  for (const surface of SURFACES) {
    const ui = await mountAgents($, surface)
    expect(await ui.find({ text: /◌ главный · ход 1 · 12с/ })).toBeDefined()
    expect(await ui.find({ text: /думает 12с/ })).toBeDefined()
    // Ended at the clock's start: 0 s, its tokens, then the report's first sentence.
    expect(await ui.find({ text: /✓ investigator · 0с · 330 ток\. — Корень: регэксп\./ })).toBeDefined()
    expect(await ui.find({ text: /⊘ coder · отклонён — coder is not allowed here/ })).toBeDefined()
    expect(await ui.find({ text: /│ └─◌ Explore/ })).toBeDefined()
    await ui.unmount()
  }
})

test('main idle waits for the person and says what it answered', async ($, on) => {
  const engine = engineBeneath(on)
  await $.prompt.submit({ text: 'go' })
  await $.turn.start({ text: 'go', turnId: 't1' })
  engine.say('Готово. Утверждаешь дизайн?')
  await step($)
  await complete($, { answer: 'Готово. Утверждаешь дизайн?' })
  await engine.clock.advance(65_000)
  const ui = await mountAgents($, 'terminal')
  expect(await ui.find({ text: /○ главный · ход 1 · ждёт тебя · 1м05с/ })).toBeDefined()
  expect(await ui.find({ text: /итог: «Утверждаешь дизайн\?»/ })).toBeDefined()
  await ui.unmount()
})

test('the agent whose transcript is open is marked ▶', async ($, on) => {
  engineBeneath(on)
  await spawn($, { subagentType: 'investigator', description: 'корень' })
  const ui = await mountAgents($, 'terminal', { viewAgentId: 'a1' })
  expect(await ui.find({ text: /▶◌ investigator/ })).toBeDefined()
  await ui.unmount()
})

test('a silent subagent reads "no news" after five minutes', async ($, on) => {
  const engine = engineBeneath(on)
  await spawn($, { subagentType: 'investigator', description: 'корень' })
  await step($, 'a1')
  await engine.clock.advance(6 * 60_000)
  const ui = await mountAgents($, 'terminal')
  expect(await ui.find({ text: /\? investigator · 6м00с · 1 шаг · нет вестей 6м00с/ })).toBeDefined()
  await ui.unmount()
})

test('ended agents of earlier turns fold into one line', async ($, on) => {
  engineBeneath(on)
  await $.prompt.submit({ text: 'one' })
  await $.turn.start({ text: 'one', turnId: 't1' })
  await spawn($, { subagentType: 'Explore', description: 'старое' })
  await complete($, { agentId: 'a1', answer: 'ok' })
  await $.prompt.submit({ text: 'two' })
  await $.turn.start({ text: 'two', turnId: 't2' })
  const ui = await mountAgents($, 'terminal')
  expect(await ui.find({ text: /… ещё 1 завершённый раньше/ })).toBeDefined()
  expect(await ui.find({ text: /Explore · / })).toBeUndefined()
  await ui.unmount()
})

test('an unknown loop’s call is labelled ↳фон in the feed', async ($, on) => {
  engineBeneath(on)
  await toolCall($, { tool: 'Glob', pattern: '*.md' }, 'compact-fork')
  const ui = await mountAgents($, 'terminal')
  expect(await ui.find({ text: /↳фон\s+✓ нашёл файлы \*\.md/ })).toBeDefined()
  await ui.unmount()
})

test('six working agents, nested, all visible', async ($, on) => {
  engineBeneath(on)
  await $.prompt.submit({ text: 'go' })
  await $.turn.start({ text: 'go', turnId: 't1' })
  for (const [type, parent] of [['A1', undefined], ['B2', undefined], ['C3', 'a1'], ['D4', 'a1'], ['E5', 'a3'], ['F6', undefined]] as const) {
    await spawn($, { subagentType: type, description: `задача ${type}`, ...(parent === undefined ? {} : { parentAgentId: parent }) })
  }
  for (const surface of SURFACES) {
    const ui = await mountAgents($, surface, { rows: 40 })
    for (const type of ['A1', 'B2', 'C3', 'D4', 'E5', 'F6']) expect(await ui.find({ text: new RegExp(`◌ ${type}`) })).toBeDefined()
    expect(await ui.find({ text: /Лента/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a 30-column dock still draws every agent', async ($, on) => {
  engineBeneath(on)
  await spawn($, { subagentType: 'investigator', description: 'очень длинное описание задачи, которое не влезет в узкую колонку' })
  for (const surface of SURFACES) {
    const ui = await mountAgents($, surface, { cols: 30, rows: 20 })
    expect(await ui.find({ text: /investigator/ })).toBeDefined()
    expect(await ui.find({ text: /главный/ })).toBeDefined()
    await ui.unmount()
  }
})

test('/mc clear drops ended agents and earlier feed; /mc with an unknown word explains itself', async ($, on) => {
  engineBeneath(on)
  await $.prompt.submit({ text: 'go' })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await spawn($, { subagentType: 'Explore', description: 'старое' })
  await spawn($, { subagentType: 'investigator', description: 'идёт' })
  await complete($, { agentId: 'a1', answer: 'ok' })
  const cleared = await $.command.run({ command: 'mc', args: 'clear', origin: { kind: 'composer' } })
  expect(cleared.text).toMatch(/убраны/)
  const ui = await mountAgents($, 'terminal')
  expect(await ui.find({ text: /Explore/ })).toBeUndefined()
  expect(await ui.find({ text: /investigator/ })).toBeDefined()
  await ui.unmount()
  const unknown = await $.command.run({ command: 'mc', args: 'foo', origin: { kind: 'composer' } })
  expect(unknown.text).toMatch(/не знаю «foo»/)
  const opened = await $.command.run({ command: 'mc', args: '', origin: { kind: 'composer' } })
  expect(opened.text).toMatch(/открыта/)
})
```

- [ ] **Step 2: Run to see it fail**

Run: `claude plugin test mission-control; echo "EXIT=$?"`
Expected: `EXIT=1`; the pane tests fail on their first `find` (the placeholder pane draws only `агентов: N`).

- [ ] **Step 3: Rewrite `hooks/mission/pane.tsx`**

```tsx
import type { ElementTable } from 'claude-code'

import type { Action, AgentPhase, AgentRow } from '../../types'
import { fmtTokens } from '../lib/parse'
import { COLORS, fmtDur, plural, rule } from '../lib/viz'
import { MAIN, buildTree, isEnded, isSilent, isWorking } from './model'
import type { TreeLine } from './model'

// NB: never name a variable `h` in this module: JSX compiles to the global `h(...)`,
// and a local `h` turns every element below it into "h is not a function".

export type AgentsPaneData = {
  agents: readonly AgentRow[]
  actions: readonly Action[]
  /** The main loop's turn (prompt.submit counts them). */
  turn: number
  now: number
  /** The agent whose transcript the person has open beside the pane; null while main is in view. */
  viewAgentId: string | null
}

type Mark = { icon: string; color: string; label: string }

const MARKS: Record<AgentPhase, Mark> = {
  starting: { icon: '◌', color: COLORS.accent, label: 'запуск' },
  thinking: { icon: '◌', color: COLORS.accent, label: 'думает' },
  acting: { icon: '●', color: COLORS.accent, label: 'работает' },
  waiting: { icon: '◷', color: COLORS.muted, label: 'ждёт' },
  idle: { icon: '○', color: COLORS.muted, label: 'между ходами' },
  done: { icon: '✓', color: COLORS.good, label: 'готов' },
  failed: { icon: '✖', color: COLORS.critical, label: 'ошибка' },
  aborted: { icon: '⊘', color: COLORS.warning, label: 'прерван' },
  denied: { icon: '⊘', color: COLORS.warning, label: 'отклонён' },
}
const SILENT: Mark = { icon: '?', color: COLORS.warning, label: 'нет вестей' }

const STATUS: Record<Action['status'], { icon: string; color: string }> = {
  run: { icon: '◌', color: COLORS.accent },
  ok: { icon: '✓', color: COLORS.good },
  error: { icon: '✖', color: COLORS.critical },
  denied: { icon: '⊘', color: COLORS.warning },
}

/** The feed keeps at least this many rows however tall the tree is. */
const FEED_MIN = 3

/** How the person calls an agent: main is «главный»; a named agent shows its name and type. */
export function agentName(row: AgentRow): string {
  if (row.id === MAIN) return 'главный'
  return row.name !== null && row.name !== row.type ? `${row.name} (${row.type})` : row.type
}

function verbColor(kind: Action['kind']): string {
  if (kind === 'memory') return COLORS.search
  if (kind === 'delete') return COLORS.serious
  return COLORS.ink2
}

/** "сейчас" under 5 s, else 12с / 3м05с / 1ч02м. */
function ago(ms: number): string {
  return ms < 5000 ? 'сейчас' : fmtDur(ms)
}

/**
 * The Agents tab as one tree: main, then its agents nested by who spawned whom. A
 * working agent gets its task, its reason and what it does now; an ended one gets
 * one line with the start of its report. Below, the feed of recent calls of every
 * loop, newest first. `cols` is the body width, `rows` its visible height.
 */
export function drawAgentsPane(table: ElementTable, d: AgentsPaneData, cols: number, rows: number) {
  const { Box, Text } = table
  const inner = Math.max(20, cols - 2)
  const tree = buildTree(d.agents, d.turn, d.now)
  const out: JSX.Element[] = []

  const facts = (row: AgentRow, mark: Mark): string[] => {
    if (row.id === MAIN) {
      const said: string[] = row.turn > 0 ? [`ход ${row.turn}`] : []
      if (isWorking(row.phase)) said.push(fmtDur(d.now - row.startedAt))
      else if (row.endedAt === null) said.push('ещё не начинал')
      else if (row.phase === 'idle') said.push(`ждёт тебя · ${ago(d.now - row.endedAt)}`)
      else said.push(`${MARKS[row.phase].label} · ${ago(d.now - row.endedAt)}`)
      return said
    }
    if (row.phase === 'denied') return ['отклонён']
    const said = [fmtDur((row.endedAt ?? d.now) - row.startedAt)]
    if (row.steps > 0) said.push(`${row.steps} ${plural(row.steps, ['шаг', 'шага', 'шагов'])}`)
    if (mark === SILENT) said.push(`нет вестей ${fmtDur(d.now - row.lastEventAt)}`)
    else if (row.phase === 'failed' || row.phase === 'aborted' || row.phase === 'waiting' || row.phase === 'idle') said.push(mark.label)
    if (isEnded(row.phase) && row.tokens > 0) said.push(`${fmtTokens(row.tokens)} ток.`)
    return said
  }

  const detail = (indent: string, label: string, text: string, color: string) => (
    <Text wrap="truncate-end">
      <Text color={COLORS.muted}>
        {indent}
        {label}:{' '}
      </Text>
      <Text color={color}>{text}</Text>
    </Text>
  )

  // The reason is the point of the tab: it wraps under its label instead of being cut.
  const why = (indent: string, label: string, text: string) => (
    <Box flexDirection="row">
      <Text color={COLORS.muted}>
        {indent}
        {label}:{' '}
      </Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text color={COLORS.ink} wrap="wrap">
          «{text}»
        </Text>
      </Box>
    </Box>
  )

  const nowLine = (indent: string, row: AgentRow) => {
    const cur = row.current
    if (row.phase === 'acting' && cur !== null) {
      const mark = STATUS[cur.status]
      const verb = cur.status === 'run' ? cur.run : cur.done
      const dur = cur.status === 'run' ? d.now - cur.startedAt : (cur.ms ?? 0)
      return (
        <Text wrap="truncate-end">
          <Text color={COLORS.muted}>{indent}</Text>
          <Text color={mark.color}>{mark.icon} </Text>
          <Text color={verbColor(cur.kind)}>{verb}</Text>
          {cur.target.length > 0 ? <Text color={COLORS.ink}> {cur.target}</Text> : ''}
          {dur >= 1000 ? <Text color={COLORS.muted}> {fmtDur(dur)}</Text> : ''}
        </Text>
      )
    }
    const label = row.phase === 'starting' ? 'запускается' : row.phase === 'waiting' ? 'ждёт фоновую работу или одобрение' : 'думает'
    return (
      <Text wrap="truncate-end">
        <Text color={COLORS.muted}>{indent}</Text>
        <Text color={COLORS.accent}>◌ </Text>
        <Text color={COLORS.ink2}>{label}</Text>
        <Text color={COLORS.muted}> {fmtDur(d.now - row.phaseAt)}</Text>
      </Text>
    )
  }

  const drawRow = ({ row, lead, indent }: TreeLine): void => {
    const isMain = row.id === MAIN
    const mark = isSilent(row, d.now) ? SILENT : MARKS[row.phase]
    const ended = isEnded(row.phase)
    const viewed = !isMain && d.viewAgentId === row.id
    const said = facts(row, mark)
    const tail = ended && row.report !== null ? ` — ${row.report}` : ''
    out.push(
      <Text wrap="truncate-end">
        <Text color={COLORS.muted}>{lead}</Text>
        {viewed ? (
          <Text color={COLORS.ink} bold>
            ▶
          </Text>
        ) : (
          ''
        )}
        <Text color={mark.color}>{mark.icon} </Text>
        <Text color={ended ? COLORS.ink2 : COLORS.ink} bold={!ended}>
          {agentName(row)}
        </Text>
        <Text color={COLORS.muted}>
          {said.length > 0 ? ` · ${said.join(' · ')}` : ''}
          {tail}
        </Text>
      </Text>,
    )
    if (ended) return
    if (!isMain) {
      const task = row.description.length > 0 ? row.description : row.task
      if (task.length > 0) out.push(detail(indent, 'задача', task, COLORS.ink2))
    }
    if (row.intent !== null) out.push(why(indent, isMain && !isWorking(row.phase) ? 'итог' : 'зачем', row.intent))
    if (isWorking(row.phase)) out.push(nowLine(indent, row))
  }

  for (const line of tree.lines) drawRow(line)

  // ── Feed: the newest calls of every loop, as many as the tab has room for ──
  const byId = new Map(d.agents.map(r => [r.id, r]))
  const who = (agentId: string | null): string => {
    if (agentId === null) return 'главный'
    const row = byId.get(agentId)
    return row === undefined ? '↳фон' : `↳${row.name ?? row.type}`
  }
  const used = out.length + (tree.hidden > 0 ? 1 : 0)
  const room = Math.max(FEED_MIN, rows - used - 6)
  const recent = d.actions.slice(-room).reverse()
  const width = Math.min(16, Math.max(7, ...recent.map(a => who(a.agentId).length)))
  const feed =
    recent.length === 0 ? (
      <Text color={COLORS.muted}>пока без действий</Text>
    ) : (
      <Box flexDirection="column">
        {recent.map(a => {
          const mark = STATUS[a.status]
          const verb = a.status === 'run' ? a.run : a.done
          const slow = a.status !== 'run' && a.ms !== null && a.ms >= 3000 ? ` ${fmtDur(a.ms)}` : ''
          return (
            <Text wrap="truncate-end">
              <Text color={COLORS.muted}>{ago(d.now - a.startedAt).padStart(6)} </Text>
              <Text color={a.agentId === null ? COLORS.ink2 : COLORS.muted}>{who(a.agentId).padEnd(width)} </Text>
              <Text color={mark.color}>{mark.icon} </Text>
              <Text color={verbColor(a.kind)}>{verb}</Text>
              {a.target.length > 0 ? <Text color={COLORS.ink}> {a.target}</Text> : ''}
              <Text color={COLORS.muted}>{slow}</Text>
            </Text>
          )
        })}
      </Box>
    )
  const r = rule('Лента', inner)

  return (
    <Box flexDirection="column" backgroundColor={COLORS.surface} paddingX={1} paddingTop={1} width={cols} minHeight={Math.max(1, rows)}>
      {out}
      {tree.hidden > 0 && (
        <Text color={COLORS.muted}>
          … ещё {tree.hidden} {plural(tree.hidden, ['завершённый', 'завершённых', 'завершённых'])} раньше
        </Text>
      )}
      <Box flexDirection="column" marginTop={1}>
        <Text wrap="truncate-end">
          <Text color={COLORS.rule}>{r.lead}</Text>
          <Text color={COLORS.muted} bold>
            {r.title}
          </Text>
          <Text color={COLORS.rule}>{r.tail}</Text>
        </Text>
        {feed}
      </Box>
      <Box marginTop={1}>
        <Text color={COLORS.muted} wrap="truncate-end">
          /mc close · clear · /mem
        </Text>
      </Box>
    </Box>
  )
}
```

- [ ] **Step 4: Open the Agents tab first in `hooks/register.tsx`**

Change the import line `import { registerMission } from './mission/hooks'` to `import { openAgentsPane, registerMission } from './mission/hooks'`. Replace the pane-opening statement in `session.start` with:
```tsx
    // Agents first, then Memory: the order the tabs open in. After a reload either may be up
    // with the old module's drawing, so both are redrawn once (re)opened.
    void openAgentsPane($)
      .then(() => openMemoryPane($))
      .then(() => $.ui.invalidate('ui.render'))
      .catch(() => undefined)
```

- [ ] **Step 5: Uncomment the tab-order assertion in `tests/mission-events.test.ts`, run the tests**

In the test `a refused spawn, a nested spawn and the engine list`, change `// expect(s.agentsPaneStatus).toBe('placed') // Task 6` to `expect(s.agentsPaneStatus).toBe('placed')`.

Run: `claude plugin test mission-control; echo "EXIT=$?"`
Expected: `EXIT=0`, every suite green.

If a regex fails on spacing only (for example the kit's `text` joins nested Texts without the separator expected), compare the found element's `text` with the drawn line before touching the regex. Never loosen a regex until the assertion stops saying anything.

- [ ] **Step 6: Run full verify**

Run: `CLAUDE_CODE_TYPES=<path> bash tools/verify.sh; echo "EXIT=$?"`
Expected: `== verify: PASS`. tsc must accept `JSX.Element[]`, `flexGrow`/`flexShrink` on `Box`, and the `async function*` hook. If it rejects one, fix the type rather than casting to `any`.

- [ ] **Step 7: Commit**

```bash
git add mission-control/hooks/mission/pane.tsx mission-control/hooks/register.tsx mission-control/tests/mission-pane.test.ts
git commit -m "feat(mission): Agents tab — tree with task, reason and current action, feed, /mc"
```

---

### Task 7: Prove the tests bite, then review

**Files:**
- Create: `tools/prove-tests.mjs`

**Interfaces:**
- Produces: `node tools/prove-tests.mjs` — exit 0 only when every planted bug turns the suite red.

- [ ] **Step 1: Write `tools/prove-tests.mjs`**

```js
// Mutation smoke: plants known bugs in a copy of the mod, one at a time, and requires
// `claude plugin test` to fail on each. A suite that stays green on a planted bug
// checks nothing there (rule "green is not verified").
import { spawnSync } from 'node:child_process'
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MOD = 'mission-control'
const MUTANTS = [
  { name: 'intent-takes-first-sentence', file: 'hooks/mission/model.ts', from: 'const last = sentences(text).at(-1)', to: 'const last = sentences(text)[0]' },
  { name: 'tree-connectors-swapped', file: 'hooks/mission/model.ts', from: "lead: `${pad}${isLast ? '└─' : '├─'}`", to: "lead: `${pad}${isLast ? '├─' : '└─'}`" },
  { name: 'subagent-never-done', file: 'hooks/mission/model.ts', from: "(isMain || r.isTeammate ? 'idle' : 'done')", to: "(isMain || r.isTeammate ? 'idle' : 'idle')" },
  { name: 'tool-call-loses-its-loop', file: 'hooks/mission/hooks.tsx', from: 'applyToolStart(rows, { agentId, action: current, now: startedAt })', to: 'applyToolStart(rows, { agentId: null, action: current, now: startedAt })' },
  { name: 'step-text-ignored', file: 'hooks/mission/hooks.tsx', from: 'if (answer.length > 0) {', to: 'if (answer.length < 0) {' },
  { name: 'no-view-marker', file: 'hooks/mission/pane.tsx', from: 'const viewed = !isMain && d.viewAgentId === row.id', to: 'const viewed = false' },
  { name: 'silence-never', file: 'hooks/mission/model.ts', from: 'now - r.lastEventAt > SILENT_MS', to: 'now - r.lastEventAt < 0' },
  { name: 'memory-log-back', file: 'hooks/memory/pane.tsx', from: '{heroBlock}', to: '{heroBlock}<Text>поискал в памяти</Text>' },
]

let missed = 0
for (const m of MUTANTS) {
  const dir = join('.tmp', 'prove', m.name)
  rmSync(dir, { recursive: true, force: true })
  cpSync(MOD, dir, { recursive: true, filter: src => !src.replaceAll('\\', '/').includes('.claude-plugin/types') })
  const path = join(dir, m.file)
  const text = readFileSync(path, 'utf8')
  const count = text.split(m.from).length - 1
  if (count !== 1) {
    console.log(`${m.name}: the pattern occurs ${count} times in ${m.file}; fix the mutant`)
    missed += 1
    continue
  }
  writeFileSync(path, text.replace(m.from, m.to))
  const run = spawnSync('claude', ['plugin', 'test', dir], { encoding: 'utf8', shell: true })
  const failing = /(\d+) fail/.exec(run.stdout ?? '')?.[1] ?? '?'
  if (run.status === 0) {
    console.log(`${m.name}: SURVIVED — the suite stayed green on a planted bug`)
    missed += 1
  } else {
    console.log(`${m.name}: caught (${failing} failing)`)
  }
}
console.log(missed === 0 ? 'prove-tests: every planted bug was caught' : `prove-tests: ${missed} not caught`)
process.exit(missed === 0 ? 0 : 1)
```

- [ ] **Step 2: Run it**

Run: `node tools/prove-tests.mjs; echo "EXIT=$?"`
Expected: eight `caught (N failing)` lines, `prove-tests: every planted bug was caught`, `EXIT=0`. A `SURVIVED` line means a test is missing: add it to the owning task's test file, then run again. Record each mutant's failing count in the learnings.

- [ ] **Step 3: Prove tsc is real**

Plant `const typo: number = 'x'` at the end of `hooks/mission/model.ts` in a scratch copy (`.tmp/prove/tsc`). Run `npx -y -p typescript@5.6.3 tsc -p .tmp/tsconfig.fallback.json` with a fallback config whose include points at that copy; or, after Task 8 has laid the types, `tsc -p .tmp/prove/tsc`. Expected: exit 2 with `TS2322`.

- [ ] **Step 4: Three-pass review with fresh eyes**

Dispatch the `reviewer` agent on `git diff <Task-1 commit>..HEAD -- mission-control tools`. Give it the spec, this plan, and the Review Focus list. It runs three passes: architecture; patterns and implementation; edge cases.

Receive the findings with superpowers:receiving-code-review (verify each before acting). Fix the real ones test-first. Rerun `tools/verify.sh` and `node tools/prove-tests.mjs`.

- [ ] **Step 5: Commit**

```bash
git add tools/prove-tests.mjs
git commit -m "test: mutation smoke proving the suite catches planted bugs"
```

Commit any review fixes separately, each with its own message.

---

### Task 8: Ship — README, load from the repo, retire the old copies, live check

**Files:**
- Rewrite: `README.md`
- Modify: `C:/Users/Admin/.claude/settings.json` (via skill `update-config`)
- Delete: `C:/Users/Admin/.claude/skills/mem-meter/`, `C:/Users/Admin/.claude/dev-mods/ae945950-0bda-4ab7-9fab-1cb266bc56d8/`

- [ ] **Step 1: Write `README.md`**

````markdown
# singularity-mods

Claude Code mods of the Singularity setup. One so far: **mission-control**.

## mission-control

A sidebar for Claude Code with two tabs:

- **Агенты** — mission control. Shows who works right now and what each one is doing and why:
  - the main agent and every subagent, nested by who spawned whom;
  - for each: its task, the reason it gave last (the last sentence it wrote before acting), the call it runs now and how long it has run;
  - an ended agent folds to one line with the start of its report;
  - a feed of recent calls across all agents.
- **Память** — how much context arrives from memory (hook injections, CLAUDE.md, `mb search` / `mb code`), prompt cache, turns, context and limits, vault health. Formerly the mod `mem-meter`.

Commands: `/mc` (open Агенты), `/mc close`, `/mc clear` (drop ended agents and earlier feed); `/mem`, `/mem close|hide|show|quiet|reset`.
Tool for the model: `mcp__mission-control__snapshot` — the whole state as JSON.

### Load it

Claude Code loads the mod straight from this folder, watched and hot-reloaded. `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "E:/Project/singularity-mods/mission-control" } }
```

Restart Claude Code after setting it: `env` is read at start. The tabs open by themselves from 144 terminal columns in fullscreen (110 once you opened one yourself); `/mc` opens at any width.

### Develop

```bash
tools/verify.sh            # control bytes → claude plugin validate → claude plugin test → tsc
node tools/prove-tests.mjs # planted bugs must turn the suite red
```

Before any session has loaded the mod, tsc needs the engine's types: `CLAUDE_CODE_TYPES=<…/plugin-authoring/types/claude-code.d.ts> tools/verify.sh`.

Rules the engine imposes (found by probes, see `docs/plans/2026-10-11-mission-control.md`):
- one hooks module per plugin; no imports from outside the plugin folder;
- an atom must be made in the file that reads or writes it;
- never name a variable `h` (JSX factory).

### Troubleshoot

- A hook that fails live leaves a dim line in the transcript (`mission-control: <event> hook skipped: …`); the debug log (`claude --debug`) has all of them.
- A tab that does not show: `mcp__mission-control__snapshot` → `agentsPaneStatus` / `paneStatus` say what `$.ui.open` answered.
- The design: `docs/specs/2026-10-11-mission-control-design.md`.
````

- [ ] **Step 2: Verify and commit the README**

Run: `bash tools/verify.sh; echo "EXIT=$?"` → `== verify: PASS`.
```bash
git add README.md && git commit -m "docs: README for mission-control"
```

- [ ] **Step 3: Point Claude Code at the repo**

Invoke skill `update-config`. Set `env.CLAUDE_CODE_PLUGIN_DIRS` in `C:/Users/Admin/.claude/settings.json` to `E:/Project/singularity-mods/mission-control`: forward slashes, so no backslash ever crosses a tool boundary. Keep every other key. Read the file back and check the JSON parses (`node -e "JSON.parse(require('fs').readFileSync('C:/Users/Admin/.claude/settings.json','utf8'))" && echo OK`).

- [ ] **Step 4: Retire the old copies**

```bash
IMPORT=$(git log --format=%h --diff-filter=A -- mission-control/hooks/register.tsx | tail -1)
rm -rf .tmp/import && mkdir -p .tmp/import && git archive "$IMPORT" mission-control | tar -x -C .tmp/import
diff -r --strip-trailing-cr -x tsconfig.json C:/Users/Admin/.claude/skills/mem-meter .tmp/import/mission-control && echo SAFE-IN-GIT
```
Expected: `SAFE-IN-GIT`, meaning the import commit holds the skills copy byte for byte (line endings aside). Only then:
```bash
rm -rf C:/Users/Admin/.claude/skills/mem-meter C:/Users/Admin/.claude/dev-mods/ae945950-0bda-4ab7-9fab-1cb266bc56d8
ls C:/Users/Admin/.claude/skills/mem-meter C:/Users/Admin/.claude/dev-mods/ae945950-0bda-4ab7-9fab-1cb266bc56d8 2>&1
```
Expected: `No such file or directory` for both. Owner approval for the deletion: the design approved 2026-10-11 («ок» to the design that names both deletions). Deleting `skills/mem-meter` unloads it from a running session that loaded it from there. That is intended: the repo copy replaces it from the next start.

- [ ] **Step 5: Headless end-to-end check in a fresh process**

```bash
cd E:/Project/singularity-mods
CLAUDE_CODE_PLUGIN_DIRS=E:/Project/singularity-mods/mission-control claude -p --debug \
  --allowedTools "Agent,Glob,Read,mcp__mission-control__snapshot" \
  "Запусти субагента Explore с заданием найти файл README.md в текущей папке и вернуть его путь. Когда он закончит, вызови инструмент mcp__mission-control__snapshot и выведи из ответа массив agents целиком." \
  > .tmp/e2e.out 2> .tmp/e2e.err; echo "EXIT=$?"
grep -E "mission-control" .tmp/e2e.err | head -20
cat .tmp/e2e.out
```
Expected:
- `EXIT=0`;
- the debug lines show `hooks module mission-control@… loaded` and `/mc` / `/mem` listed, with no `hook skipped` line;
- the printed `agents` holds `main` and one `Explore` row with `phase: "done"`, a non-empty `task`, `steps ≥ 1`, `tools ≥ 1`, and a `report`.

Record the actual output in the learnings. If the agent row is missing, debug with superpowers:systematic-debugging before anything else.

- [ ] **Step 6: Interactive check with the owner**

Ask the owner to restart Claude Code in any folder, widen the terminal to ≥ 144 columns (or type `/mc`), and give a task that spawns two subagents. Then ask:
1. Are the tabs «Агенты» and «Память» there, and which one opens by default?
2. Do the agents appear and end live?
3. Does «зачем» read as the reason?

Their answer is the acceptance. A pixel-level complaint is checked against a screenshot at native resolution before it is fixed. If the tab order is wrong, swap the two `open…Pane` calls in `register.tsx` and verify again.

- [ ] **Step 7: Lay the engine types and run verify without the fallback**

After the first interactive session has loaded the mod, `mission-control/.claude-plugin/types/` exists. Run `bash tools/verify.sh; echo "EXIT=$?"` (no `CLAUDE_CODE_TYPES`). Expected: `== verify: PASS`.

- [ ] **Step 8: Update the vault**

Invoke `mb-memory`:
- in `reference/CLAUDE-CODE-CLI-CUSTOMIZATION.md`, rewrite the mem-meter section as mission-control: the repo path, how it loads, the two tabs, the commands, the snapshot tool, the engine rules from the probes;
- add a changelog entry;
- close the MEM-METER TODO (old copy deleted).

Ask the owner before any write, per the vault rules.
````

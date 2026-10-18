# Team-Lead Control (mission-control) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `mission-control` a deterministic control layer for a lead that delegates to subagents: a cost ledger in Opus-equivalent tokens (OE), a spawn guard (Fable, council, budget), a per-request guard (budget, freeze, workflow effort), a watchdog for long calls that can wake an idle lead, a change-only digest pushed to the lead, a `team` MCP tool and `/mc budget|halt|resume|solo`. What Claude Code already does by settings (default subagent model, workflow size, fan-out caps, restarting stalled agents) is switched on in Task 3 and NOT reimplemented (spec D14).

**Architecture:** New pure modules in `hooks/lead/` (no `$`, no atoms) hold every decision; the existing hook bodies in `mission/hooks.tsx` and `register.tsx` call them and own the atoms (the engine accepts one unmatched hook per event per module and an atom only in the file that made it). New state lives in atoms `lead` declared in each file that reads or updates it. Default mode is `observe`: numbers are counted and shown, never enforced; the Fable and council guards and the watchdog act in both modes.

**Tech Stack:** Claude Code 2.1.302 function-hooks mods (TSX, `claude-code`, `claude-code/testing`), TypeScript 5.6.3 strict. Gate: `tools/verify.sh`.

**Task 3 live check (2026-10-18, session started after the settings edit, `snapshot` field `model`):** `general-purpose` Agent without `model` → `claude-sonnet-5-5`; workflow `wf_98d6fade-944`, 3 agents, no model in the script → all three `claude-sonnet-5-5`; Agent with `model: "opus"` → `claude-opus-5-5[1m]` (the call parameter wins; the alias resolves to the lead's 1M-context variant). `CLAUDE_CODE_SUBAGENT_MODEL` covers workflow agents — no default-model branch in the spawn guard.

**Spec:** `docs/specs/2026-10-18-team-lead-delegation-design.md` (part B, §6). Read it with this plan. Decisions D1–D13 there are the owner's; §6.7 lists the calls made after the spec check.

## Global Constraints

- Plugin `mission-control`, bump version `0.3.0` → `0.4.0`. State key `'mission-control'`, new atom key `'lead'`.
- Every observer hook ends `.catch(($, e, next) => next(e))` (fail-open). The **guards** fail open too: a thrown guard lets the spawn/request through unchanged and logs once to the feed.
- `turn.step` stays `async function*` and forwards with `yield* next(e)` only. Refusing a request = returning a `TurnStepResult` without calling `next`.
- Tests cannot `read($, atom)`: exact state checks go through `mcp__mission-control__team` (Task 8) or `snapshot`.
- All user-facing text Russian. No raw control bytes, no BOM, LF.
- Prices (skill `claude-api`, 2026-10-06), $/MTok input / output / cache read: Opus 5.5 4 / 20 / 0.20; Sonnet 5.5 2 / 10 / 0.20; Haiku 5.5 0.10 / 0.50 / input price until a source is found; Fable 5.1 10 / 50 / 0.25. Cache write = 1.25 × input. OE = Σ tokens × price / 4.
- Markers matched literally: `COUNCIL MISSION`, `ПОЧЕМУ FABLE:`. Council commands: `council`, `planning-council`, `observation-council`.
- Defaults: `budgetMode=observe`, `fableCap=3`, silence 15 min for every tier, long call 20 min (constants, not options), digest ≤ 600 characters, wake ≤ 1 per alarm per agent and ≤ 1 per 10 min per session, workflow effort by tier haiku low / sonnet medium / opus high.

## Review Focus

- A model id the price table does not know (a new release, `claude-test` in tests) → counted at Fable price and flagged `?`, never a crash and never 0 OE. → Task 1 test `unknown model is priced as fable and flagged`.
- Usage with missing fields (`cache_*` undefined, `usage` null on a failed request) → that request adds 0 OE, the row survives. → Task 1 test `missing usage fields count as zero`.
- A fork (`fork: true`) asking for Fable → not rewritten (the engine ignores it), noted in the digest as `форк · модель лида`, not denied in `observe`. → Task 4 test `fork is noted, never rewritten`.
- `/mc budget +abc` or `/mc budget +0` → a Russian error line, budget unchanged. → Task 8 test `bad budget increment is refused`.
- The lead's own requests while the session budget is gone in `enforce` → still sent (the lead must be able to ask the owner, D10). → Task 5 test `main is never blocked`.

---

### Task 1: Prices and OE

**Files:**
- Create: `mission-control/hooks/lead/price.ts`
- Test: `mission-control/tests/lead-price.test.ts`

**Interfaces:**
- Produces: `type Tier = 'haiku' | 'sonnet' | 'opus' | 'fable'`; `tierOf(model: string | null | undefined): Tier | null` (alias or full id, prefix match: `claude-haiku-5-5…`, `haiku` → `haiku`); `oeOf(usage: StepUsage | null | undefined): { oe: number; unknown: boolean }` where `StepUsage = { model?: string; input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }`; `isFable(model: string | null | undefined): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
test('opus input is 1 OE per token', () => expect(oeOf({ model: 'claude-opus-5-5', input_tokens: 1000 }).oe).toBe(1000))
test('sonnet output is 2.5 OE per token', () => expect(oeOf({ model: 'claude-sonnet-5-5', output_tokens: 100 }).oe).toBe(250))
test('haiku input is 0.025 OE per token', () => expect(oeOf({ model: 'haiku', input_tokens: 1000 }).oe).toBe(25))
test('cache write is 1.25 × input', () => expect(oeOf({ model: 'claude-opus-5-5', cache_creation_input_tokens: 100 }).oe).toBe(125))
test('unknown model is priced as fable and flagged', () => expect(oeOf({ model: 'claude-test', input_tokens: 100 })).toEqual({ oe: 250, unknown: true }))
test('missing usage fields count as zero', () => { expect(oeOf(null).oe).toBe(0); expect(oeOf({ model: 'claude-opus-5-5' }).oe).toBe(0) })
test('tierOf reads aliases and ids', () => { expect(tierOf('claude-fable-5-1')).toBe('fable'); expect(tierOf('sonnet')).toBe('sonnet'); expect(tierOf(undefined)).toBe(null) })
```

- [ ] **Step 2: Run** `claude plugin test mission-control` — Expected: FAIL, `lead/price` not found.
- [ ] **Step 3: Implement `hooks/lead/price.ts`** — one `PRICES` table keyed by tier with the source date in a comment; `tierOf` by `includes` of the family word after lowercasing.
- [ ] **Step 4: Run** `claude plugin test mission-control` — Expected: the 7 tests PASS.
- [ ] **Step 5: Commit** `feat(lead): prices and Opus-equivalent tokens`

### Task 2: Config and ledger

**Files:**
- Create: `mission-control/hooks/lead/config.ts`, `mission-control/hooks/lead/ledger.ts`
- Modify: `mission-control/.claude-plugin/plugin.json` (userConfig + version 0.4.0)
- Test: `mission-control/tests/lead-ledger.test.ts`

**Interfaces:**
- Consumes: `Tier`, `oeOf` (Task 1).
- Produces:
  - `type LeadConfig = { mode: 'observe' | 'enforce'; sessionBudget: number | null; runBudget: number | null; agentBudget: number | null; fableCap: number }`; constants `SILENCE_MS = 15 * 60_000`, `LONG_CALL_MS = 20 * 60_000`; `leadConfigOf(options: unknown): LeadConfig` (strings parsed; empty or non-positive → `null`/default).
  - `type Lead = { byAgent: Record<string, number>; byRun: Record<string, number>; session: number; extra: number; fableCalls: number; councilTurn: string | null; halted: boolean; solo: boolean; rewrites: number; denials: number; news: string[]; alarmsSent: Record<string, number>; lastWakeAt: number | null; flags: string[] }`; `EMPTY_LEAD: Lead`.
  - `addUsage(l: Lead, f: { agentId: string | null; runId: string | null; oe: number }): Lead` (main counts into `session` only).
  - `budgetLeft(l: Lead, c: LeadConfig, f: { agentId: string | null; runId: string | null }): { session: number | null; run: number | null; agent: number | null }` (`null` = no limit; session limit = `sessionBudget + extra`).
  - `isExhausted(left): boolean`; `pushNews(l: Lead, line: string): Lead` (keeps last 20).
- userConfig keys (all `type: "string"`, the mod has no number type): `budgetMode` (options `observe`,`enforce`, default `observe`), `sessionBudgetOE`, `runBudgetOE`, `agentBudgetOE` (default `""`), `fableCap` (default `"3"`). No default-model option: the engine's `CLAUDE_CODE_SUBAGENT_MODEL` does that (Task 3).

- [ ] **Step 1: Write the failing tests** — `leadConfigOf({})` equals the defaults above; `leadConfigOf({ budgetMode: 'enforce', sessionBudgetOE: '2000000', fableCap: 'x' })` → `mode 'enforce'`, `sessionBudget 2000000`, `fableCap 3`; `addUsage` twice for `a1` in run `wf_1` → `byAgent.a1`, `byRun.wf_1`, `session` all summed; `addUsage` with `agentId: null` → only `session`; `budgetLeft` with `sessionBudget 1000`, `extra 500`, `session 1200` → `session 300`; `isExhausted({ session: 0, run: null, agent: null })` → `true`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** both files and the plugin.json keys (Russian titles: «Бюджет: режим», «Бюджет сессии, OE», «Бюджет прогона workflow, OE», «Бюджет исполнителя, OE», «Вызовов Fable за сессию»).
- [ ] **Step 4: Run** `tools/verify.sh` — Expected: `== verify: PASS` (validate accepts the new keys).
- [ ] **Step 5: Commit** `feat(lead): config keys and the OE ledger`

### Task 3: Settings baseline (no mod code)

Spec §5.0. Edits `~/.claude/settings.json` (outside this repository) with the `update-config` skill, never by hand-merged copies. Show the owner the diff before writing.

**Files:**
- Modify: `~/.claude/settings.json` — `env.CLAUDE_CODE_SUBAGENT_MODEL = "sonnet"`, `env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS = "8"`, `env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = "2"`, top-level `workflowSizeGuideline = "small"`. Do NOT set `advisorModel`, `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, `CLAUDE_CODE_EFFORT_LEVEL`.
- Modify: `README.md` (a «Настройки движка» row in the new «Тимлид» section, written in Task 10)

- [ ] **Step 1: Pre-check** — `grep -n -E "CLAUDE_CODE_SUBAGENT_MODEL|workflowSizeGuideline|advisorModel|CLAUDE_CODE_EFFORT_LEVEL" ~/.claude/settings.json` — Expected: nothing (as on 2026-10-18). Anything found → stop and show the owner.
- [ ] **Step 2: Write** the four keys via `update-config`.
- [ ] **Step 3: Live check** in a session started after the edit: spawn a `general-purpose` agent without `model` → the Agents tab and `snapshot` show a Sonnet id; a 3-agent workflow whose script names no model → all three Sonnet; an `Agent` call with `model: "opus"` → Opus (the parameter still wins). Record the three results at the top of this plan.
- [ ] **Step 4:** no commit in this repository (the file is outside it); note the date and keys in `learnings/active/TEAM-LEAD.md` via `mb learn`.

### Task 4: Spawn guard

No default-model branch: the engine resolves a missing model to `CLAUDE_CODE_SUBAGENT_MODEL` (Task 3).

**Files:**
- Create: `mission-control/hooks/lead/guard.ts`
- Modify: `mission-control/hooks/mission/hooks.tsx:98` (the `agent.spawn` hook decides before `next`), `mission-control/hooks/memory/hooks.tsx:214` (the `prompt.submit` hook opens the council window), `mission-control/hooks/register.tsx:643` (`turn.complete` of main closes it), `mission-control/types/index.d.ts` (`AgentRow.effort: string | null`, `AgentRow.oe: number`)
- Test: `mission-control/tests/lead-guard.test.ts` (pure), `mission-control/tests/lead-events.test.ts` (through the engine)

**Interfaces:**
- Consumes: `tierOf`, `isFable` (1), `Lead`, `LeadConfig`, `budgetLeft`, `isExhausted` (2).
- Produces: `type SpawnFacts = { model?: string; prompt: string; subagentType: string; fork: boolean; isWorkflow: boolean; isResume: boolean; runId: string | null }`; `type SpawnDecision = { kind: 'pass' } | { kind: 'rewrite'; model: string; note: string } | { kind: 'deny'; reason: string } | { kind: 'note'; note: string }`; `decideSpawn(f: SpawnFacts, l: Lead, c: LeadConfig): SpawnDecision`.
- Order, exactly spec §6.3 + §6.7: (1) `COUNCIL MISSION` in prompt and `l.councilTurn === null` → deny «Council запускается только командой владельца — попроси его»; inside the window, Fable or no model → rewrite `opus`. (2) Fable: workflow → rewrite `opus`; not `advisor`, or no non-empty `ПОЧЕМУ FABLE:` line, or `l.fableCalls >= c.fableCap` → deny with the reason. (3) `enforce` and (`isExhausted(budgetLeft(...))` or `l.halted`) → deny «бюджет исчерпан — остановись и спроси владельца» (applies to forks and resumes too). (4) Fork → note «форк · модель лида». A resume is never rewritten.
- Hook wiring: deny → return `{ deny }` without `next`; rewrite → `next({ ...e, model })`; after `next`, a spawned `advisor` increments `fableCalls`; every rewrite/deny is `pushNews`ed and counted. `prompt.submit` with `e.command?.name` in the council set sets `councilTurn` to the main turn id (or `'pending'` until `turn.start`); main's `turn.complete` sets it back to `null`.

- [ ] **Step 1: Failing pure tests** (one per branch; each is a planted violation — removing the branch must turn it red): `council without command is denied`, `council inside the window runs on opus`, `fable in a workflow becomes opus`, `fable outside advisor is denied`, `advisor without ПОЧЕМУ FABLE is denied`, `fourth advisor over cap 3 is denied`, `no model is left to the engine` (decision `pass`, no `model` added), `fork is noted, never rewritten`, `resume is never rewritten`, `observe never denies on numbers`, `enforce denies when the session is spent`.
- [ ] **Step 2: Failing engine tests** in `lead-events.test.ts` using `engineBeneath`, `submit`, `spawn`: a workflow-shaped spawn with `model: 'fable'` reaches the engine with `model: 'opus'` (assert on the stubbed `agent.spawn` input); `/council` then a `COUNCIL MISSION` spawn passes, the same spawn after main's `turn.complete` is denied.
- [ ] **Step 3: Run** — Expected: FAIL.
- [ ] **Step 4: Implement** `guard.ts` and the three wirings.
- [ ] **Step 5: Run** `tools/verify.sh` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(lead): spawn guard — fable, council, budget`

### Task 5: Request guard and per-step accounting

**Files:**
- Modify: `mission-control/hooks/lead/guard.ts` (add `decideStep`), `mission-control/hooks/mission/hooks.tsx:47-67` (`turn.step`), `mission-control/hooks/mission/model.ts` (`applyStepUsage(rows, { agentId, oe, model, effort })`)
- Test: `mission-control/tests/lead-guard.test.ts`, `mission-control/tests/lead-events.test.ts`

**Interfaces:**
- Produces: `type StepDecision = { kind: 'send' } | { kind: 'send'; effort: string } | { kind: 'block'; answer: string }`; `decideStep(f: { agentId: string | null; runId: string | null; isWorkflow: boolean; model: string; effort?: string | number }, l: Lead, c: LeadConfig): StepDecision`. Main (`agentId === null`) → always `send`. Subagent in `enforce` with exhausted agent/run/session budget or `l.halted` → `block` with answer «[mission-control] остановлен до запроса: бюджет исчерпан» / «… заморожено владельцем». Workflow agent with no `effort` → `send` with the tier effort (haiku low, sonnet medium, opus high; Fable untouched).
- Accounting: after `yield* next(...)`, `oeOf(res.usage)` → `addUsage` into `lead` and `applyStepUsage` into `agentsA` (row `oe`, `model` from `usage.model` when present). `unknown` adds `'?'` to `flags` once per model. A subagent whose `usage.model` tier differs from the model the guard set → `pushNews` «модель навязана сессией: …» (§6.7).
- The run id for a step comes from the row (`workflowRunId`), looked up by `agentId`.
- Built-in advisor calls (`res.serverToolUses` entries named `advisor`) → `pushNews` «советчик вызван: <агент>» (spec §9; the mod can see, not refuse them).
- Lead on Fable (§6.4): the first main step whose `e.model` is Fable → once per session `$.ui.toast` «лид на Fable — всё без явной модели унаследовало бы Fable» and the same line into `news`. The main request is sent unchanged.

- [ ] **Step 1: Failing tests:** `main is never blocked`, `spent subagent is blocked before the request` (engine test: the stubbed `turn.step` never sees the call; the agent's report is the block answer), `halted blocks every subagent`, `workflow sonnet agent gets medium effort`, `a step's usage lands in the row as OE`, `forced model is reported`, `fable lead is toasted once`, `an advisor call reaches the news`.
- [ ] **Step 2–4:** run (FAIL) → implement → `tools/verify.sh` PASS.
- [ ] **Step 5: Commit** `feat(lead): request guard and per-request OE`

### Task 6: Watchdog and wake

**Files:**
- Create: `mission-control/hooks/lead/watch.ts`
- Modify: `mission-control/hooks/register.tsx` (the existing `$.clock.every` tick calls it; wake through `$.prompt.submit`)
- Test: `mission-control/tests/lead-watch.test.ts`

**Interfaces:**
- Produces: `type Alarm = { agentId: string; kind: 'silent' | 'long-call'; minutes: number }`; `alarmsOf(rows: readonly AgentRow[], now: number, sent: Record<string, number>): Alarm[]` (silence = no event for `SILENCE_MS`, `isWorking` and not `waiting` — short silences are the engine's own stall restart, not ours; long call = `row.current` started more than `LONG_CALL_MS` ago; an alarm already in `sent` under `${agentId}:${kind}` is not repeated); `leadIdle(rows: readonly AgentRow[]): boolean` (main row phase `idle` or `done`); `mayWake(l: Lead, now: number): boolean` (`lastWakeAt` null or ≥ 10 min ago).
- Wake text: «[mission-control] тревога: <агент> — нет вестей N мин / вызов идёт N мин. Реши: TaskStop, SendMessage или ждать.»

- [ ] **Step 1: Failing tests:** `silent after 15 minutes, not after 14`, `a waiting agent is never silent`, `an alarm is raised once`, `long call over 20 minutes alarms`, `idle lead is woken once per 10 minutes` (engine test: two alarms 2 min apart → one `prompt.submit`), `busy lead is not woken, the alarm goes to news`.
- [ ] **Step 2–4:** run (FAIL) → implement → PASS.
- [ ] **Step 5: Commit** `feat(lead): watchdog with a rate-limited wake`

### Task 7: Digest to the lead

**Files:**
- Create: `mission-control/hooks/lead/digest.ts`
- Modify: `mission-control/hooks/register.tsx` (new hook `on('classic.PostToolBatch', …)`; main only = input has no `agent_id`), `mission-control/hooks/memory/hooks.tsx:214` (same digest into `e.context` of the owner's prompt)
- Test: `mission-control/tests/lead-digest.test.ts`

**Interfaces:**
- Produces: `digestOf(news: readonly string[], left: { session: number | null }, c: LeadConfig): string | null` — `null` when `news` is empty; lines merged when identical («×3»); hard cap 600 characters (cut at a line boundary, then «…и ещё N»); when the session budget crosses 80 % adds «бюджет сессии: 80 %», when exhausted adds «бюджет сессии исчерпан: потрачено X OE — остановись и спроси владельца»; `l.solo` adds «владелец: дальше делай сам, не делегируй».
- After a digest is delivered, `news` is cleared.

- [ ] **Step 1: Failing tests:** `no news, no digest`, `identical lines merge`, `digest never exceeds 600 characters`, `exhausted session tells the lead to stop and ask`, `a subagent's batch gets no digest` (engine test with `agent_id` set), `the owner's prompt carries the digest in context`.
- [ ] **Step 2–4:** run (FAIL) → implement → PASS. If `classic.PostToolBatch` turns out unavailable to mods in 2.1.302 (`claude plugin validate` refuses it), fall back to `classic.PostToolUse` with the same main-only filter and record the deviation at the top of this plan.
- [ ] **Step 5: Commit** `feat(lead): change-only digest pushed to the lead`

### Task 8: `team` tool and `/mc` subcommands

**Files:**
- Modify: `mission-control/hooks/register.tsx` (`$.tool.register({ name: 'team', … })` in `session.start`; `on('tool.call', { tool: TEAM_TOOL }, …)`; `/mc` handler splits `e.args` by whitespace; `argumentHint` and the unknown-argument text list the new words), `mission-control/hooks/mission/hooks.tsx:72` (catch-all skips `TEAM_TOOL` like `SNAPSHOT_TOOL`)
- Create: `mission-control/hooks/lead/team.ts`
- Test: `mission-control/tests/lead-team.test.ts`

**Interfaces:**
- Produces: `TEAM_TOOL = 'mcp__mission-control__team'`; `teamTable(rows: readonly AgentRow[], l: Lead, c: LeadConfig): string` — header line `режим · сессия X/Y OE · Fable n/cap`, then one line per working or recently ended agent: `id · ярус · effort · задача(≤60) · ходы · OE[/лимит] · состояние`.
- `/mc budget` → the table; `/mc budget +N` (N positive integer) → `extra += N`, reply with the new limit; anything else after `budget` → «mission-control: /mc budget +N — N целое больше нуля»; `/mc halt` → `halted = true`, `pushNews('владелец остановил исполнителей')`; `/mc resume` → `halted = false`; `/mc solo` → `solo = true` (cleared after the next digest).

- [ ] **Step 1: Failing tests** via `runCommand` and `$.tool.call({ tool: TEAM_TOOL })`: `team lists tier, effort and OE`, `budget +500 raises the limit`, `bad budget increment is refused`, `halt freezes, resume releases` (with Task 5's block), `solo reaches the next digest once`.
- [ ] **Step 2–4:** run (FAIL) → implement → PASS.
- [ ] **Step 5: Commit** `feat(lead): team tool and /mc budget, halt, resume, solo`

### Task 9: The Agents tab shows tier, effort, OE and the budget

**Files:**
- Modify: `mission-control/hooks/mission/pane.tsx` (`AgentsPaneData` gains `lead: { mode: 'observe' | 'enforce'; session: number; limit: number | null; halted: boolean }`; `agentFacts` :151 adds `ярус · effort · N OE`; classic header `bannerLine` line and slate strip (~:440) add `наблюдение`/`контроль` and `X/Y OE`; `ЗАМОРОЖЕНО` when halted), `mission-control/hooks/mission/hooks.tsx:136-149` (fill `lead` from the atom)
- Test: `mission-control/tests/mission-pane.test.ts`

- [ ] **Step 1: Failing tests** on both `terminal` and `desktop` surfaces: a working sonnet row shows `sonnet · medium` and `OE`; the header shows `наблюдение` in `observe` and `контроль · 300/1 000 OE` in `enforce`; `ЗАМОРОЖЕНО` after `/mc halt`. Existing pane tests stay green.
- [ ] **Step 2–4:** run (FAIL) → implement → PASS. Both themes; every new glyph one narrow cell (`tests/theme.test.ts` holds that).
- [ ] **Step 5: Commit** `feat(lead): tier, effort, OE and budget on the Agents tab`

### Task 10: Week journal, mutants, docs, live check

**Files:**
- Create: `mission-control/hooks/lead/journal.ts` (`journalLine(row: AgentRow, runOE: number): string` — one JSON line: `ts, type, tier, effort, turns, oe, ms, outcome`)
- Modify: `mission-control/hooks/register.tsx` (`turn.complete` of a subagent appends the line via `$.fs` to the plugin's data directory, file `lead-journal.jsonl`; a write failure is swallowed), `tools/prove-tests.mjs` (MUTANTS), `README.md` (a «Тимлид» section: what is guarded, modes, commands, the journal, the engine settings of Task 3 and why the mod does not duplicate them; a note on the week's quality check — ~20 delegated tasks from the journal judged by one Opus call, spec §7)
- Test: `mission-control/tests/lead-journal.test.ts`

- [ ] **Step 1: Failing test** `journal line is one JSON object with the eight fields`.
- [ ] **Step 2–4:** run (FAIL) → implement → PASS.
- [ ] **Step 5: Mutants** — add to `tools/prove-tests.mjs`: drop the council branch; drop the Fable cap; make main blockable; drop the long-call alarm; drop the digest cap. Run `node tools/prove-tests.mjs` — Expected: every mutant killed.
- [ ] **Step 6: Live check** on the real engine (session started after the change), record results at the top of this plan: a workflow agent asking for Fable runs on opus (Agents tab); `advisor` without `ПОЧЕМУ FABLE:` is refused; `/council` runs its agents on opus, a manual `COUNCIL MISSION` spawn without it is refused; `budgetMode=enforce` + `agentBudgetOE=2000` stops a scout before a request and the lead asks the owner; an idle lead is woken by a silent agent.
- [ ] **Step 7: Run** `tools/verify.sh` — Expected: `== verify: PASS`.
- [ ] **Step 8: Commit** `feat(lead): week journal, mutants, README`

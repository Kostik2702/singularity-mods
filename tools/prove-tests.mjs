// Mutation smoke: plants known bugs in a copy of the mod, one at a time, and requires
// `claude plugin test` to fail on each. A suite that stays green on a planted bug
// checks nothing there (rule "green is not verified").
import { spawnSync } from 'node:child_process'
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MOD = 'mission-control'
const MUTANTS = [
  { name: 'intent-takes-first-sentence', file: 'hooks/mission/model.ts', from: 'const last = saidSentences(text).at(-1)', to: 'const last = saidSentences(text)[0]' },
  { name: 'tree-connectors-swapped', file: 'hooks/mission/model.ts', from: 'lead: `${pad}${isLast ? glyphs.last : glyphs.branch}`', to: 'lead: `${pad}${isLast ? glyphs.branch : glyphs.last}`' },
  { name: 'subagent-never-done', file: 'hooks/mission/model.ts', from: "(isMain || r.isTeammate ? 'idle' : 'done')", to: "(isMain || r.isTeammate ? 'idle' : 'idle')" },
  { name: 'silence-never', file: 'hooks/mission/model.ts', from: 'now - r.lastEventAt > SILENT_MS', to: 'now - r.lastEventAt < 0' },
  { name: 'refusal-forgotten', file: 'hooks/mission/model.ts', from: 'if (f.deny !== null) {', to: 'if (f.deny === "never") {' },
  { name: 'tool-call-loses-its-loop', file: 'hooks/mission/hooks.tsx', from: 'applyToolStart(rows, { agentId, action: current, now: startedAt })', to: 'applyToolStart(rows, { agentId: null, action: current, now: startedAt })' },
  { name: 'step-text-ignored', file: 'hooks/mission/hooks.tsx', from: 'if (answer.length > 0) {', to: 'if (answer.length < 0) {' },
  { name: 'no-view-marker', file: 'hooks/mission/pane.tsx', from: 'const viewed = !isMain && d.viewAgentId === row.id\n    const tail', to: 'const viewed = false\n    const tail' },
  { name: 'reconcile-never-on-timer', file: 'hooks/register.tsx', from: 'if (!always && !needsReconcile(await read($, agentsA), await $.clock.now())) return', to: 'if (!always) return' },
  { name: 'memory-log-back', file: 'hooks/memory/pane.tsx', from: '{heroBlock}', to: '{heroBlock}<Text>поискал в памяти</Text>' },
  { name: 'early-step-dropped', file: 'hooks/mission/model.ts', from: 'return trimAgents([...rows, provisionalRow(agentId, now)])', to: 'return [...rows]' },
  { name: 'split-inside-brackets', file: 'hooks/mission/model.ts', from: 'if (depth === 0 && isEnd &&', to: 'if (isEnd &&' },
  { name: 'fork-drawn', file: 'hooks/mission/model.ts', from: "rows.filter(r => r.id !== MAIN && isConfirmed(r))", to: 'rows.filter(r => r.id !== MAIN)' },
  { name: 'background-report-folded', file: 'hooks/mission/model.ts', from: 'const endedThisTurn = r.endedAt !== null && r.endedAt > main.startedAt', to: 'const endedThisTurn = false' },
  { name: 'launch-reads-finished', file: 'hooks/mission/hooks.tsx', from: 'launchedVerb(ran.result) ?? words.done', to: 'words.done' },
  { name: 'heading-as-report', file: 'hooks/mission/model.ts', from: 'const said = sentences(prose(text))', to: 'const said = sentences(text)' },
  { name: 'list-reopens-ended', file: 'hooks/mission/model.ts', from: 'if (isEnded(held)) return held', to: 'if (held === "never") return held' },
  { name: 'parallel-call-reads-done', file: 'hooks/mission/model.ts', from: 'current: at.fallback ?? ended', to: 'current: ended' },
  { name: 'fresh-report-folded', file: 'hooks/mission/model.ts', from: 'const isFresh = r.endedAt !== null && now - r.endedAt <= RECENT_MS', to: 'const isFresh = false' },
  { name: 'tokens-count-cache-reads', file: 'hooks/register.tsx', from: "(u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)", to: "(u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)" },
  { name: 'reason-unbounded', file: 'hooks/mission/pane.tsx', from: 'if (lines.length === 2) break', to: 'if (lines.length === 99) break' },
  { name: 'job-exit-mark-ignored', file: 'hooks/jobs/model.ts', from: 'if (code !== null && j.isBackground)', to: 'if (code === -12345 && j.isBackground)' },
  { name: 'job-empty-percent-reads-zero', file: 'hooks/jobs/model.ts', from: "if (s === undefined || s.trim().length === 0) return null", to: "if (s === 'never') return null" },
  { name: 'job-foreground-shown-at-once', file: 'hooks/jobs/model.ts', from: 'if (!isEnded(j)) return j.isBackground || now - j.startedAt >= LONG_MS', to: 'if (!isEnded(j)) return true' },
  { name: 'job-tab-never-raised', file: 'hooks/register.tsx', from: 'if (first !== undefined) {', to: 'if (first !== undefined && first.id === "never") {' },
  { name: 'job-notification-ignored', file: 'hooks/jobs/model.ts', from: "if (word === 'completed')", to: "if (word === 'never')" },
  { name: 'job-intent-lost', file: 'hooks/jobs/hooks.tsx', from: 'const intent = agents.find(r => r.id === (f.agentId ?? MAIN))?.intent ?? null', to: 'const intent = null' },
  // The team-lead layer (hooks/lead): every guard is proved by switching it off.
  { name: 'lead-council-branch-dropped', file: 'hooks/lead/guard.ts', from: 'if (isCouncilPrompt(f.prompt)) {', to: 'if (isCouncilPrompt(f.prompt) && f.prompt === "never") {' },
  { name: 'lead-fable-cap-dropped', file: 'hooks/lead/guard.ts', from: '} else if (l.fableCalls >= c.fableCap) {', to: '} else if (l.fableCalls >= 99999) {' },
  { name: 'lead-main-blockable', file: 'hooks/lead/guard.ts', from: "if (f.agentId === null) return { kind: 'send' }", to: "if (f.agentId === 'never') return { kind: 'send' }" },
  { name: 'lead-long-call-alarm-dropped', file: 'hooks/lead/watch.ts', from: 'now - r.current.startedAt > LONG_CALL_MS', to: 'now - r.current.startedAt < 0' },
  { name: 'lead-digest-cap-dropped', file: 'hooks/lead/digest.ts', from: 'if (text.length <= DIGEST_MAX) return text', to: 'if (text.length <= 99999) return text' },
  { name: 'lead-halt-spawn-only-in-enforce', file: 'hooks/lead/guard.ts', from: "if (l.halted) return { kind: 'deny', reason: DENY_HALT }", to: "if (l.halted && c.mode === 'enforce') return { kind: 'deny', reason: DENY_HALT }" },
  { name: 'lead-halt-step-only-in-enforce', file: 'hooks/lead/guard.ts', from: "if (l.halted) return { kind: 'block', answer: BLOCK_HALT }", to: "if (l.halted && c.mode === 'enforce') return { kind: 'block', answer: BLOCK_HALT }" },
  { name: 'lead-bare-advisor-not-fable', file: 'hooks/lead/guard.ts', from: "isFable(f.model) || (f.subagentType === 'advisor' && (f.model === undefined || f.model === ''))", to: 'isFable(f.model)' },
  // The council window (R25): it lives until the owner speaks, and a working member holds it open.
  { name: 'lead-council-closes-on-main-turn-complete', file: 'hooks/register.tsx', from: "if (e.agentId === undefined) await chime($, 'vox')", to: "if (e.agentId === undefined) { await update($, leadA, l => ({ ...l, councilTurn: null })); await chime($, 'vox') }" },
  { name: 'lead-council-closes-with-member-working', file: 'hooks/lead/council.ts', from: 'return working ? l : { ...l, councilTurn: null, councilAgents: [] }', to: 'return { ...l, councilTurn: null, councilAgents: [] }' },
  { name: 'lead-council-closed-by-any-origin', file: 'hooks/lead/council.ts', from: '!OWNER_ORIGINS.includes(p.origin)', to: 'false' },
  { name: 'lead-council-member-not-remembered', file: 'hooks/mission/hooks.tsx', from: 'memberId !== undefined && isCouncilPrompt(e.prompt)', to: 'memberId === "never" && isCouncilPrompt(e.prompt)' },
]

/** Runs the suite on a folder: its exit status and the pass/fail counts it printed, null when none were printed. */
function runSuite(dir) {
  const run = spawnSync('claude', ['plugin', 'test', dir], { encoding: 'utf8', shell: true })
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`
  const pass = /(\d+) pass/.exec(out)?.[1]
  const fail = /(\d+) fail/.exec(out)?.[1]
  return { status: run.status, pass: pass === undefined ? null : Number(pass), fail: fail === undefined ? null : Number(fail) }
}

function copyMod(name) {
  const dir = join('.tmp', 'prove', name)
  rmSync(dir, { recursive: true, force: true })
  cpSync(MOD, dir, { recursive: true, filter: src => !src.replaceAll('\\', '/').includes('.claude-plugin/types') })
  return dir
}

// A green baseline first: a red or silent run on the clean copy would make every mutant look caught.
const base = runSuite(copyMod('baseline'))
if (base.status !== 0 || base.fail !== 0 || base.pass === null || base.pass === 0) {
  console.log(`prove-tests: the clean copy is not green (status ${base.status}, pass ${base.pass}, fail ${base.fail}); nothing proven`)
  process.exit(2)
}
console.log(`baseline: ${base.pass} pass, 0 fail`)

let missed = 0
for (const m of MUTANTS) {
  const dir = copyMod(m.name)
  const path = join(dir, m.file)
  const text = readFileSync(path, 'utf8')
  const count = text.split(m.from).length - 1
  if (count !== 1) {
    console.log(`${m.name}: the pattern occurs ${count} times in ${m.file}; fix the mutant`)
    missed += 1
    continue
  }
  writeFileSync(path, text.replace(m.from, m.to))
  const run = runSuite(dir)
  // Caught means the suite ran and failed tests; a crash or a missing CLI proves nothing.
  if (run.status !== 0 && run.fail !== null && run.fail > 0) {
    console.log(`${m.name}: caught (${run.fail} failing)`)
  } else {
    console.log(`${m.name}: NOT CAUGHT (status ${run.status}, pass ${run.pass}, fail ${run.fail})`)
    missed += 1
  }
}
console.log(missed === 0 ? `prove-tests: all ${MUTANTS.length} planted bugs were caught` : `prove-tests: ${missed} of ${MUTANTS.length} not caught`)
process.exit(missed === 0 ? 0 : 1)

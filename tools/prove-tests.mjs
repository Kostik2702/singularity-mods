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
  { name: 'silence-never', file: 'hooks/mission/model.ts', from: 'now - r.lastEventAt > SILENT_MS', to: 'now - r.lastEventAt < 0' },
  { name: 'refusal-forgotten', file: 'hooks/mission/model.ts', from: 'if (f.deny !== null) {', to: 'if (f.deny === "never") {' },
  { name: 'tool-call-loses-its-loop', file: 'hooks/mission/hooks.tsx', from: 'applyToolStart(rows, { agentId, action: current, now: startedAt })', to: 'applyToolStart(rows, { agentId: null, action: current, now: startedAt })' },
  { name: 'step-text-ignored', file: 'hooks/mission/hooks.tsx', from: 'if (answer.length > 0) {', to: 'if (answer.length < 0) {' },
  { name: 'no-view-marker', file: 'hooks/mission/pane.tsx', from: 'const viewed = !isMain && d.viewAgentId === row.id', to: 'const viewed = false' },
  { name: 'reconcile-never-on-timer', file: 'hooks/register.tsx', from: 'if (!always && !needsReconcile(await read($, agentsA))) return', to: 'if (!always) return' },
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

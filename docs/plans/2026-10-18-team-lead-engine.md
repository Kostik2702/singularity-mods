# Team-Lead Rubric (Singularity engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the lead its judgment layer in the engine: a `team-lead` skill (rubric), agents `scout` (Haiku) and `advisor` (Fable), default models on the existing agents, councils that only the owner can start, and the rubric's core injected where spawns are decided.

**Architecture:** Markdown surfaces (skill, agents, preamble, workflow phase) plus one SessionStart fragment; every injected rule is registered in `singularity/machine/rules_delivery.py` `DELIVERIES` so `test_every_registered_delivery_is_still_in_place` fails when one disappears.

**Tech Stack:** Python 3.10+, pytest (`python -m pytest -q`, CI on ubuntu/macos/windows). Repository: `E:/Singularity`.

**Spec:** `docs/specs/2026-10-18-team-lead-delegation-design.md` in the mods repository (part A, §5). It is NOT referenced from any file or commit in the engine: rule «Singularity не знает о проекте». Engine commits describe the change on its own terms.

## Global Constraints

- Nothing in the engine names the mods repository, its paths or `mission-control`. The skill says «a plugin may refuse a spawn» — no plugin name.
- Agent frontmatter keeps `name` and the quoted `description`; new keys go after `description`. Installers copy frontmatter byte-for-byte (verified: `install/register_agents.py`, `register_skills._link_dir`); agents are Claude-only.
- Every new agent file contains the line `{{AGENTS}}/AGENT_SHARED_PREAMBLE.md` (enforced by `test_every_agent_points_at_the_deployed_preamble`).
- Markers (literal, used by `DELIVERIES` and by the mod): `COUNCIL MISSION`, `ПОЧЕМУ FABLE:`.
- Tier table and brief template exactly as spec §5.1; default agent models exactly as spec §5.2.
- Tests are proven by planting: delete the injected text, see red, restore.

## Review Focus

- A user typing `/council` still starts it after `disable-model-invocation: true` (the flag hides it only from the model). → Task 2 live step.
- The fragment ceiling is a recorded budget (`docs/rules-delivery.md` «~4.1k characters»): raising it is a decision, not a fix — the owner approves the new number before Task 4 merges. → Task 4 Step 1.
- `historian` on Sonnet must still pass its own vault-search duties; if its tests or prompts assume the lead's model, keep it on opus and note it. → Task 1 Step 5.
- A preamble bullet that contradicts «No mid-flight stops» would freeze background agents: the new text returns questions in the report, it never stops the run. → Task 1 test.
- D2 counts `AGENT_SHARED_PREAMBLE` as an agent; two new agents must raise its PASS count by exactly 2 after `python install/register_agents.py`. → Task 1 Step 7.

---

### Task 1: Agents `scout`, `advisor`; default models; the preamble line

**Files:**
- Create: `singularity/agents/scout.md`, `singularity/agents/advisor.md`
- Modify: `install/register_agents.py:37-46` (`AGENTS` + `scout`, `advisor`), `tests/test_rules_delivery.py:23-24` (`AGENT_NAMES` + both), `singularity/agents/{coder,web-implementer,historian}.md` (`model: sonnet`), `singularity/agents/{investigator,critic,validator,reviewer,web-viewer}.md` (`model: opus`), `singularity/agents/AGENT_SHARED_PREAMBLE.md` §2 (extend the **Never Decide Alone** bullet), `singularity/machine/rules_delivery.py` `DELIVERIES`
- Test: `tests/test_rules_delivery.py`, new `tests/test_agent_tiers.py`

**Interfaces:**
- `scout.md` frontmatter: `model: haiku`, `effort: low`, `maxTurns: 30`, `omitClaudeMd: true`, `background: true`, `tools: Read, Grep, Glob, Bash`. Body: read-only; output = findings with `file:line` quotes, no paraphrase; a result longer than ~40 lines goes to a file and the report gives its path plus a summary; stops as soon as the brief's stop criterion is met; never edits. `coder` does NOT get `omitClaudeMd` (spec D16: after the week's measurement).
- `advisor.md` frontmatter: `model: fable`, `maxTurns: 8`, `tools: Read, Grep, Glob`. Body: refuses a task without a `ПОЧЕМУ FABLE:` line (answers «нет обоснования — верни вопрос лиду»); one question → one short answer: recommendation, why, confidence, what would change it.
- Preamble §2 addition to **Never Decide Alone**: «— put the question in your report to the lead and continue or finish what is yours; never stop the run to wait».
- `DELIVERIES` rows (surface `agent`): `("advisor answers only a justified question", "agent", AGENTS / "advisor.md", "ПОЧЕМУ FABLE:")`, `("scout quotes, never paraphrases", "agent", AGENTS / "scout.md", "file:line")`.

- [ ] **Step 1: Failing tests** in `tests/test_agent_tiers.py`: `test_scout_skips_claude_md` (`omitClaudeMd: true` in scout's frontmatter, absent in coder's); `test_agent_default_models` — a dict `{scout: haiku, advisor: fable, coder: sonnet, web-implementer: sonnet, historian: sonnet, investigator: opus, critic: opus, validator: opus, reviewer: opus, web-viewer: opus}` checked against the `model:` line inside each file's leading `---` block; `test_new_agents_are_deployed` — both names in `register_agents.AGENTS`; `test_preamble_returns_questions_without_stopping` — §2 contains «never stop the run to wait».
- [ ] **Step 2: Run** `python -m pytest -q tests/test_agent_tiers.py tests/test_rules_delivery.py` — Expected: FAIL.
- [ ] **Step 3: Implement** the files and list entries.
- [ ] **Step 4: Run** `python -m pytest -q` — Expected: all PASS.
- [ ] **Step 5:** grep `historian` usages in skills/tests for model assumptions; if any, set it to opus and change the test dict.
- [ ] **Step 6: Plant** — delete `ПОЧЕМУ FABLE:` from `advisor.md`; `python -m pytest -q tests/test_rules_delivery.py` must FAIL; restore.
- [ ] **Step 7:** `python install/register_agents.py` then `mb doctor` — Expected: `D2-agents PASS`, count up by 2.
- [ ] **Step 8: Commit** `feat(agents): scout and advisor tiers; default models; questions go into the report`

### Task 2: Councils start only on the owner's command

**Files:**
- Modify: `singularity/skills/{council,planning-council,observation-council}/SKILL.md` (frontmatter `disable-model-invocation: true` after `description`; first body line «Starts only on the owner's explicit command. If you think a council is needed, ask the owner to run it and say why.»; every spawn instruction names `model: "opus"` — council/SKILL.md:65, :139, and the matching lines in the other two), `singularity/machine/rules_delivery.py` `DELIVERIES` (three rows, surface `skill`, marker `owner's explicit command`)
- Test: `tests/test_council_gate.py`

- [ ] **Step 1: Failing tests:** `test_councils_hidden_from_the_model` — each of the three frontmatter blocks contains `disable-model-invocation: true`; `test_council_agents_run_on_opus` — each SKILL.md mentions `model: "opus"` at least once on a line that also mentions `Agent`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `python -m pytest -q` — Expected: PASS, including `test_council_family_claude_only` and `PORTABLE_BASELINE` unchanged.
- [ ] **Step 5: Plant** — remove the flag from `planning-council`; test FAIL; restore.
- [ ] **Step 6: Live** — after `python install/register_skills.py`, a new session: `council` absent from the model's skill list; `/council test` still starts it.
- [ ] **Step 7: Commit** `feat(councils): owner-only start, agents on opus`

### Task 3: Skill `team-lead`

**Files:**
- Create: `singularity/skills/team-lead/SKILL.md`
- Modify: `install/skill_manifest.py` `SKILL_MANIFEST` (`"team-lead": {clients: ["claude"], tools: ["Agent"], reason: "spawns Claude subagents by model tier via the Agent tool"}`), `singularity/machine/rules_delivery.py` `DELIVERIES` (surface `skill`, markers: `effort`, `ПОЧЕМУ FABLE:`, `owner's explicit command`, `run_in_background`)
- Test: `tests/test_team_lead_skill.py`

**Interfaces:**
- Frontmatter: `name: team-lead`; description triggers on delegating work, choosing a subagent, model or effort, spawning executors, workflow agent models — in any language.
- Body sections, in order, content exactly spec §5.1 items 1–11: the explicit grant «You choose `model` and `effort` for every executor you spawn; this skill is the explicit instruction the Agent tool's `effort` parameter asks for»; do-it-yourself rule; tier table (with «opus for checks and thinking — always name it explicitly; a missing model means sonnet»); scale rules (simple — yourself or 1 executor; comparison or independent parts — 2–4; workflow only when the parts outgrow you, under 5 agents without a reason; never spawn for an answer already in context); brief template (goal, files, done criterion **and stop criterion**, output format, out of scope, «a result over ~40 lines goes to a file — return its path and a summary», questions go back in the report, `file:line` quotes, the `tier · effort · why` line); acceptance and same-`agentId` follow-up; background; Fable via `advisor` only, built-in `/advisor` stays off; council → ask the owner; workflow scripts (mechanics may omit the model, opus explicit and only for verifiers, never Fable, uniform model/effort/type within a fan-out for the shared cache, no forks for mechanics); budget («a plugin may refuse a spawn or a request and tell you the budget is spent: stop and ask the owner with AskUserQuestion: add budget / finish yourself / stop all»).

- [ ] **Step 1: Failing tests:** `test_team_lead_registered_for_claude_only`; `test_team_lead_grants_effort` (contains «`effort`» and «explicit instruction»); `test_team_lead_has_the_tier_table` (rows for haiku, sonnet, opus, fable); `test_team_lead_has_scale_and_stop_rules` (contains «2–4», «stop criterion», «path and a summary»).
- [ ] **Step 2–4:** run (FAIL) → write the skill and manifest entry → `python -m pytest -q` PASS.
- [ ] **Step 5: Plant** — remove the effort grant; FAIL; restore.
- [ ] **Step 6: Commit** `feat(skills): team-lead rubric`

### Task 4: SessionStart fragment and the investigation phase

**Files:**
- Modify: `singularity/machine/hooks_state.py` (new `TEAM_LEAD_FRAGMENT`), `singularity/hooks/session_start.py:111-129` (import + `lines.append(TEAM_LEAD_FRAGMENT)` before `MEASURED_AXIS_FRAGMENT`), `tests/test_rules_delivery.py` (`ALL_FRAGMENTS` + the new one; ceiling `4150` → the approved number), `docs/rules-delivery.md:39-41` (the figure), `singularity/workflow/phase-1-investigation.md` (bullet after «Verify code first»: «- [ ] Mechanics of the investigation — runs, tests, data collection — go to executors per skill `team-lead`; you keep the thinking.»), `singularity/machine/rules_delivery.py` `DELIVERIES` (surface `SessionStart` for the fragment, `skill`-like row for the phase file with marker `team-lead`)

**Interfaces:**
- `TEAM_LEAD_FRAGMENT` (≤ 560 characters; measure with `len()` in the test, not by eye):
```
## Delegating to executors
- You choose model and effort for each executor (skill `team-lead`): haiku — reading, search, mechanics; sonnet — code by a plan (the default when no model is named); opus — checks and thinking, always named. Do it yourself when the brief would cost as much as the work; 2–4 executors, not dozens.
- Background executors; big results come back as a file path. Fable only via `advisor` with `ПОЧЕМУ FABLE:`.
- A council starts only on the owner's command — ask for it.
- Told the budget is spent: stop and ask the owner.
```

- [ ] **Step 1: Owner gate** — the current aggregate is 4039 of 4150. Ask the owner to approve raising the ceiling to `4700` (or to cut another fragment). Do not continue without the answer.
- [ ] **Step 2: Failing tests:** `test_team_lead_fragment_reaches_every_session` (`session_start.build_context(vault)` contains `TEAM_LEAD_FRAGMENT`); the existing per-fragment and aggregate limits with the new fragment in `ALL_FRAGMENTS`.
- [ ] **Step 3–5:** run (FAIL) → implement → `python -m pytest -q` PASS.
- [ ] **Step 6: Plant** — drop the `lines.append`; FAIL; restore.
- [ ] **Step 7: Commit** `feat(session-start): delegation core where spawns are decided`

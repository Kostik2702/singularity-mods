// Long actions, the Processes tab's model: pure functions from engine facts and a
// task's output text to job rows. No `$` here: the hooks feed facts in, the tests
// call these directly.
//
// Where the facts come from (probed live 2026-10-14, macOS):
// - every Bash call, foreground included, writes its output as it goes to
//   `<tmp>/claude-<uid>/<cwd slug>/<session id>/tasks/<id>.output`; a foreground
//   call's file is deleted when the call ends;
// - a background task's file ends with `[exited with code N]` once it exits;
// - its notification reaches prompt.submit as `<task-notification>` with
//   `<task-id>`, `<tool-use-id>`, `<status>` and a `<summary>` naming the exit code.

import type { AgentRow, Job, JobKind, JobProgress } from '../../types'
import { basename } from '../lib/actions'
import { clip } from '../mission/model'

/** A foreground call shows once it has run this long; a background one at once. */
export const LONG_MS = 5000
/** An ended job stays folded in the tab this long. */
export const KEEP_ENDED_MS = 30 * 60_000
export const MAX_ENDED = 20
/** A running job whose output has not grown for this long is flagged. */
export const SILENT_OUTPUT_MS = 2 * 60_000
/** How much of an output's end is read for its progress. */
export const TAIL_BYTES = 8192
/** Above this size the tail is read with `tail -c`, not by reading the whole file. */
export const FULL_READ_MAX = 1_000_000
export const COMMAND_MAX = 400
export const JOB_DESCRIPTION_MAX = 160
export const LINE_MAX = 200

// ── What a command is ─────────────────────────────────────────────────────────

export const KIND_LABEL: Record<JobKind, string> = {
  download: 'Скачивание',
  train: 'Обучение',
  data: 'Подготовка данных',
  eval: 'Оценка',
  install: 'Установка',
  build: 'Сборка',
  test: 'Тесты',
  server: 'Сервер',
  watch: 'Наблюдение',
  run: 'Команда',
}

const GIST: Record<JobKind, string> = {
  download: 'скачивает',
  train: 'обучает:',
  data: 'готовит данные:',
  eval: 'оценивает:',
  install: 'ставит',
  build: 'собирает',
  test: 'гоняет тесты:',
  server: 'держит запущенным',
  watch: 'следит:',
  run: 'выполняет',
}

/** When a chain does several things, the one that names it: `pip install x && python train.py` is training. */
const PRIORITY: readonly JobKind[] = ['train', 'eval', 'data', 'download', 'server', 'test', 'build', 'install', 'watch', 'run']

/** Shell words that only set the stage and say nothing about the action. */
const STAGE = /^(cd|pushd|popd|echo|printf|date|export|set|unset|source|\.|sleep|true|false|clear|for|while|until|done|do|if|then|else|elif|fi|mkdir|ls|cat|wait|trap|read)(\s|$)/
/** Prefixes that wrap the real command. */
const WRAPPER = /^(?:nohup|time|sudo|exec|env|caffeinate(?:\s+-\w+)*|nice(?:\s+-n\s*-?\d+)?|stdbuf(?:\s+-\w+)*)\s+/

/** The meaningful pieces of a command line, each with its wrappers and env assignments taken off. */
export function commandParts(command: string): string[] {
  return command
    // A lone `&` backgrounds what precedes it; `2>&1` and `&>` are redirections, not splits.
    .split(/&&|\|\||;|\n|\|(?!\|)|(?<![>&<])&(?![&>])/)
    .map(raw => {
      let s = raw.trim().replace(/^(do|then|else)\s+/, '')
      for (let i = 0; i < 6; i += 1) {
        const before = s
        s = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+/, '').replace(WRAPPER, '').trim()
        if (s === before) break
      }
      return s
    })
    .filter(s => s.length > 0 && !STAGE.test(s) && !/^[A-Za-z_][A-Za-z0-9_]*=\S*$/.test(s) && !/^[)}]/.test(s))
}

function argsOf(words: readonly string[]): string[] {
  return words.filter(a => a.length > 0 && !a.startsWith('-') && !/^\d*[<>]/.test(a) && a !== '>' && a !== '<')
}

const URL_RE = /\b(?:https?|s3|gs|hf|ftp):\/\/[^\s'"`)]+/

/** `model.bin ← huggingface.co`, or the host alone when the URL has no file. */
function urlTarget(url: string): string {
  const m = /^[a-z0-9]+:\/\/([^/?#]+)([^?#]*)/i.exec(url)
  if (m === null) return url
  const host = (m[1] ?? '').replace(/^www\./, '')
  const file = basename(m[2] ?? '')
  return file.length > 0 && file !== host ? `${file} ← ${host}` : host
}

/** The script or module a runner runs: `train.py`, `-m pkg.train` → `pkg.train`. */
function scriptOf(words: readonly string[]): string | null {
  const m = words.indexOf('-m')
  if (m >= 0 && words[m + 1] !== undefined) return words[m + 1] ?? null
  const file = words.slice(1).find(w => /\.(py|sh|bash|zsh|js|mjs|cjs|ts|ipynb|r|jl|rb|pl)$/i.test(w.replace(/["']/g, '')))
  return file === undefined ? null : basename(file)
}

const RUNNERS = new Set(['python', 'python3', 'py', 'node', 'bun', 'deno', 'bash', 'sh', 'zsh', 'Rscript', 'julia', 'ruby', 'perl', 'uv', 'poetry', 'pipenv', 'conda', 'tsx', 'ts-node', 'npx'])
const TRAIN_WORDS = /train|finetun|fine[-_]?tun|\bsft\b|_sft|sft_|lora|\bdpo\b|_dpo|pretrain|distill/i
const EVAL_WORDS = /eval|bench|score/i
const DATA_WORDS = /data|prep|preprocess|tokeni[sz]|convert|ingest|embed|index|scrape|crawl|augment|dedup|shard|clean|extract|generat|build_|make_/i
const DOWNLOAD_WORDS = /download|fetch|pull|mirror|snapshot_download|hf_hub_download|load_dataset|from_pretrained/i
const TEST_WORDS = /test|verify|check|lint/i

type Classified = { kind: JobKind; target: string }

/** One piece of a command line: what it is and what it acts on. */
function classify(part: string): Classified {
  const words = part.split(/\s+/)
  const prog = basename(words[0] ?? '').replace(/\.exe$/i, '')
  const args = argsOf(words.slice(1))
  const sub = args[0] ?? ''
  const url = URL_RE.exec(part)?.[0] ?? null
  const low = part.toLowerCase()

  // Downloads first: their target is the URL.
  if (/^(curl|wget|aria2c|axel|yt-dlp|youtube-dl)$/.test(prog)) return { kind: 'download', target: url === null ? sub : urlTarget(url) }
  const hf = /\b(?:huggingface-cli|hf)\s+download\s+(\S+)/.exec(part)
  if (hf !== null) return { kind: 'download', target: `${hf[1] ?? ''} ← Hugging Face` }
  if (prog === 'git' && sub === 'clone') return { kind: 'download', target: `репозиторий ${basename(args[1] ?? '').replace(/\.git$/, '')}` }
  if (prog === 'git' && sub === 'lfs') return { kind: 'download', target: 'файлы git LFS' }
  if ((prog === 'docker' || prog === 'podman') && sub === 'pull') return { kind: 'download', target: args[1] ?? '' }
  if (prog === 'ollama' && sub === 'pull') return { kind: 'download', target: args[1] ?? '' }
  if (/^(rsync|scp|rclone|gsutil)$/.test(prog) || /\baws\s+s3\s+(cp|sync)\b|\bgcloud\s+storage\s+(cp|rsync)\b/.test(part)) {
    return { kind: 'download', target: url === null ? basename(args.at(-2) ?? args[0] ?? '') : urlTarget(url) }
  }

  // Installs.
  const pyPip = /(?:^|\s)-m\s+pip\s+install\b/.test(part)
  if (pyPip || /^(pip3?|pipx|conda|mamba|micromamba|brew|apt|apt-get|npm|pnpm|yarn|bun|cargo|gem|go|poetry)$/.test(prog) || prog === 'uv') {
    const verb = pyPip ? 'install' : prog === 'uv' && sub === 'pip' ? (args[1] ?? '') : sub
    if (/^(install|i|add|ci|sync|get)$/.test(verb) || (prog === 'yarn' && args.length === 0)) {
      const skip = pyPip ? args.indexOf('install') + 1 : prog === 'uv' && sub === 'pip' ? 2 : 1
      const pkgs = args.slice(Math.max(1, skip)).filter(a => !/^(install|i|add|ci|sync|get|pip)$/.test(a))
      const shown = pkgs.slice(0, 3).join(', ') + (pkgs.length > 3 ? ', …' : '')
      return { kind: 'install', target: shown.length > 0 ? shown : `зависимости (${prog === 'uv' ? 'uv' : pyPip ? 'pip' : prog})` }
    }
  }

  // Package-manager scripts: build, test, dev servers.
  if (/^(npm|pnpm|yarn|bun)$/.test(prog)) {
    const script = sub === 'run' ? (args[1] ?? '') : sub
    if (/^build/.test(script)) return { kind: 'build', target: `${prog} ${script}` }
    if (/^test/.test(script)) return { kind: 'test', target: `${prog} ${script}` }
    if (/^(dev|start|serve|preview)/.test(script)) return { kind: 'server', target: `${prog} ${script}` }
  }
  if (/^(make|cmake|ninja|gradle|gradlew|mvn|bazel|tsc|webpack|xcodebuild|msbuild)$/.test(prog)) {
    if (prog === 'make' && /^(test|check)/.test(sub)) return { kind: 'test', target: `make ${sub}` }
    return { kind: 'build', target: [prog, sub].filter(Boolean).join(' ') }
  }
  if ((prog === 'cargo' || prog === 'go') && sub === 'build') return { kind: 'build', target: `${prog} build` }
  if ((prog === 'docker' || prog === 'podman') && (sub === 'build' || (sub === 'compose' && args[1] === 'build'))) return { kind: 'build', target: 'образ docker' }
  if (prog === 'vite' && sub === 'build') return { kind: 'build', target: 'vite build' }
  if (/^(pytest|jest|vitest|mocha|tox|nox|playwright)$/.test(prog) || /(?:^|\s)-m\s+(pytest|unittest)\b/.test(part)) return { kind: 'test', target: prog }
  if ((prog === 'cargo' || prog === 'go') && sub === 'test') return { kind: 'test', target: `${prog} test` }
  if (prog === 'claude' && sub === 'plugin' && args[1] === 'test') return { kind: 'test', target: `плагин ${basename(args[2] ?? '')}`.trim() }
  if (/^(uvicorn|gunicorn|llama-server|vite)$/.test(prog) || /\bflask\s+run\b|\bjupyter\s+(lab|notebook)\b|\b(ollama|vllm)\s+serve\b|(?:^|\s)-m\s+http\.server\b|\bnext\s+dev\b/.test(part)) {
    return { kind: 'server', target: prog === 'python' || prog === 'python3' ? 'http.server' : [prog, sub].filter(Boolean).join(' ') }
  }
  if ((prog === 'tail' && /\s-[a-zA-Z]*[fF]/.test(part)) || prog === 'watch') return { kind: 'watch', target: basename(args.at(-1) ?? prog) }
  if (prog === 'mb' && sub === 'ingest') return { kind: 'data', target: 'mb ingest' }

  // Training launchers, then any runner by the name of what it runs.
  if (/^(torchrun|deepspeed|axolotl)$/.test(prog) || /\baccelerate\s+launch\b|\bmlx_lm\.lora\b|\bllamafactory-cli\s+train\b|\btune\s+run\b/.test(part)) {
    return { kind: 'train', target: scriptOf(words) ?? prog }
  }
  const script = scriptOf(words)
  const isRunner = RUNNERS.has(prog) || /^\.?\.?\//.test(words[0] ?? '') || script !== null
  if (isRunner) {
    // `python -c "…"`: the code itself says what it is.
    const name = script ?? (/\s-c\s/.test(part) ? low : '')
    const target = script ?? (words[0] === undefined ? prog : basename(words[0]))
    if (TRAIN_WORDS.test(name)) return { kind: 'train', target }
    if (EVAL_WORDS.test(name)) return { kind: 'eval', target }
    if (DOWNLOAD_WORDS.test(name)) return { kind: 'download', target: script ?? 'с Hugging Face' }
    if (DATA_WORDS.test(name)) return { kind: 'data', target }
    if (TEST_WORDS.test(script ?? '')) return { kind: 'test', target }
    return { kind: 'run', target }
  }
  return { kind: 'run', target: [prog, sub].filter(Boolean).join(' ') }
}

export type JobText = { kind: JobKind; label: string; gist: string }

/** A command in words: its kind, the tab's label for it, and its gist. */
export function describeJob(tool: string, command: string, description: string): JobText {
  if (tool === 'Monitor') {
    const target = description.length > 0 ? description : (commandParts(command)[0] ?? command)
    return { kind: 'watch', label: KIND_LABEL.watch, gist: clip(`${GIST.watch} ${target}`, LINE_MAX) }
  }
  const parts = commandParts(command).map(classify)
  const rank = (k: JobKind): number => PRIORITY.indexOf(k)
  const best = parts.reduce<Classified | null>((acc, c) => (acc === null || rank(c.kind) < rank(acc.kind) ? c : acc), null)
  const chosen = best ?? { kind: 'run' as const, target: clip(command.trim(), 60) }
  const target = chosen.target.trim().length > 0 ? chosen.target.trim() : (description.length > 0 ? description : clip(command.trim(), 60))
  return { kind: chosen.kind, label: KIND_LABEL[chosen.kind], gist: clip(`${GIST[chosen.kind]} ${target}`, LINE_MAX) }
}

// ── What the output says ──────────────────────────────────────────────────────

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[=>78]/g
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

/**
 * The lines a terminal would show for this output: ANSI codes dropped, and a line
 * rewritten in place with \r (tqdm, curl, wget) reduced to its last state.
 */
export function screenLines(text: string): string[] {
  return text
    .replace(ANSI, '')
    .split('\n')
    .map(line => {
      const pieces = line.split('\r').filter(p => p.trim().length > 0)
      return (pieces.at(-1) ?? '').replace(CONTROL, '').trimEnd()
    })
    .filter(line => line.trim().length > 0)
}

/** The engine's own last line in a background task's output once the command exits. */
const EXIT_MARK = /^\[exited with code (-?\d+)\]\s*$/

/** The exit code a background task's output ends with; null while it runs. */
export function exitCodeOf(lines: readonly string[]): number | null {
  const m = EXIT_MARK.exec(lines.at(-1) ?? '')
  return m === null ? null : Number(m[1])
}

type Hit = { fraction: number | null; count: string | null; eta: string | null; rate: string | null }

function num(s: string | undefined): number {
  return Number((s ?? '').replace(',', '.').replace(/[^\d.eE-]/g, ''))
}

/** A fraction kept to four places: 1.2/3.0 reads 0.4, not 0.39999999999999997. */
function round(f: number): number {
  return Math.round(f * 10_000) / 10_000
}

function ratio(a: string | undefined, b: string | undefined): number | null {
  if (a === undefined || b === undefined || a.length === 0 || b.length === 0) return null
  const x = num(a)
  const y = num(b)
  return Number.isFinite(x) && Number.isFinite(y) && y > 0 && x >= 0 && x <= y ? round(x / y) : null
}

/** "45.2" → 0.452; null for nothing (Number('') is 0, which once read as a 0% bar). */
function percent(s: string | undefined): number | null {
  if (s === undefined || s.trim().length === 0) return null
  const v = num(s)
  return Number.isFinite(v) && v >= 0 && v <= 100 ? round(v / 100) : null
}

function eta(s: string | undefined): string | null {
  const t = (s ?? '').trim()
  return t.length === 0 || /^[-?:]+$/.test(t) || /^--/.test(t) ? null : t
}

function rateIn(s: string | undefined): string | null {
  return /[\d.]+\s*[A-Za-z]*\/s\b/.exec(s ?? '')?.[0]?.replace(/\s+/g, '') ?? null
}

function hit(fraction: number | null, count: string | null = null, left: string | null = null, rate: string | null = null): Hit {
  return { fraction, count, eta: left, rate }
}

const UNIT = String.raw`\s*[kKMGTP]?(?:i?B)?`

/** Each reads one line; the first that matches the latest progress line wins. */
const MATCHERS: readonly ((line: string) => Hit | null)[] = [
  // tqdm: " 45%|████▌     | 450/1000 [00:12<00:15, 36.2it/s]"
  line => {
    const m = new RegExp(String.raw`(\d{1,3}(?:\.\d+)?)%\s*\|[^|]*\|\s*([\d.]+${UNIT})\s*\/\s*([\d.]+${UNIT})\s*\[([\d:]+)<([\d:?]+)(?:,\s*([^\]]*?))?\s*\]`).exec(line)
    return m === null ? null : hit(percent(m[1]), `${(m[2] ?? '').trim()}/${(m[3] ?? '').trim()}`, eta(m[5]), rateIn(m[6]))
  },
  // tqdm without a total: "1234it [00:05, 246.1it/s]"
  line => {
    const m = /(\d[\d.]*\s*(?:it|[kMG]?B))\s*\[([\d:]+)(?:,\s*([^\]]*))?\]/.exec(line)
    return m === null ? null : hit(null, (m[1] ?? '').replace(/\s+/g, ' '), null, rateIn(m[3]))
  },
  // keras: "120/500 [=====>........] - ETA: 12s - loss: 0.31"
  line => {
    const m = /^\s*(\d+)\/(\d+)\s*\[[=>.]*\]\s*(?:-\s*ETA:\s*(\S+))?/.exec(line)
    return m === null ? null : hit(ratio(m[1], m[2]), `${m[1]}/${m[2]}`, eta(m[3]))
  },
  // pip / rich: "━━━━━━━╸━━━━ 1.2/3.4 MB 5.6 MB/s eta 0:00:01"
  line => {
    const m = /([\d.]+)\/([\d.]+)\s*([kMGT]i?B|it)\s+([\d.]+\s*(?:[kMGT]i?B|it)\/s)(?:\s+eta\s+([\d:]+))?/.exec(line)
    return m === null ? null : hit(ratio(m[1], m[2]), `${m[1]}/${m[2]} ${m[3]}`, eta(m[5]), rateIn(m[4]))
  },
  // git: "Receiving objects:  45% (450/1000), 1.20 MiB | 2.40 MiB/s"
  line => {
    const m = /:\s+(\d{1,3})%\s+\((\d+)\/(\d+)\)(?:,\s*[\d.]+\s*[KMG]iB\s*\|\s*([\d.]+\s*[KMG]iB\/s))?/.exec(line)
    return m === null ? null : hit(percent(m[1]), `${m[2]}/${m[3]}`, null, rateIn(m[4]))
  },
  // wget bar: "model.bin  45%[=====>     ]  1.20G  3.40MB/s  eta 5m 2s"
  line => {
    const m = /(\d{1,3})%\s*\[[=> ]*\]\s+([\d.,]+[KMG]?)\s+([\d.,]+\s*[KMG]?B\/s)(?:\s+(?:eta|in)\s+(.+?))?\s*$/.exec(line)
    return m === null ? null : hit(percent(m[1]), m[2] ?? null, eta(m[4]), rateIn(m[3]))
  },
  // wget dots: "  51200K .......... .......... 45% 3.20M 5s"
  line => {
    const m = /\.{5,}\s+(\d{1,3})%\s+([\d.,]+[KMG])\s+(\S+)\s*$/.exec(line)
    return m === null ? null : hit(percent(m[1]), null, eta(m[3]), `${m[2]}/s`)
  },
  // curl meter: "  45  123M   45 55.6M    0     0  10.2M      0  0:00:12  0:00:05  0:00:07 10.5M"
  line => {
    const m = /^\s*(\d{1,3})\s+([\d.]+[kMGT]?)\s+(\d{1,3})\s+([\d.]+[kMGT]?)\s+\d+\s+\d+\s+[\d.]+[kMGT]?\s+[\d.]+[kMGT]?\s+([\d:-]+)\s+([\d:-]+)\s+([\d:-]+)\s+([\d.]+[kMGT]?)\s*$/.exec(line)
    return m === null ? null : hit(percent(m[1]), `${m[4]}/${m[2]}`, eta(m[7]), `${m[8]}/s`)
  },
  // a training or batch loop: "epoch 3/10", "Step 120 of 500", "эпоха 2 из 5"
  line => {
    const m = /\b(epoch|step|iter(?:ation)?|batch|round|эпоха|шаг|итерация)\b\s*[:=#]?\s*\[?\s*(\d+)\s*(?:\/|of|из)\s*(\d+)/i.exec(line)
    if (m === null) return null
    const word = (m[1] ?? '').toLowerCase()
    const said = word === 'epoch' ? 'эпоха' : word === 'step' ? 'шаг' : word
    return hit(ratio(m[2], m[3]), `${said} ${m[2]}/${m[3]}`)
  },
  // a bracketed count: "[12/100]", "(3/7)"
  line => {
    const m = /[[(]\s*(\d+)\s*\/\s*(\d+)\s*[\])]/.exec(line)
    if (m === null || num(m[2]) < 2) return null
    const f = ratio(m[1], m[2])
    return f === null ? null : hit(f, `${m[1]}/${m[2]}`)
  },
  // a bare percentage, the last on the line: "Downloading… 45.2%"
  line => {
    const all = [...line.matchAll(/(?:^|[^\d.])(\d{1,3}(?:\.\d+)?)\s?%/g)]
    const f = percent(all.at(-1)?.[1])
    return f === null ? null : hit(f)
  },
]

const STAGE_RE = /\b(epoch|эпоха)\b\s*[:=#]?\s*\[?\s*(\d+)\s*(?:\/|of|из)\s*(\d+)/i
const METRIC_RE = /\b(val_loss|eval_loss|train_loss|loss|val_acc|accuracy|acc|perplexity|ppl)\b['"]?\s*[:=]\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?)/gi
/** Progress is looked for this many lines back from the end. */
const LOOK_BACK = 40

/** How far the job got, from the lines its output shows; null when they say nothing. */
export function parseProgress(lines: readonly string[]): JobProgress | null {
  const recent = lines.slice(-LOOK_BACK)
  let primary: Hit | null = null
  for (let i = recent.length - 1; i >= 0 && primary === null; i -= 1) {
    const line = recent[i] ?? ''
    for (const match of MATCHERS) {
      primary = match(line)
      if (primary !== null) break
    }
  }
  let stage: string | null = null
  let metric: string | null = null
  for (let i = recent.length - 1; i >= 0 && (stage === null || metric === null); i -= 1) {
    const line = recent[i] ?? ''
    if (stage === null) {
      const s = STAGE_RE.exec(line)
      if (s !== null) stage = `эпоха ${s[2]}/${s[3]}`
    }
    if (metric === null) {
      const found = [...line.matchAll(METRIC_RE)].at(-1)
      if (found !== undefined) metric = `${(found[1] ?? '').toLowerCase()} ${found[2]}`
    }
  }
  if (primary !== null && stage !== null && primary.count === stage) stage = null
  if (primary === null && stage === null && metric === null) return null
  return { fraction: primary?.fraction ?? null, count: primary?.count ?? null, eta: primary?.eta ?? null, rate: primary?.rate ?? null, stage, metric }
}

// ── Engine texts ──────────────────────────────────────────────────────────────

/** The output file a background launch names in its result text. */
export function outputPathOf(text: string): string | null {
  const said = /Output is being written to:\s*(\S+?\.output)\b/.exec(text)?.[1]
  if (said !== undefined) return said
  return /(\S*[\\/]tasks[\\/][\w-]+\.output)\b/.exec(text)?.[1] ?? null
}

/** The folder a path is in. */
export function dirOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, '')
}

/** The background task id a Bash or Monitor result carries; null for a call that ran to its end. */
export function backgroundIdOf(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null
  const r = result as { backgroundTaskId?: unknown; taskId?: unknown }
  if (typeof r.backgroundTaskId === 'string' && r.backgroundTaskId.length > 0) return r.backgroundTaskId
  if (typeof r.taskId === 'string' && r.taskId.length > 0) return r.taskId
  return null
}

export type TaskEnd = { taskId: string | null; toolUseId: string | null; status: Job['status']; exitCode: number | null }

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)
  return m === null ? null : (m[1] ?? '').trim()
}

/** Every task end a notification text reports: `<task-notification>` blocks, one per task. */
export function parseNotifications(text: string): TaskEnd[] {
  const out: TaskEnd[] = []
  for (const m of text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
    const block = m[1] ?? ''
    const word = (tag(block, 'status') ?? '').toLowerCase()
    const code = /exit code (-?\d+)/i.exec(tag(block, 'summary') ?? '')?.[1]
    const exitCode = code === undefined ? null : Number(code)
    let status: Job['status']
    if (word === 'completed') status = exitCode !== null && exitCode !== 0 ? 'error' : 'ok'
    else if (word === 'failed') status = 'error'
    else if (word === 'killed' || word === 'stopped' || word === 'cancelled') status = 'killed'
    else continue
    out.push({ taskId: tag(block, 'task-id'), toolUseId: tag(block, 'tool-use-id'), status, exitCode })
  }
  return out
}

/** The one output file that appeared since a foreground call began and nobody claims; null while it is not certain. */
export function freshOutput(before: readonly string[], names: readonly string[], claimed: ReadonlySet<string>): string | null {
  const fresh = names.filter(n => n.endsWith('.output') && !before.includes(n) && !claimed.has(n))
  return fresh.length === 1 ? (fresh[0] ?? null) : null
}

/** How the person calls the loop that started a job: 'главный', or the agent's name or type. */
export function agentLabelOf(rows: readonly AgentRow[], agentId: string | null): string {
  if (agentId === null) return 'главный'
  const row = rows.find(r => r.id === agentId)
  if (row === undefined) return 'субагент'
  return row.name ?? row.type
}

// ── Rows ──────────────────────────────────────────────────────────────────────

export type JobStart = {
  id: string
  tool: string
  agentId: string | null
  agentLabel: string
  command: string
  description: string
  intent: string | null
  isBackground: boolean
  before: string[] | null
  timeoutMs: number | null
  now: number
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function newJob(f: JobStart): Job {
  const words = describeJob(f.tool, f.command, f.description)
  return {
    id: f.id,
    taskId: null,
    tool: f.tool,
    agentId: f.agentId,
    agentLabel: f.agentLabel,
    description: clip(oneLine(f.description), JOB_DESCRIPTION_MAX),
    command: clip(oneLine(f.command), COMMAND_MAX),
    kind: words.kind,
    gist: words.gist,
    intent: f.intent,
    isBackground: f.isBackground,
    status: 'run',
    exitCode: null,
    startedAt: f.now,
    endedAt: null,
    outputPath: null,
    before: f.before,
    outputSize: 0,
    outputAt: null,
    progress: null,
    lastLine: null,
    timeoutMs: f.timeoutMs,
    isAnnounced: false,
  }
}

function isEnded(j: Job): boolean {
  return j.status !== 'run'
}

/** Running jobs, and the newest ended ones up to MAX_ENDED. */
export function trimJobs(jobs: readonly Job[]): Job[] {
  const ended = jobs.filter(isEnded).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  const keep = new Set(ended.slice(0, MAX_ENDED).map(j => j.id))
  return jobs.filter(j => !isEnded(j) || keep.has(j.id))
}

/** `/jobs clear`: only what still runs. */
export function clearJobs(jobs: readonly Job[]): Job[] {
  return jobs.filter(j => !isEnded(j))
}

export function applyJobStart(jobs: readonly Job[], f: JobStart): Job[] {
  return trimJobs([...jobs.filter(j => j.id !== f.id), newJob(f)])
}

export type CallEnd = {
  id: string
  now: number
  /** The task the call left running in the background (run_in_background, ctrl+b, a timeout); null when it ran to its end. */
  taskId: string | null
  outputPath: string | null
  status: Job['status']
}

/**
 * The tool call returned. A launch (or a command moved to the background) keeps
 * running under its task id; a call that ran to its end ends, and one that never
 * got long enough to show is dropped.
 */
export function applyCallEnd(jobs: readonly Job[], f: CallEnd): Job[] {
  const job = jobs.find(j => j.id === f.id)
  if (job === undefined || isEnded(job)) return [...jobs]
  if (f.taskId !== null) {
    return jobs.map(j => (j.id === f.id ? { ...j, taskId: f.taskId, isBackground: true, before: null, outputPath: f.outputPath ?? j.outputPath } : j))
  }
  if (!job.isAnnounced && f.now - job.startedAt < LONG_MS) return jobs.filter(j => j.id !== f.id)
  return trimJobs(jobs.map(j => (j.id === f.id ? { ...j, status: f.status, endedAt: f.now, before: null } : j)))
}

/** A task ended by its notification or a TaskStop: matched by task id, or by the call that started it. */
export function applyTaskEnd(jobs: readonly Job[], f: TaskEnd & { now: number }): Job[] {
  return trimJobs(
    jobs.map(j => {
      if (isEnded(j)) return j
      const isIt = (f.taskId !== null && j.taskId === f.taskId) || (f.toolUseId !== null && j.id === f.toolUseId)
      return isIt ? { ...j, status: f.status, exitCode: f.exitCode ?? j.exitCode, endedAt: f.now } : j
    }),
  )
}

/** What one poll read of a job's output: its size, and its tail when it grew. */
export type OutputRead = { id: string; path: string; size: number; tail: string | null }

/** The poll's reads folded in: output size and time, progress, last line, and a background exit. */
export function applyOutput(jobs: readonly Job[], reads: readonly OutputRead[], now: number): Job[] {
  const byId = new Map(reads.map(r => [r.id, r]))
  return trimJobs(
    jobs.map(j => {
      const r = byId.get(j.id)
      if (r === undefined || isEnded(j)) return j
      const grew = r.size !== j.outputSize
      let next: Job = { ...j, outputPath: r.path, outputSize: r.size, outputAt: grew ? now : j.outputAt }
      if (r.tail === null) return next
      const lines = screenLines(r.tail)
      const code = exitCodeOf(lines)
      const shown = code === null ? lines : lines.slice(0, -1)
      next = { ...next, progress: parseProgress(shown) ?? j.progress, lastLine: shown.length > 0 ? clip(shown.at(-1)?.trim() ?? '', LINE_MAX) : j.lastLine }
      if (code !== null && j.isBackground) next = { ...next, status: code === 0 ? 'ok' : 'error', exitCode: code, endedAt: now }
      return next
    }),
  )
}

/** A Monitor past its deadline has ended, notified or not. */
export function applyDeadlines(jobs: readonly Job[], now: number): Job[] {
  return jobs.map(j =>
    !isEnded(j) && j.timeoutMs !== null && j.timeoutMs > 0 && now > j.startedAt + j.timeoutMs + 10_000 ? { ...j, status: 'ok', endedAt: now } : j,
  )
}

export function markAnnounced(jobs: readonly Job[], ids: readonly string[]): Job[] {
  return jobs.map(j => (ids.includes(j.id) ? { ...j, isAnnounced: true } : j))
}

/**
 * Does the tab show it? A running background job at once, a foreground one once long;
 * an ended one for a while if it ever showed (a background job did from its start,
 * even when it ended before a poll could announce it).
 */
export function isShown(j: Job, now: number): boolean {
  if (!isEnded(j)) return j.isBackground || now - j.startedAt >= LONG_MS
  const didShow = j.isAnnounced || j.isBackground || (j.endedAt ?? 0) - j.startedAt >= LONG_MS
  return j.endedAt !== null && now - j.endedAt <= KEEP_ENDED_MS && didShow
}

export function runningShown(jobs: readonly Job[], now: number): Job[] {
  return jobs.filter(j => !isEnded(j) && isShown(j, now))
}

export function endedShown(jobs: readonly Job[], now: number): Job[] {
  return jobs.filter(j => isEnded(j) && isShown(j, now)).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
}

/** Jobs the tab shows now and has not raised itself for yet. */
export function toAnnounce(jobs: readonly Job[], now: number): Job[] {
  return jobs.filter(j => !isEnded(j) && !j.isAnnounced && isShown(j, now))
}

export function needsPoll(jobs: readonly Job[]): boolean {
  return jobs.some(j => !isEnded(j))
}

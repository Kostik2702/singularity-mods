#!/usr/bin/env node
// Sets this machine up with the singularity-mods look in one step, from wherever the repo
// was cloned: the mission-control mod and its Warhammer 40k theme in Claude Code, the
// Claude Code colour theme «Когитатор», and the Ghostty data-slate (palette, brass
// housing shader, aquila). Idempotent: run it again after a move or a pull.
//
//   node tools/install.mjs              install everything
//   node tools/install.mjs --animated   also the living screen: a rolling refresh band,
//                                       breathing phosphor (Ghostty then redraws all the time)
//   node tools/install.mjs --static     back to the still screen (the default)
//   node tools/install.mjs --aquila <url or file>
//                                       the Agents tab's crest from a picture you choose:
//                                       its emblem cut out locally (Python 3 + Pillow) into
//                                       terminal/art/aquila-custom.png, never committed;
//                                       `--aquila none` goes back to the mod's own
//   node tools/install.mjs --servo-skull <url or file>
//                                       a hovering servo-skull on Обряды in place of the cog:
//                                       the picture cut out (imgqa cutout, or the rembg CLI)
//                                       and animated locally into terminal/art/servo-skull/,
//                                       never committed; `--servo-skull none` brings the cog back
//   node tools/install.mjs --purity-seal <url or file>
//                                       a purity seal hanging in the top left corner of Архивы, cut
//                                       out locally into terminal/art/purity-seal.png, never
//                                       committed; `--purity-seal none` takes it down
//   node tools/install.mjs --portrait <rank>=<url or file>   (repeatable)
//                                       a rank's portrait on Легион, hung before its agents'
//                                       cards: inquisitor, techpriest, commissar, arbitrator,
//                                       chronicler, scout, strategist, augur, guardsman, magos,
//                                       servitor, magister (main); cut out locally into
//                                       terminal/art/portraits/, never committed; <rank>=none
//                                       takes one down
//   node tools/install.mjs --no-ghostty Claude Code only (no Ghostty block)
//   node tools/install.mjs --no-windows-terminal  no Windows Terminal fragment
//   node tools/install.mjs --no-wezterm          no WezTerm block
//   node tools/install.mjs --uninstall  take the look off (the mod stays loaded)
//   node tools/install.mjs --dry-run    say what would change, write nothing
//
// What it writes, each file backed up once per run as <file>.bak-<date>:
//   ~/.claude/settings.json (or $CLAUDE_CONFIG_DIR/settings.json):
//     env.CLAUDE_CODE_PLUGIN_DIRS  gains <repo>/mission-control (other folders kept)
//     pluginConfigs.mission-control.options.theme = "warhammer"
//     theme = "custom:mission-control:cogitator" (the one before is kept for --uninstall)
//     statusLine = terminal/claude/statusline.py, the cogitator's instrument strip (the
//       status line before it is kept for --uninstall)
//   the Ghostty config: one marked block that sets the shader and the aquila by this
//     repo's absolute paths and includes terminal/ghostty/cogitator.conf.
//   Windows Terminal (on Windows): a fragment, %LOCALAPPDATA%\Microsoft\Windows Terminal\
//     Fragments\singularity-mods\cogitator.json, adding the «Cogitator» colour scheme and a
//     profile «Когитатор (Claude Code)» that starts claude in the amber housing; your
//     settings.json is never touched, --uninstall deletes the fragment.
//   WezTerm (where it is installed or configured): one marked block in ~/.wezterm.lua (or
//     $WEZTERM_CONFIG_FILE), before `return config`, that applies terminal/wezterm/cogitator.lua:
//     the palette and the brass housing, drawn per window size by tools/make-housing.py
//     (Python 3 with numpy and Pillow).
// Restart Claude Code afterwards (the theme and the plugin folder are read at start) and
// reload Ghostty (cmd+shift+, on macOS, ctrl+shift+, on Linux).

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MOD_DIR = path.join(ROOT, 'mission-control')
const GHOSTTY_DIR = path.join(ROOT, 'terminal', 'ghostty')
const CLAUDE_THEME = 'custom:mission-control:cogitator'
const STATUS_SCRIPT = path.join(ROOT, 'terminal', 'claude', 'statusline.py')
const MOD_THEME = 'warhammer'
const BLOCK_START = '# >>> singularity-mods cogitator >>>'
const BLOCK_END = '# <<< singularity-mods cogitator <<<'
const STAMP = new Date().toISOString().slice(0, 10)

const args = new Set(process.argv.slice(2))
const isDry = args.has('--dry-run')
const isUninstall = args.has('--uninstall')
const withGhostty = !args.has('--no-ghostty')
const withWindowsTerminal = !args.has('--no-windows-terminal')
const withWezTerm = !args.has('--no-wezterm')
// --animated / --static choose; neither keeps what the block already says.
const animatedFlag = args.has('--animated') ? true : args.has('--static') ? false : null
const argv = process.argv.slice(2)
const aquilaAt = argv.indexOf('--aquila')
const aquilaSource = aquilaAt >= 0 ? (argv[aquilaAt + 1] ?? '') : null
const CUSTOM_CREST = path.join(ROOT, 'terminal', 'art', 'aquila-custom.png')
const skullAt = argv.indexOf('--servo-skull')
const skullSource = skullAt >= 0 ? (argv[skullAt + 1] ?? '') : null
const SKULL_DIR = path.join(ROOT, 'terminal', 'art', 'servo-skull')
const sealAt = argv.indexOf('--purity-seal')
const sealSource = sealAt >= 0 ? (argv[sealAt + 1] ?? '') : null
const SEAL_FILE = path.join(ROOT, 'terminal', 'art', 'purity-seal.png')
const PORTRAITS_DIR = path.join(ROOT, 'terminal', 'art', 'portraits')
const RANKS = ['inquisitor', 'techpriest', 'commissar', 'arbitrator', 'chronicler', 'scout', 'strategist', 'augur', 'guardsman', 'magos', 'servitor', 'magister']
const portraitArgs = argv.flatMap((a, i) => (a === '--portrait' && argv[i + 1] !== undefined ? [argv[i + 1]] : []))
const said = []

function say(line) {
  said.push(line)
  console.log(line)
}

function backup(file) {
  if (!fs.existsSync(file)) return
  const to = `${file}.bak-${STAMP}`
  if (fs.existsSync(to)) return
  if (!isDry) fs.copyFileSync(file, to)
  say(`  копия: ${to}`)
}

function write(file, text) {
  if (isDry) return
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

// ── The crest picture you chose ─────────────────────────────────────────────

/** A Python that has Pillow, for tools/make-art.py; null when there is none. */
function pythonWithPillow() {
  for (const bin of [process.env.PYTHON, 'python3', 'python'].filter(Boolean)) {
    try {
      execFileSync(bin, ['-c', 'import PIL'], { stdio: 'ignore' })
      return bin
    } catch {
      // not this one
    }
  }
  return null
}

/**
 * The crest the Agents tab shows: a picture cut out now from `--aquila`, the one cut
 * before (kept on a rerun), or none (the mod's own) after `--aquila none`.
 */
function crestPicture() {
  if (aquilaSource === null) return fs.existsSync(CUSTOM_CREST) ? CUSTOM_CREST : null
  if (aquilaSource === '' || aquilaSource === 'none') {
    if (!isDry && fs.existsSync(CUSTOM_CREST)) fs.rmSync(CUSTOM_CREST)
    say('Аквила: встроенная')
    return null
  }
  const py = pythonWithPillow()
  if (py === null) throw new Error('для --aquila нужен Python 3 с Pillow: python3 -m pip install pillow (или укажи PYTHON=<путь>)')
  say(`Аквила: вырезаю эмблему из ${aquilaSource}`)
  if (!isDry) execFileSync(py, [path.join(ROOT, 'tools', 'make-art.py'), '--from', aquilaSource, '--out', CUSTOM_CREST], { stdio: 'inherit' })
  return CUSTOM_CREST
}

function has(bin, args) {
  try {
    execFileSync(bin, args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** The picture at a URL or path as a PNG in `dir`/src: fetched, then read and saved by Pillow. */
async function pictureAsPng(source, work, py) {
  // A folder of its own: imgqa refuses to write next to (or above) its source.
  const dir = path.join(work, 'src')
  fs.mkdirSync(dir, { recursive: true })
  let file = source
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) throw new Error(`${source}: HTTP ${res.status}`)
    file = path.join(dir, 'source.img')
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  }
  const png = path.join(dir, 'source.png')
  execFileSync(py, ['-c', 'import sys; from PIL import Image; Image.open(sys.argv[1]).convert("RGBA").save(sys.argv[2])', file, png])
  return png
}

/** The subject of `png` on a transparent ground: imgqa cutout (its ML venv), else the rembg CLI. */
function cutOut(png, dir) {
  const out = path.join(dir, 'cut')
  fs.mkdirSync(out, { recursive: true })
  if (has('imgqa', ['--help'])) {
    const venv = process.env.IMGQA_ML_VENV ?? path.join(os.homedir(), 'venvs', 'imgqa-ml')
    execFileSync('imgqa', ['cutout', png, '--out', out, '--json'], { stdio: 'ignore', env: { ...process.env, IMGQA_ML_VENV: venv } })
    const made = fs.readdirSync(out).find(f => f.endsWith('.cutout.png'))
    if (made !== undefined) return path.join(out, made)
  }
  if (has('rembg', ['--help'])) {
    const made = path.join(out, 'cut.png')
    execFileSync('rembg', ['i', png, made], { stdio: 'ignore' })
    return made
  }
  throw new Error('для --servo-skull нужен вырез фона: imgqa с ML-venv или rembg (python3 -m pip install "rembg[cpu,cli]")')
}

/**
 * The servo-skull Обряды shows: frames made now from `--servo-skull`, the ones made
 * before (kept on a rerun), or none (the cog) after `--servo-skull none`.
 */
async function skullFrames() {
  const ready = fs.existsSync(path.join(SKULL_DIR, 'frame-00.png'))
  if (skullSource === null) return ready ? SKULL_DIR : null
  if (skullSource === '' || skullSource === 'none') {
    if (!isDry && fs.existsSync(SKULL_DIR)) fs.rmSync(SKULL_DIR, { recursive: true })
    say('Сервочереп: снят, на «Обрядах» шестерня')
    return null
  }
  const py = pythonWithPillow()
  if (py === null) throw new Error('для --servo-skull нужен Python 3 с Pillow: python3 -m pip install pillow (или укажи PYTHON=<путь>)')
  say(`Сервочереп: вырезаю и оживляю ${skullSource}`)
  if (isDry) return SKULL_DIR
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'servo-skull-'))
  try {
    const cut = cutOut(await pictureAsPng(skullSource, work, py), work)
    execFileSync(py, [path.join(ROOT, 'tools', 'make-art.py'), '--servo-frames', cut, '--out-dir', SKULL_DIR], { stdio: 'inherit' })
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
  return SKULL_DIR
}

/** The purity seal Архивы shows: cut out now, the one cut before, or none after `--purity-seal none`. */
async function sealPicture() {
  if (sealSource === null) return fs.existsSync(SEAL_FILE) ? SEAL_FILE : null
  if (sealSource === '' || sealSource === 'none') {
    if (!isDry && fs.existsSync(SEAL_FILE)) fs.rmSync(SEAL_FILE)
    say('Печать чистоты: снята')
    return null
  }
  const py = pythonWithPillow()
  if (py === null) throw new Error('для --purity-seal нужен Python 3 с Pillow: python3 -m pip install pillow (или укажи PYTHON=<путь>)')
  say(`Печать чистоты: вырезаю ${sealSource}`)
  if (isDry) return SEAL_FILE
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'purity-seal-'))
  try {
    const cut = cutOut(await pictureAsPng(sealSource, work, py), work)
    execFileSync(py, [path.join(ROOT, 'tools', 'make-art.py'), '--seal', cut, '--out', SEAL_FILE], { stdio: 'inherit' })
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
  return SEAL_FILE
}

/**
 * The ranks' portraits: each `--portrait <rank>=<source>` cut out now (or taken down with
 * `none`); the folder when it holds any, else null.
 */
async function rankPortraits() {
  for (const arg of portraitArgs) {
    const at = arg.indexOf('=')
    const rank = at > 0 ? arg.slice(0, at) : ''
    const source = at > 0 ? arg.slice(at + 1) : ''
    if (!RANKS.includes(rank)) throw new Error(`--portrait ${arg}: чин один из ${RANKS.join(', ')}`)
    const file = path.join(PORTRAITS_DIR, `${rank}.png`)
    if (source === '' || source === 'none') {
      if (!isDry && fs.existsSync(file)) fs.rmSync(file)
      say(`Портрет ${rank}: снят`)
      continue
    }
    const py = pythonWithPillow()
    if (py === null) throw new Error('для --portrait нужен Python 3 с Pillow: python3 -m pip install pillow (или укажи PYTHON=<путь>)')
    say(`Портрет ${rank}: вырезаю ${source}`)
    if (isDry) continue
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'portrait-'))
    try {
      const cut = cutOut(await pictureAsPng(source, work, py), work)
      execFileSync(py, [path.join(ROOT, 'tools', 'make-art.py'), '--portrait', cut, '--out', file], { stdio: 'inherit' })
    } finally {
      fs.rmSync(work, { recursive: true, force: true })
    }
  }
  const any = fs.existsSync(PORTRAITS_DIR) && fs.readdirSync(PORTRAITS_DIR).some(f => f.endsWith('.png'))
  return any ? PORTRAITS_DIR : null
}

/** The python that runs the status line: the system one on macOS, else what answers. */
function statusPython() {
  if (process.platform !== 'win32') return fs.existsSync('/usr/bin/python3') ? '/usr/bin/python3' : 'python3'
  if (has('python', ['--version'])) return 'python'
  if (has('py', ['-3', '--version'])) return 'py -3'
  say('  ВНИМАНИЕ: Python 3 не найден (python, py) — статус-строке он нужен: winget install Python.Python.3.12')
  return 'python'
}

// ── Claude Code ─────────────────────────────────────────────────────────────

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude')
}

/** The plugin folders the variable names, split as a path list of this platform. */
function pluginDirs(value) {
  return (value ?? '')
    .split(path.delimiter)
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

function setupClaude(crest, skull, sealFile, portraits) {
  const dir = claudeDir()
  const file = path.join(dir, 'settings.json')
  const statePath = path.join(dir, 'singularity-mods.install.json')
  let settings = {}
  if (fs.existsSync(file)) {
    try {
      settings = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (err) {
      throw new Error(`${file}: не читается как JSON (${err.message}); поправь его и запусти снова`)
    }
  }
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {}
  say(`Claude Code: ${file}`)
  backup(file)

  if (isUninstall) {
    if (typeof settings.statusLine?.command === 'string' && settings.statusLine.command.includes(STATUS_SCRIPT)) {
      if (state.previousStatusLine === undefined || state.previousStatusLine === null) delete settings.statusLine
      else settings.statusLine = state.previousStatusLine
      say('  statusLine ← прежняя')
    }
    const previous = state.previousTheme
    if (settings.theme === CLAUDE_THEME) {
      if (previous === undefined || previous === null) delete settings.theme
      else settings.theme = previous
      say(`  theme ← ${previous ?? '(по умолчанию)'}`)
    }
    const opts = settings.pluginConfigs?.['mission-control']?.options
    if (opts?.theme === MOD_THEME) {
      opts.theme = 'classic'
      say('  mission-control: theme ← classic')
    }
    if (opts !== undefined && 'aquilaImage' in opts) delete opts.aquilaImage
    if (opts !== undefined && 'servoSkull' in opts) delete opts.servoSkull
    if (opts !== undefined && 'puritySeal' in opts) delete opts.puritySeal
    if (opts !== undefined && 'rankPortraits' in opts) delete opts.rankPortraits
    write(file, `${JSON.stringify(settings, null, 2)}\n`)
    if (!isDry && fs.existsSync(statePath)) fs.rmSync(statePath)
    return
  }

  settings.env ??= {}
  const dirs = pluginDirs(settings.env.CLAUDE_CODE_PLUGIN_DIRS).filter(d => path.resolve(d) !== MOD_DIR)
  // A folder of the same mod elsewhere (an old clone) would load it twice: it goes.
  const others = dirs.filter(d => path.basename(path.resolve(d)) !== 'mission-control')
  for (const gone of dirs.filter(d => !others.includes(d))) say(`  убрана старая папка мода: ${gone}`)
  settings.env.CLAUDE_CODE_PLUGIN_DIRS = [...others, MOD_DIR].join(path.delimiter)
  say(`  env.CLAUDE_CODE_PLUGIN_DIRS = ${settings.env.CLAUDE_CODE_PLUGIN_DIRS}`)

  settings.pluginConfigs ??= {}
  settings.pluginConfigs['mission-control'] ??= {}
  settings.pluginConfigs['mission-control'].options ??= {}
  settings.pluginConfigs['mission-control'].options.theme = MOD_THEME
  say(`  mission-control: theme = ${MOD_THEME}`)
  if (crest !== null) {
    settings.pluginConfigs['mission-control'].options.aquilaImage = crest
    say(`  mission-control: aquilaImage = ${crest}`)
  } else delete settings.pluginConfigs['mission-control'].options.aquilaImage
  if (skull !== null) {
    settings.pluginConfigs['mission-control'].options.servoSkull = skull
    say(`  mission-control: servoSkull = ${skull}`)
  } else delete settings.pluginConfigs['mission-control'].options.servoSkull
  if (sealFile !== null) {
    settings.pluginConfigs['mission-control'].options.puritySeal = sealFile
    say(`  mission-control: puritySeal = ${sealFile}`)
  } else delete settings.pluginConfigs['mission-control'].options.puritySeal
  if (portraits !== null) {
    settings.pluginConfigs['mission-control'].options.rankPortraits = portraits
    say(`  mission-control: rankPortraits = ${portraits}`)
  } else delete settings.pluginConfigs['mission-control'].options.rankPortraits

  if (settings.theme !== CLAUDE_THEME) state.previousTheme = settings.theme ?? null
  settings.theme = CLAUDE_THEME
  say(`  theme = ${CLAUDE_THEME}`)

  // The status line: the cogitator's instrument strip; the one it replaces is kept.
  const python = statusPython()
  const command = `${python} "${STATUS_SCRIPT}"`
  const current = settings.statusLine
  if (!(typeof current?.command === 'string' && current.command.includes(STATUS_SCRIPT))) state.previousStatusLine = current ?? null
  settings.statusLine = { type: 'command', command, padding: 0, refreshInterval: current?.refreshInterval ?? 30 }
  say(`  statusLine = ${command}`)
  write(statePath, `${JSON.stringify(state, null, 2)}\n`)
  write(file, `${JSON.stringify(settings, null, 2)}\n`)
}

// ── Ghostty ─────────────────────────────────────────────────────────────────

/** Where Ghostty reads its config on this platform; null where Ghostty does not run. */
function ghosttyConfig() {
  const home = os.homedir()
  if (process.platform === 'darwin') {
    const app = path.join(home, 'Library', 'Application Support', 'com.mitchellh.ghostty', 'config')
    if (fs.existsSync(app)) return app
  }
  if (process.platform === 'win32') return null
  const xdg = process.env.XDG_CONFIG_HOME?.trim() || path.join(home, '.config')
  return path.join(xdg, 'ghostty', 'config')
}

function ghosttyBinary() {
  const candidates = ['/Applications/Ghostty.app/Contents/MacOS/ghostty', 'ghostty']
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['+version'], { stdio: 'ignore' })
      return bin
    } catch {
      // not this one
    }
  }
  return null
}

/** The config without our block and without the include line an earlier hand setup added. */
function withoutOurs(text) {
  const out = []
  let inBlock = false
  for (const line of text.split('\n')) {
    if (line.trim() === BLOCK_START) {
      inBlock = true
      continue
    }
    if (line.trim() === BLOCK_END) {
      inBlock = false
      continue
    }
    if (inBlock) continue
    if (/terminal[\\/]ghostty[\\/]cogitator\.conf/.test(line)) continue
    if (/^#\s*Cogitator \(Warhammer 40k\)/.test(line)) continue
    out.push(line)
  }
  while (out.length > 0 && out.at(-1)?.trim() === '') out.pop()
  return `${out.join('\n')}\n`
}

const quote = p => `"${p.replace(/\\/g, '/')}"`

function setupGhostty() {
  const file = ghosttyConfig()
  if (file === null) {
    say('Ghostty: на этой платформе не ставится, пропускаю')
    return
  }
  say(`Ghostty: ${file}`)
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  if (before.length > 0) backup(file)
  const wasAnimated = before.includes('cogitator-live.glsl')
  const animated = animatedFlag ?? wasAnimated
  let text = withoutOurs(before)
  if (!isUninstall) {
    text += [
      '',
      BLOCK_START,
      '# Managed by singularity-mods tools/install.mjs; --uninstall removes this block.',
      `custom-shader = ${quote(path.join(GHOSTTY_DIR, 'cogitator.glsl'))}`,
      ...(animated ? [`custom-shader = ${quote(path.join(GHOSTTY_DIR, 'cogitator-live.glsl'))}`] : []),
      `custom-shader-animation = ${animated}`,
      `background-image = ${quote(path.join(GHOSTTY_DIR, 'aquila.png'))}`,
      `config-file = ?${quote(path.join(GHOSTTY_DIR, 'cogitator.conf'))}`,
      BLOCK_END,
      '',
    ].join('\n')
  }
  write(file, text)
  say(isUninstall ? '  блок когитатора убран' : `  блок когитатора записан${animated ? ' (живой экран)' : ''}`)
  const bin = isDry ? null : ghosttyBinary()
  if (bin !== null) {
    try {
      execFileSync(bin, ['+validate-config', `--config-file=${file}`], { stdio: 'pipe' })
      say('  ghostty +validate-config: ok')
    } catch (err) {
      say(`  ghostty +validate-config: ОШИБКА\n${String(err.stdout ?? '')}${String(err.stderr ?? '')}`)
      process.exitCode = 1
    }
  }
}

// ── Windows Terminal ────────────────────────────────────────────────────────

const WT_DIR = path.join(ROOT, 'terminal', 'windows-terminal')
/** The profile's id: fixed, so a rerun updates the same profile. */
const WT_GUID = '{6f1c5a2e-7d43-4c8b-9a1e-40c0e7a1e540}'

/** Where Windows Terminal reads fragments; null off Windows (WT_FRAGMENTS_DIR overrides, for a test). */
function wtFragmentsDir() {
  if (process.env.WT_FRAGMENTS_DIR) return process.env.WT_FRAGMENTS_DIR
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return null
  return path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows Terminal', 'Fragments')
}

/** Is a font of this family installed (the system's fonts and the user's own)? */
function hasFont(prefix) {
  const dirs = [path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts'), path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Windows', 'Fonts')]
  return dirs.some(dir => {
    try {
      return fs.readdirSync(dir).some(f => f.toLowerCase().startsWith(prefix))
    } catch {
      return false
    }
  })
}

/** The fragment: the Cogitator scheme (the palette of cogitator.conf) and the Когитатор profile. */
function wtFragment(fontFace) {
  return {
    schemes: [
      {
        name: 'Cogitator',
        background: '#0E0A05',
        foreground: '#F2B04A',
        cursorColor: '#FFD27A',
        selectionBackground: '#5A3F12',
        black: '#0E0A05',
        red: '#E8452F',
        green: '#A5B84E',
        yellow: '#FFBF4D',
        blue: '#6B93C9',
        purple: '#AB84C4',
        cyan: '#8FB8A0',
        white: '#E09A2E',
        brightBlack: '#5A4220',
        brightRed: '#FF6A4D',
        brightGreen: '#C4D65A',
        brightYellow: '#FFD27A',
        brightBlue: '#8FB0E0',
        brightPurple: '#C8A0E0',
        brightCyan: '#B0D8C0',
        brightWhite: '#FFF0C8',
      },
    ],
    profiles: [
      {
        guid: WT_GUID,
        name: 'Когитатор (Claude Code)',
        commandline: 'powershell.exe -NoLogo -NoExit -Command claude',
        startingDirectory: '%USERPROFILE%',
        icon: path.join(ROOT, 'terminal', 'art', 'aquila-crest.png'),
        colorScheme: 'Cogitator',
        ...(fontFace === null ? {} : { font: { face: fontFace, size: 13 } }),
        padding: '44, 40',
        cursorShape: 'filledBox',
        tabColor: '#8A6A32',
        backgroundImage: path.join(ROOT, 'terminal', 'ghostty', 'aquila.png'),
        backgroundImageOpacity: 0.1,
        backgroundImageAlignment: 'bottomRight',
        backgroundImageStretchMode: 'none',
        'experimental.pixelShaderPath': path.join(WT_DIR, 'cogitator.hlsl'),
      },
    ],
  }
}

function setupWindowsTerminal() {
  const dir = wtFragmentsDir()
  if (dir === null) return
  const file = path.join(dir, 'singularity-mods', 'cogitator.json')
  say(`Windows Terminal: ${file}`)
  if (isUninstall) {
    if (!isDry && fs.existsSync(file)) fs.rmSync(file)
    say('  фрагмент когитатора убран')
    return
  }
  const meslo = process.platform === 'win32' ? hasFont('meslolgs') : true
  if (!meslo) say('  ВНИМАНИЕ: шрифт MesloLGS Nerd Font не найден — значки ✠ ☩ ⌬ ℑ могут рисоваться неверно. Поставь: https://github.com/romkatv/powerlevel10k#manual-font-installation')
  write(file, `${JSON.stringify(wtFragment(meslo ? 'MesloLGS Nerd Font Mono' : null), null, 2)}\n`)
  say('  фрагмент записан: профиль «Когитатор (Claude Code)» и схема «Cogitator» (перезапусти Windows Terminal)')
}

// ── WezTerm ─────────────────────────────────────────────────────────────────

const LUA_START = '-- >>> singularity-mods cogitator >>>'
const LUA_END = '-- <<< singularity-mods cogitator <<<'

/** Where WezTerm reads its config here; null when WezTerm is neither configured nor installed. */
function weztermConfig() {
  const env = process.env.WEZTERM_CONFIG_FILE?.trim()
  if (env) return env
  const home = path.join(os.homedir(), '.wezterm.lua')
  if (fs.existsSync(home)) return home
  const xdg = path.join(process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config'), 'wezterm', 'wezterm.lua')
  if (fs.existsSync(xdg)) return xdg
  const installed =
    has('wezterm', ['--version']) ||
    (process.platform === 'win32' && fs.existsSync(path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'WezTerm', 'wezterm.exe'))) ||
    fs.existsSync('/Applications/WezTerm.app')
  return installed ? home : null
}

/** The absolute path of a Python with numpy and Pillow, for tools/make-housing.py; null when none. */
function pythonWithNumpy() {
  const tries = [[process.env.PYTHON], ['python3'], ['python'], ['py', '-3']].filter(t => t[0])
  for (const [bin, ...pre] of tries) {
    try {
      const out = execFileSync(bin, [...pre, '-c', 'import sys, numpy, PIL; print(sys.executable)'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      const exe = out.trim().split(/\r?\n/).at(-1)
      if (exe) return exe
    } catch {
      // not this one
    }
  }
  return null
}

/** The config without our block. */
function withoutOurLua(text) {
  const out = []
  let inBlock = false
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === LUA_START) {
      inBlock = true
      continue
    }
    if (line.trim() === LUA_END) {
      inBlock = false
      continue
    }
    if (!inBlock) out.push(line)
  }
  return out.join('\n')
}

const luaString = p => JSON.stringify(p.replace(/\\/g, '/'))

function setupWezTerm() {
  const file = weztermConfig()
  if (file === null) return
  say(`WezTerm: ${file}`)
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  let text = withoutOurLua(before)
  if (isUninstall) {
    if (before.includes(LUA_START)) {
      backup(file)
      write(file, text)
    }
    say('  блок когитатора убран')
    return
  }
  const py = pythonWithNumpy()
  if (py === null) say('  ВНИМАНИЕ: нет Python 3 с numpy и Pillow — латунный корпус не нарисуется: python -m pip install numpy pillow')
  const block = [
    LUA_START,
    '-- Managed by singularity-mods tools/install.mjs; --uninstall removes this block.',
    '-- The data-slate: the Cogitator palette and the brass housing under the text (terminal/wezterm/cogitator.lua).',
    `dofile(${luaString(path.join(ROOT, 'terminal', 'wezterm', 'cogitator.lua'))}).apply(config, {`,
    `  root = ${luaString(ROOT)},`,
    `  python = ${luaString(py ?? 'python')},`,
    '})',
    LUA_END,
  ].join('\n')
  if (text.trim() === '') {
    text = ["local wezterm = require 'wezterm'", 'local config = wezterm.config_builder()', '', block, '', 'return config', ''].join('\n')
  } else {
    // The block goes right before the config is returned, so the slate has the last word.
    const lines = text.split('\n')
    const at = lines.findLastIndex(line => /^\s*return\s+config\s*$/.test(line))
    if (at < 0) {
      say(`  ВНИМАНИЕ: в ${file} нет строки «return config» — вставь блок перед возвратом конфига сам:\n${block}`)
      process.exitCode = 1
      return
    }
    let pos = at
    while (pos > 0 && lines[pos - 1]?.trim() === '') {
      lines.splice(pos - 1, 1)
      pos -= 1
    }
    lines.splice(pos, 0, '', block, '')
    text = lines.join('\n')
  }
  if (before.length > 0) backup(file)
  write(file, text)
  say('  блок когитатора записан: палитра и латунный корпус (новые окна WezTerm подхватят его сами)')
}

try {
  if (!fs.existsSync(path.join(MOD_DIR, '.claude-plugin', 'plugin.json'))) throw new Error(`нет мода в ${MOD_DIR}`)
  setupClaude(
    isUninstall ? null : crestPicture(),
    isUninstall ? null : await skullFrames(),
    isUninstall ? null : await sealPicture(),
    isUninstall ? null : await rankPortraits(),
  )
  if (withGhostty) setupGhostty()
  if (withWindowsTerminal) setupWindowsTerminal()
  if (withWezTerm) setupWezTerm()
  say('')
  say(isDry ? 'Пробный прогон: ничего не записано.' : 'Готово. Перезапусти Claude Code и перечитай конфиг Ghostty (cmd+shift+, / ctrl+shift+,).')
} catch (err) {
  console.error(`install: ${err.message}`)
  process.exitCode = 1
}

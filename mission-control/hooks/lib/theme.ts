// The look of the tabs: palette, glyphs, rules and the words they are labelled with.
// Pure data; `themeOf` picks one by the `theme` option of the plugin's userConfig.
// Only labels the mod writes itself are themed; what an agent or a command said
// (its task, reason, report, output) is shown as it came.

import type { AgentPhase, JobKind } from '../../types'
import { COLORS } from './viz'

export type Palette = { [K in keyof typeof COLORS]: string }

type Forms = readonly [string, string, string]

/** What the turn is doing, as the engine's spinner names it. */
export type SpinnerMode = 'requesting' | 'responding' | 'thinking' | 'tool-input' | 'tool-use'

/**
 * A data-slate: every element of a tab drawn as a panel of its own (frames with name
 * plates, a crest, a status strip, gauges, key caps), and the transcript dressed to
 * match. Only the words a slate writes itself live here.
 */
export type Slate = {
  /** The frame colour: brass bezels around every panel. */
  frame: string
  /** The inverse status strip under each tab's crest: its left plate. */
  strip: { agents: string; jobs: string; memory: string }
  /** The feed's panel plate, and the code stamped on its bottom edge. */
  feed: string
  feedCode: string
  /** The jobs pointer plate on the agents tab. */
  jobsPlate: string
  /** The hero dial's plate on the memory tab. */
  memPlate: string
  /** Plates of the transcript's rows: the person's prompt, a reply block, a slash command's output, a notification. */
  user: string
  reply: string
  command: string
  notice: string
  /** The spinner's words per mode; each a phrase drawn instead of the engine's sampled word. */
  spinner: Record<SpinnerMode, string>
  /** The line that closes a turn: «☩ Обряд свершён · 12с ☩». */
  turnDone: string
  /** Added after the hint under the prompt, idle and while a turn runs. */
  hintIdle: string
  hintWorking: string
  /** The run-in-background pill: what replaces "to run in background". */
  backgroundHint: string
  /**
   * Imperial ranks by agent type (its lower case): the title and the heraldic mark a card,
   * a feed line and a summoning rite show; a type with none shows as it came.
   */
  ranks: Record<string, { title: string; icon: string }>
}

export type Theme = {
  id: ThemeId
  /** Null draws the plain look: rules and rows. A slate frames every element. */
  slate: Slate | null
  colors: Palette
  /** Pane titles, as the engine draws them on the tab. */
  titles: { agents: string; jobs: string; memory: string }
  /** A centred motto above each tab's body; null draws none. */
  banner: { agents: string; jobs: string; memory: string } | null
  /** Section heading: `lead` + title + `mark`, then `fill` to the width. */
  rule: { lead: string; mark: string; fill: string }
  /** Agent tree connectors, each two cells. */
  tree: { branch: string; last: string; stem: string }
  icons: {
    phase: Record<AgentPhase, string>
    silent: string
    /** A call that runs now, in the feed and on an agent's "now" line. */
    run: string
    ok: string
    error: string
    denied: string
    /** Marks the agent whose transcript is open beside the tab. */
    viewed: string
    /** A running long action, and the pointer to them on the agents tab. */
    job: string
    jobs: string
    warn: string
  }
  words: {
    main: string
    phase: Record<AgentPhase, string>
    silent: string
    task: string
    why: string
    outcome: string
    gist: string
    starting: string
    waitingLong: string
    thinking: string
    waitsForYou: string
    notStarted: string
    feed: string
    feedEmpty: string
    jobsRunning: Forms
    jobsPointer: string
    kinds: Record<JobKind, string>
    jobOk: string
    jobError: string
    jobKilled: string
    jobsEnded: string
    jobsNone: string
    jobsHead: Forms
    memHero: string
    memSections: { sources: string; cache: string; search: string; turns: string; window: string; vault: string }
    band: string
  }
}

export const THEME_IDS = ['classic', 'warhammer'] as const
export type ThemeId = (typeof THEME_IDS)[number]

/** The look the mod always had: every label and glyph as before themes existed. */
export const CLASSIC: Theme = {
  id: 'classic',
  slate: null,
  colors: COLORS,
  titles: { agents: 'Агенты', jobs: 'Процессы', memory: 'Память' },
  banner: null,
  rule: { lead: '── ', mark: '', fill: '─' },
  tree: { branch: '├─', last: '└─', stem: '│ ' },
  icons: {
    phase: { starting: '◌', thinking: '◌', acting: '●', waiting: '◷', idle: '○', done: '✓', failed: '✖', aborted: '⊘', denied: '⊘' },
    silent: '?',
    run: '◌',
    ok: '✓',
    error: '✖',
    denied: '⊘',
    viewed: '▶',
    job: '●',
    jobs: '◷',
    warn: '⚠',
  },
  words: {
    main: 'главный',
    phase: {
      starting: 'запуск',
      thinking: 'думает',
      acting: 'работает',
      waiting: 'ждёт',
      idle: 'между ходами',
      done: 'готов',
      failed: 'ошибка',
      aborted: 'прерван',
      denied: 'отклонён',
    },
    silent: 'нет вестей',
    task: 'задача',
    why: 'зачем',
    outcome: 'итог',
    gist: 'суть',
    starting: 'запускается',
    waitingLong: 'ждёт фоновую работу или одобрение',
    thinking: 'думает',
    waitsForYou: 'ждёт тебя',
    notStarted: 'ещё не начинал',
    feed: 'Лента',
    feedEmpty: 'пока без действий',
    jobsRunning: ['долгий процесс идёт', 'долгих процесса идут', 'долгих процессов идут'],
    jobsPointer: 'вкладка «Процессы», /jobs',
    kinds: {
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
    },
    jobOk: 'готово',
    jobError: 'ошибка',
    jobKilled: 'остановлено',
    jobsEnded: 'Завершены',
    jobsNone:
      'Долгих процессов нет. Здесь появятся фоновые команды и всё, что идёт дольше 5 с: скачивание, обучение, подготовка данных, сборка — с прогрессом, сутью и тем, кто запустил.',
    jobsHead: ['процесс идёт', 'процесса идут', 'процессов идут'],
    memHero: 'токенов из памяти за сессию',
    memSections: { sources: 'Откуда', cache: 'Кэш', search: 'Поиск в памяти', turns: 'Ходы', window: 'Окно', vault: 'Vault' },
    band: 'память ▸ ',
  },
}

/**
 * Warhammer 40,000: a cogitator's amber data-slate. Amber phosphor on a scorched
 * black glass, brass bezels around every panel, scarlet only for failure; a crest,
 * an inverse status strip and a litany above each tab. The series keep four hues
 * toned to the glass (cobalt, rust, olive phosphor, violet), none of them a status
 * colour. Every glyph is a single-cell symbol with no emoji presentation, so no
 * terminal draws it double.
 */
export const WARHAMMER: Theme = {
  id: 'warhammer',
  slate: {
    frame: '#a8823c',
    strip: { agents: 'КОГИТАТОР ЛЕГИОНА', jobs: 'КУЗНЯ МЕХАНИКУС', memory: 'АРХИВ КОГИТАТОРА' },
    feed: 'ВОКС-ЛОГ · ХРОНИКА',
    feedCode: 'ВОКС',
    jobsPlate: 'ОБРЯДЫ',
    memPlate: 'ПРИНЯТО ИЗ АРХИВОВ',
    user: 'ВОЛЯ МАГИСТРА',
    reply: 'ДОНЕСЕНИЕ',
    command: 'ОТВЕТ КОГИТАТОРА',
    notice: '+++',
    spinner: {
      requesting: 'Взываю к ноосфере',
      responding: 'Составляю донесение',
      thinking: 'Внемлю Духу Машины',
      'tool-input': 'Начертываю руны',
      'tool-use': 'Свершаю обряд',
    },
    turnDone: 'Обряд свершён',
    hintIdle: '✠ Омниссия бдит',
    hintWorking: '✠ обряд свершается',
    backgroundHint: 'отослать обряд в фон',
    ranks: {
      investigator: { title: 'Инквизитор', icon: 'ℑ' },
      critic: { title: 'Комиссар', icon: '★' },
      reviewer: { title: 'Комиссар', icon: '★' },
      validator: { title: 'Арбитр', icon: '§' },
      historian: { title: 'Летописец', icon: '✎' },
      explore: { title: 'Скаут', icon: '⌖' },
      plan: { title: 'Стратег', icon: '♜' },
      coder: { title: 'Техножрец', icon: '⌬' },
      'web-implementer': { title: 'Техножрец', icon: '⌬' },
      'web-viewer': { title: 'Авгур', icon: '◎' },
      'general-purpose': { title: 'Гвардеец', icon: '✦' },
      claude: { title: 'Гвардеец', icon: '✦' },
      'claude-code-guide': { title: 'Магос', icon: '⌬' },
      'statusline-setup': { title: 'Сервитор', icon: '⚬' },
    },
  },
  colors: {
    surface: '#0e0a05',
    rule: '#8a6a32',
    track: '#2a1d0c',
    ink: '#ffbf4d',
    ink2: '#e09a2e',
    muted: '#9a7238',
    accent: '#ffd27a',
    hooks: '#6b93c9',
    claudeMd: '#c9612a',
    search: '#a5b84e',
    code: '#ab84c4',
    good: '#c4d65a',
    warning: '#ff9f1c',
    serious: '#ff7a24',
    critical: '#f03a2e',
  },
  titles: { agents: 'Легион', jobs: 'Обряды', memory: 'Архивы' },
  banner: { agents: 'Император защищает', jobs: 'Хвала Омниссии', memory: 'Знание — сила, храни его' },
  rule: { lead: '══ ✠ ', mark: '✠ ', fill: '═' },
  tree: { branch: '╠═', last: '╚═', stem: '║ ' },
  icons: {
    phase: { starting: '✧', thinking: '◈', acting: '✠', waiting: '⧗', idle: '◇', done: '☩', failed: '†', aborted: '⊗', denied: '⊘' },
    silent: '⸮',
    run: '✦',
    ok: '☩',
    error: '†',
    denied: '⊘',
    viewed: '»',
    job: '✠',
    jobs: '⧗',
    warn: '‡',
  },
  words: {
    main: 'Магистр',
    phase: {
      starting: 'пробуждение',
      thinking: 'внемлет Духу Машины',
      acting: 'в бою',
      waiting: 'ждёт',
      idle: 'в бдении',
      done: 'исполнено',
      failed: 'пал',
      aborted: 'отозван',
      denied: 'отвергнут',
    },
    silent: 'вокс молчит',
    task: 'обет',
    why: 'во имя',
    outcome: 'донесение',
    gist: 'суть',
    starting: 'пробуждается',
    waitingLong: 'ждёт обряда или благословения',
    thinking: 'внемлет Духу Машины',
    waitsForYou: 'ждёт твоей воли',
    notStarted: 'ещё не призван',
    feed: 'Хроника',
    feedEmpty: 'хроника пуста',
    jobsRunning: ['обряд свершается', 'обряда свершаются', 'обрядов свершаются'],
    jobsPointer: 'вкладка «Обряды», /jobs',
    kinds: {
      download: 'Приём данных',
      train: 'Наставление духа',
      data: 'Сбор данных',
      eval: 'Суд',
      install: 'Освящение',
      build: 'Ковка',
      test: 'Испытание',
      server: 'Вокс-станция',
      watch: 'Дозор',
      run: 'Обряд',
    },
    jobOk: 'исполнено',
    jobError: 'провал',
    jobKilled: 'прервано',
    jobsEnded: 'Свершённые',
    jobsNone:
      'Обрядов нет. Здесь появятся фоновые команды и всё, что идёт дольше 5 с: приём данных, наставление духа, ковка — с прогрессом, сутью и тем, кто призвал.',
    jobsHead: ['обряд свершается', 'обряда свершаются', 'обрядов свершаются'],
    memHero: 'токенов из архивов за сессию',
    memSections: { sources: 'Источники', cache: 'Кэш когитатора', search: 'Поиск в архивах', turns: 'Летопись ходов', window: 'Предел', vault: 'Либрариум' },
    band: 'архивы ✠ ',
  },
}

const THEMES: Record<ThemeId, Theme> = { classic: CLASSIC, warhammer: WARHAMMER }

/** The theme an option names; anything else (unset, unknown, not a string) is classic. */
export function themeOf(value: unknown): Theme {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(THEMES, value) ? THEMES[value as ThemeId] : CLASSIC
}

/**
 * The theme as a surface draws it: a slate's frames are box-drawing glyphs that line up
 * only in the terminal's one-width cells, so any other surface gets the plain layout in
 * the theme's palette and words.
 */
export function forSurface(theme: Theme, surface: string): Theme {
  return theme.slate === null || surface === 'terminal' ? theme : { ...theme, slate: null }
}

/** An agent type's Imperial rank in a slate, or null: a type with none shows as it came. */
export function rankOf(t: Theme, type: string): { title: string; icon: string } | null {
  const ranks = t.slate?.ranks
  if (ranks === undefined) return null
  const key = type.toLowerCase()
  return Object.prototype.hasOwnProperty.call(ranks, key) ? (ranks[key] ?? null) : null
}

/** "── Title ─────" to `width` cells, in the theme's rule. */
export function themedRule(theme: Theme, title: string, width: number): { lead: string; title: string; tail: string } {
  const { lead, mark, fill } = theme.rule
  const head = `${title} ${mark}`
  return { lead, title: head, tail: fill.repeat(Math.max(0, width - [...lead].length - [...head].length)) }
}

/** "═══ ✠ MOTTO ✠ ═══" centred in `width` cells; null when the theme has no banner. */
export function bannerLine(theme: Theme, which: keyof NonNullable<Theme['banner']>, width: number): string | null {
  if (theme.banner === null) return null
  const text = ` ✠ ${theme.banner[which].toUpperCase()} ✠ `
  const room = Math.max(0, width - [...text].length)
  const left = Math.floor(room / 2)
  return theme.rule.fill.repeat(left) + text + theme.rule.fill.repeat(room - left)
}

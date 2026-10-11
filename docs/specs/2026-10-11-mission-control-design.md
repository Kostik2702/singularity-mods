# Mission control: перенос мода mem-meter в репозиторий и вкладка «Агенты»

- **Дата:** 2026-10-11
- **Владелец решений:** пользователь (ответы в сессии `c8a0a23f`, 2026-10-11)
- **Задача в vault:** `learnings/active/MISSION-CONTROL.md`; предыстория мода — `learnings/active/MEM-METER.md`, `reference/CLAUDE-CODE-CLI-CUSTOMIZATION.md` (раздел mem-meter)
- **Движок:** Claude Code 2.1.296, API модов — `plugin-authoring/types/claude-code.d.ts` этой сборки

## 1. Цель

1. Перенести код мода `mem-meter` (сейчас `C:\Users\Admin\.claude\skills\mem-meter`, skills-dir plugin) в git-репозиторий `E:\Project\singularity-mods`, сделать репозиторий единственным источником и загружать мод оттуда.
2. Добавить в боковую панель вкладку **«Агенты»** (mission control). Она в реальном времени показывает, кто работает (главный агент и каждый субагент), что он делает сейчас и почему.

**Критерий успеха:** во время работы с субагентами по вкладке «Агенты», не открывая транскрипты, можно ответить на три вопроса: кто сейчас работает, какое действие выполняет каждый и с какой целью (задача и последняя реплика). Вкладка «Память» работает как раньше, но без журнала действий.

## 2. Решения

| # | Решение | Кто / источник |
|---|---|---|
| D1 | Загрузка через `CLAUDE_CODE_PLUGIN_DIRS` в блоке `env` файла `~/.claude/settings.json`. Копия `~/.claude/skills/mem-meter` удаляется | владелец, AskUserQuestion 2026-10-11 |
| D2 | Mission control — отдельная вкладка «Агенты» рядом с «Память» (две панели в доке становятся вкладками). Журнал действий переезжает из «Памяти» в «Агенты» | владелец, там же, утверждён макет |
| D3 | «Почему» = задача субагента (`description`, при пустом — начало `prompt`) + последняя фраза видимого текста модели в шаге. Поток thinking не перехватывается | владелец, там же |
| D4 | Один плагин `mission-control` (переименование `mem-meter`) с одной точкой входа `register.tsx`, которая подключает фичи `memory/` и `mission/`; общий код лежит в `lib/` | владелец утвердил дизайн («ок»). Вынуждено двумя проверками (§3) |
| D5 | Репозиторий — локальный git, без удалённого | ASSUMED по утверждённому дизайну |

## 3. Ограничения движка, проверенные пробой (2.1.296, scratchpad)

- **Импорт за пределы папки плагина запрещён.** `claude plugin validate` → exit 1, `cannot import "../../shared/x" … it is outside the plugin's folder`. `claude plugin test` ведёт себя так же. Два плагина в одном репозитории не могут делить код без копирования.
- **Один hooks-модуль на плагин.** `hooks.json` с двумя элементами в `modules` → `names one hooks module per plugin; a second entry is refused`.
- **Хук `turn.step` в форме `async function*` с `yield* next(e)`** проходит `validate`.
- **Несколько панелей в доке рисуются вкладками:** `PaneOpenArgs.title` — «the pane's tab while more than one pane is open».
- **Панель, открытая без запроса человека,** садится от 144 колонок, а если этот id человек уже когда-то открывал сам — от 110. Поэтому id памяти остаётся `mem-meter`: история «человек открывал» сохраняется.

## 4. Источники данных (API 2.1.296)

| Событие / вызов | Поля, которые используются | Назначение |
|---|---|---|
| `agent.spawn` (хук, `await next(e)`) | вход: `tool_use_id`, `description`, `prompt`, `subagentType`, `parentAgentId?`, `model?`, `background`, `isTeammate?`, `workflow?.runId`, `name?`; ответ: `agentId?`, `model`, или `deny` | новая строка агента и место в дереве |
| `turn.step` (async generator) | вход: `turnId`, `index`, `agentId?`; результат `yield* next(e)`: `answer`, `toolUses` | фаза «думает» на время запроса; «зачем» = последняя фраза `answer` |
| `tool.call` без matcher | `tool`, вход инструмента, `tool_use_id`, `agentId?`; результат: `deny`, `isError` | текущее действие агента и лента |
| `turn.complete` | `agentId?`, `answer`, `reason` (`answer`/`aborted`/`refusal`/`error`), `durationMs`, `usage?` | завершение субагента, отчёт; у главного — «ждёт тебя» |
| `prompt.submit` | — | главный начинает ход |
| `$.agent.list()` | `id`, `type`, `description`, `status` (`pending`/`running`/`waiting`/`idle`/`completed`/`failed`/`killed`), `parentId?`, `name?` | сверка статусов и агенты, запущенные до загрузки мода |
| `Pane.view.agentId?` | — | пометка `▶` у агента, чей транскрипт открыт |

Пределы источников:
- Агентов workflow нет в `$.agent.list()`. Их цикл несёт `agentId`, поэтому шаги и инструменты видны.
- Агент с `isolation: 'remote'` не шлёт ни `turn.complete`, ни событий цикла. После 5 минут без событий он показывается как «нет вестей».
- Агенты, запущенные до загрузки мода, известны только из `$.agent.list()`: тип, описание, статус, родитель. Задачи и реплики до загрузки у них нет.

## 5. Архитектура

### 5.1 Раскладка репозитория

```
E:\Project\singularity-mods\
  .gitignore                       **/.claude-plugin/types/  (каталог, который пишет движок)
  README.md                        что это, как загружается, как проверять
  docs/specs/2026-10-11-mission-control-design.md
  mission-control/
    .claude-plugin/plugin.json     name: mission-control, version 0.2.0, types: ./types/index.d.ts
    hooks/hooks.json               { "modules": ["./register.tsx"] }
    hooks/register.tsx             только проводка: session.start, snapshot, registerMemory(on), registerMission(on)
    hooks/state.ts                 все атомы $.state в одном месте
    hooks/lib/viz.ts               палитра, meter, bigText, allocate, sparkline, rule, fmtDur, plural, pct (из mem-meter)
    hooks/lib/actions.ts           describeAction (из mem-meter)
    hooks/lib/parse.ts             разбор вывода mb, оценка токенов, хэш (из mem-meter)
    hooks/memory/hooks.tsx         хуки памяти, команда /mem, полоса над вводом, панель «Память»
    hooks/memory/pane.tsx          drawMemoryPane — чистая функция (бывший pane.tsx без журнала)
    hooks/mission/hooks.tsx        хуки агентов, команда /mc, сверка, тик перерисовки, панель «Агенты»
    hooks/mission/model.ts         чистые функции: редьюсеры AgentRow, lastSentence, taskLine, buildTree, isSilent
    hooks/mission/pane.tsx         drawAgentsPane — чистая функция
    types/index.d.ts               контракт $.state для 'mission-control'
    tests/*.test.ts                тесты (см. §9)
    tsconfig.json                  extends ./.claude-plugin/types/tsconfig.json
```

Правила, перенесённые из MEM-METER:
- в модулях хуков переменную никогда не называют `h`: JSX компилируется в глобальную `h(...)`;
- у каждого `ui.render` есть `.catch`, который рисует текст ошибки вместо пустой колонки.

### 5.2 Переименование: что меняется

| Было (mem-meter) | Станет |
|---|---|
| имя плагина `mem-meter`, ключ `$.state` `'mem-meter'` | `mission-control`, ключ `'mission-control'` |
| инструмент `mcp__mem-meter__snapshot` | `mcp__mission-control__snapshot` (состояние памяти + агентов) |
| панель `mem-meter`, заголовок «Память → контекст» | id `mem-meter` сохраняется, заголовок «Память» (короткий: он становится текстом вкладки) |
| — | панель `agents`, заголовок «Агенты» |
| `/mem` | `/mem` без изменений; новая `/mc` |
| `Action.isAgent: boolean` | `Action.agentId: string \| null` (`null` = главный); признак «агент» выводится из него |

### 5.3 Контракт состояния (новое)

```ts
/** Где сейчас цикл агента. 'silent' не хранится: вычисляется при рисовании (isSilent). */
export type AgentPhase =
  | 'starting'  // agent.spawn ответил, шагов ещё не было
  | 'thinking'  // идёт запрос к модели (turn.step в полёте)
  | 'acting'    // идёт вызов инструмента
  | 'waiting'   // $.agent.list(): ждёт фоновую работу / одобрение плана
  | 'idle'      // главный: ход закончен, ждёт человека; тиммейт: между ходами
  | 'done' | 'failed' | 'aborted' | 'denied'

/** Действие агента сейчас: последнее начатое; после конца остаётся со статусом. */
export type CurrentAction = {
  kind: Action['kind']; run: string; done: string; target: string
  status: Action['status']; startedAt: number; ms: number | null
}

export type AgentRow = {
  id: string               // 'main' | agentId | `denied:<tool_use_id>`
  parentId: string | null  // null только у 'main'; верхний уровень = 'main'
  turn: number             // ход главного, в котором агент запущен
  type: string             // subagentType; у главного — 'главный'
  name: string | null
  description: string      // ≤ 120 символов
  task: string             // taskLine(prompt), ≤ 240
  model: string | null
  isBackground: boolean
  isTeammate: boolean
  workflowRunId: string | null
  phase: AgentPhase
  startedAt: number
  endedAt: number | null
  lastEventAt: number      // для «нет вестей»
  steps: number            // turn.step этого цикла
  tools: number            // tool.call этого цикла
  intent: string | null    // lastSentence(answer последнего шага с текстом), ≤ 160
  current: CurrentAction | null
  report: string | null    // первая содержательная строка answer из turn.complete, ≤ 160
  tokens: number           // сумма usage (input + output + cache read + cache write)
  toolUseId: string | null // tool_use_id вызова Agent у родителя
}
```

Новые ключи в `PluginState['mission-control']`: `agents: AgentRow[]` (не больше 100: при переполнении первыми вытесняются самые старые завершённые). Существующие ключи mem-meter переезжают под новый ключ без изменений, кроме `Action.agentId`.

## 6. Поток данных

### 6.1 Последовательность (sequencediagram.org)

```
title Mission control: путь субагента до вкладки «Агенты»

participant "Модель (главный цикл)" as M
participant "Движок Claude Code" as E
participant "mission/hooks.tsx" as P
participant "$.state agents/actions" as S
participant "Вкладка «Агенты»" as UI

M->E: Agent(subagent_type, description, prompt)
E->P: tool.call {tool: Agent, agentId: —}
P->S: actions += «работает агент …»; main.current, phase=acting
P->E: next(e)
E->P: agent.spawn {description, prompt, subagentType, parentAgentId?}
P->E: next(e)
E-->P: {agentId, model} | {deny}
P->S: agents += AgentRow(phase=starting | denied)
S-->UI: запись атома → перерисовка
loop каждый шаг субагента
  E->P: turn.step {agentId, index}
  P->S: phase=thinking, steps+1
  P->E: yield* next(e)  (поток проходит без изменений)
  E-->P: {answer, toolUses}
  P->S: intent = lastSentence(answer), если answer не пуст
  E->P: tool.call {agentId}
  P->S: phase=acting, current=action, tools+1, actions += action
  P->E: next(e)
  E-->P: result
  P->S: current.status = ok | error | denied, ms
end
E->P: turn.complete {agentId, answer, reason, durationMs, usage}
P->S: phase = done | failed | aborted (тиммейт: idle), report, tokens, endedAt
E-->M: результат Agent
P->S: main.current.status = ok
note over P,S: раз в 2 с, пока есть незавершённые: $.agent.list() → сверка
note over UI: раз в 1 с, пока кто-то работает: $.ui.invalidate('ui.render')
```

### 6.2 Переходы фаз

| Событие | Главный (`id: 'main'`) | Субагент |
|---|---|---|
| `prompt.submit` | `thinking`; `startedAt = now`; `steps`, `tools`, `current` сброшены; `endedAt = null` | — |
| `agent.spawn` → `{agentId}` | — | новая строка `starting`; `parentId = parentAgentId ?? 'main'` |
| `agent.spawn` → `{deny}` | — | строка `denied` с id `denied:<tool_use_id>`, `report = deny` |
| `turn.step` начало | `thinking`, `steps + 1` | то же |
| `turn.step` конец | `intent` из `answer` | то же |
| `tool.call` начало | `acting`, `current`, `tools + 1` | то же |
| `tool.call` конец | `current.status`, `ms` (фаза не меняется до следующего шага) | то же |
| `turn.complete` | `idle`, `endedAt` | `answer` → `done` (тиммейт → `idle`); `aborted` → `aborted`; `error`/`refusal` → `failed`; `report`, `tokens += usage` |
| `$.agent.list()` | — | `completed` → `done`; `failed` → `failed`; `killed` → `aborted`; `idle` → `idle`; `waiting` → `waiting`; `running` при завершённой фазе → `thinking` (возобновление сообщением). Незнакомый id → новая строка из `type`/`description`/`parentId` |
| рисование | — | незавершённая фаза и `now − lastEventAt > 5 мин` → «нет вестей Nм» |

Любое событие агента обновляет `lastEventAt = now`.

### 6.3 Извлечение текста (чистые функции, `mission/model.ts`)

- **`lastSentence(answer)`**:
  1. убрать блоки кода ```` ``` … ``` ````;
  2. снять разметку (`**`, `__`, `#`, `>`, маркеры списков, обратные апострофы) с сохранением текста; ссылки `[x](y)` → `x`;
  3. схлопнуть пробелы;
  4. разбить на фразы по концу предложения (`.`, `!`, `?`, `…`, затем пробел) и по переводам строк;
  5. взять последнюю непустую фразу, обрезать до 160 символов с `…`.

  Пустой результат не затирает прежний `intent`.

  Почему последняя фраза: типичная реплика перед вызовом инструмента — «<вывод>. <что делаю дальше>.». Пример из этой сессии: «Факты собраны. … Проверю, как размещаются панели.»
- **`taskLine(prompt)`**: та же очистка, первые 240 символов от начала первой содержательной строки.
- **`firstLine(answer)`** для `report`: первая содержательная строка после очистки, 160 символов.

## 7. Вкладка «Агенты» (`drawAgentsPane(table, data, cols, rows)`)

Тёмная поверхность и палитра — из `lib/viz.ts`, как у «Памяти» (dataviz-палитра, проверена `validate_palette.js`). Статус всегда показывается значком **и** словом, а не только цветом.

```
● главный · ход 4 · 2м14с
  зачем: «Проверю, как размещаются панели»
  ◌ читаю claude-code.d.ts 12с
├─● investigator · 48с · 12 шагов
│   задача: корень бага в parse.ts
│   зачем: «сверяю вывод mb search с регэкспом»
│   ◌ ищу в файлах «parseSearch»
├─✓ Explore · 31с · 9 шагов — Нашёл 3 места, где…
└─⊘ coder · отклонён
… ещё 4 завершённых раньше
── Лента ───────────────────────────
сейчас ↳investigator ◌ ищу в файлах «parseSearch»
   12с ↳investigator ✓ прочитал parse.ts
   40с главный      ◌ работает агент: investigator
```

- **Дерево:** `buildTree(agents)` раскладывает строки по `parentId` в порядке запуска и рисует соединители `├─ └─ │`. Если родитель неизвестен, строка вешается на `main`.
- **Работающий агент** (`starting`/`thinking`/`acting`/`waiting`) занимает до 4 строк:
  - заголовок: значок, тип (или `name`), время с `startedAt`, число шагов;
  - `задача:` — `description`, при пустом `task`;
  - `зачем:` — `intent`;
  - текущее действие: значок статуса, глагол (`run`, после конца `done`), цель, время.

  В фазе `thinking` без действия четвёртая строка — «◌ думает Nс».
- **Завершённый агент** занимает 1 строку: значок, тип, длительность, шаги, `— report`.
- **Свёртка:** показываются агенты текущего хода главного и все незавершённые. Завершённые агенты прошлых ходов сворачиваются в строку «… ещё N завершённых раньше».
- **Главный:** `thinking`/`acting` — «● главный · ход N · время», `idle` — «○ главный · ждёт тебя · Nм» плюс `зачем:` с последней фразой ответа.
- **Значки фаз:**

  | Фаза | Значок и подпись |
  |---|---|
  | `starting` | `◌` запуск |
  | `thinking` | `◌` думает |
  | `acting` | `●` |
  | `waiting` | `◷` ждёт |
  | `idle` | `○` |
  | `done` | `✓` |
  | `failed` | `✖` ошибка |
  | `aborted` | `⊘` прерван |
  | `denied` | `⊘` отклонён |
  | silent | `?` нет вестей |

  Цвета статусов — `COLORS.good/warning/serious/critical`, нейтральные — `accent/muted`.
- **Метка `▶`** ставится перед агентом, если `e.props.view.agentId === row.id`.
- **Лента** — последние действия всех агентов, новые сверху: возраст (`сейчас`, `12с`, `3м`), метка агента (`главный` / `↳<type>`), значок, глагол, цель. Под ленту отдаются строки, оставшиеся после дерева, но не меньше 3. Панель прокручивается движком.
- **Подвал:** `/mc close · clear · /mem`.

**Перерисовка:**
- каждая запись атома перерисовывает читателей;
- для таймеров `$.clock.every(1000)` вызывает `$.ui.invalidate('ui.render')`, только если есть незавершённый агент или главный в `thinking`/`acting`.

**Сверка:** `$.clock.every(2000)` вызывает `$.agent.list()`, только если есть незавершённые строки. Один раз вызывается при `session.start`.

## 8. Команды, открытие, ошибки

- **`session.start`:**
  - регистрирует `/mem`, `/mc` и инструмент `snapshot`;
  - запускает тики;
  - открывает `agents`, затем `mem-meter` (без `await`, как сейчас; статус размещения пишется в `paneStatus`);
  - вызывает `$.ui.invalidate('ui.render')`.

  ASSUMED: какая вкладка показана первой и в каком порядке идут вкладки — проверяется вживую (§10).
- **`/mc`** открывает вкладку «Агенты». `/mc close` закрывает её. `/mc clear` удаляет завершённые строки агентов и ленту; незавершённые остаются.
- **`/mem`** — без изменений (`close|hide|show|quiet|reset`). `reset` больше не трогает агентов.
- **Ошибки:**
  - пост-обработка в `turn.step` идёт после `yield* next(e)` внутри `try/catch` и всегда возвращает результат: поток модели не может пострадать от ошибки мода;
  - `agent.spawn` и `tool.call` всегда возвращают то, что вернул `next`;
  - `.catch` на `ui.render` обеих панелей рисует «mission-control: панель упала: <причина>».
- **Объём:** в состоянии хранятся только обрезанные строки (задача ≤ 240, реплика/отчёт ≤ 160). Полные `prompt`/`answer` не хранятся. Всё живёт в `$.state` сессии, в `$.store` ничего не пишется.

## 9. Тестирование

**Unit (`claude plugin test`, чистые функции `mission/model.ts`):**
- `lastSentence`: русская и английская фразы, разметка, блок кода, двоеточие на конце, перевод строки, пустой и пробельный ввод, обрезка до 160;
- `taskLine`, `firstLine`;
- `buildTree`: вложенность по `parentId`, сирота уходит под `main`, правильные префиксы `├─ └─ │`, порядок запуска;
- редьюсеры фаз: путь spawn → step → tool → complete; deny; тиммейт → idle; сверка по `$.agent.list()` для всех 7 статусов; вытеснение при 100 строках;
- `isSilent` на границе 5 минут.

**Интеграция (`claude plugin test`, настоящий `$` движка, поверхности `terminal` и `desktop`):**
1. `$.agent.spawn({prompt, description, subagentType: 'investigator'})` (ниже — `on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))`): вкладка «Агенты» показывает `investigator` и `задача: <description>`.
2. `$.turn.step({… agentId: 'a1'})` (ниже — генератор, который возвращает `{answer: '… Сверяю вывод mb search с регэкспом.', toolUses: […]}`): видно «зачем: «Сверяю вывод mb search с регэкспом.»».
3. `$.tool.call({tool: 'Grep', pattern: 'parseSearch', agentId: 'a1'})`: под `investigator` и в ленте видно «поискал в файлах «parseSearch»».
4. `$.turn.complete({agentId: 'a1', reason: 'answer', answer: 'Корень: …'})`: «✓ investigator» и начало отчёта.
5. Главный: `prompt.submit` → шаг → вызов → `turn.complete` без `agentId`: «○ главный · ждёт тебя».
6. Отклонённый spawn: «⊘ coder · отклонён».
7. Вложенность: spawn с `parentAgentId: 'a1'` рисуется под `investigator`.
8. `view: { agentId: 'a1' }`: перед `investigator` стоит `▶`.
9. «Память»: прежние 29 тестов mem-meter зелёные с новыми именами (плагин `mission-control`, id панели `mem-meter`). Журнала «Сейчас · ход» на вкладке «Память» больше нет.

Если тестовый `$` не принимает `agentId` в `tool.call`/`turn.step` (поле помечено Pinned), это фиксируется как находка, а тесты 2–3 переводятся на unit-уровень редьюсеров. Расхождение с этим спеком отмечается в learnings.

**Доказательство, что тесты не пустые** (правило «зелёное ≠ проверенное»): на копии в scratchpad сломать `lastSentence`, `buildTree` и переход `turn.complete → done`. Тесты должны покраснеть; число падений записывается.

**Статика:**
- `claude plugin validate mission-control`;
- `tsc -p mission-control` (strict, `noUncheckedIndexedAccess`; на сломанной копии должен давать exit 2);
- скан всех записанных файлов на управляющие байты (`codePointAt < 32` кроме `\n\r\t`) до коммита.

## 10. Перенос и проверка вживую

1. Коммит 1 — «import mem-meter as-is»: побайтовая копия `~/.claude/skills/mem-meter` в `mission-control/` (без `.claude-plugin/types/`). Это фиксирует происхождение кода.
2. Коммиты 2…N: переименование и раскладка по `lib/`/`memory/`, затем mission control. После каждого шага `validate`, `tsc` и тесты зелёные.
3. `~/.claude/settings.json` → `env.CLAUDE_CODE_PLUGIN_DIRS = "E:\\Project\\singularity-mods\\mission-control"` (правка через скилл update-config / Edit; блока `env` сейчас нет).
4. Удалить `~/.claude/skills/mem-meter`, иначе загрузятся два плагина с разными именами и двумя наборами хуков. Удалить устаревшую `~/.claude/dev-mods/ae945950-0bda-4ab7-9fab-1cb266bc56d8` (TODO владельца от 2026-10-02). Код сохранён в коммите 1.
5. Проверка загрузки без модели: `claude plugin details mission-control` и/или debug-лог новой сессии — `hooks module mission-control@… loaded`, `/mc listed`.
6. Живая проверка в новой интерактивной сессии (перезапуск нужен: `env` читается при старте):
   - запустить субагента `Explore`, затем вызвать `mcp__mission-control__snapshot`, проверить фазы `starting → thinking/acting → done`, `intent` и `report`;
   - проверить порядок вкладок и вкладку по умолчанию;
   - финальная визуальная приёмка — глазами владельца.
7. **Откат:** убрать `CLAUDE_CODE_PLUGIN_DIRS` и вернуть папку из коммита 1 (`git archive <commit> mission-control | tar -x -C ~/.claude/skills/` с возвратом имени `mem-meter`).

## 11. Вне объёма

- Поток thinking (решение D3).
- Чип агентов на полосе над вводом при закрытой вкладке — возможное следующее улучшение.
- Стоимость в долларах по агентам.
- Хранение истории между сессиями (`$.store`).
- Публикация через marketplace.
- Действия над агентами из панели (остановить, написать).

## 12. Риски

| Риск | Мера |
|---|---|
| Хук `turn.step` замедлит или сломает поток модели | только `yield* next(e)` без перебора чанков; пост-обработка в `try/catch`; результат возвращается всегда |
| Перерисовка раз в 1 с нагружает терминал | тик срабатывает только при работающих агентах; когда тихо, перерисовки нет |
| Тестовый `$` не умеет `agentId` / стрим `turn.step` | фолбэк на unit-тесты редьюсеров (§9), расхождение фиксируется |
| Порядок вкладок не тот | проверка вживую; порядок открытия в `session.start` меняется одной строкой |
| Два плагина загрузятся одновременно в переходный период | шаг 4 §10 выполняется до первого живого запуска; проверка `claude plugin list` |

# singularity-mods

Claude Code mods of the Singularity setup. One so far: **mission-control**.

## mission-control

A sidebar for Claude Code with three tabs:

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
- **Процессы** — long actions and how far they got, so a download, a training run or a dataset build is never a black box:
  - what counts: every background command (`run_in_background`, ctrl+b, a command moved to the background by its timeout), every foreground command past 5 s, and every `Monitor`. Background subagents stay on Агенты;
  - for each running one:
    - what it is: a label from the command (Скачивание, Обучение, Подготовка данных, Оценка, Установка, Сборка, Тесты, Сервер, Наблюдение, Команда) and the call's own description;
    - its gist («суть»), from the command: «скачивает model.bin ← huggingface.co», «обучает: train.py»;
    - its reason («зачем»): the last sentence the agent wrote before the call;
    - who started it (главный, or the subagent's name or type), how long it runs, background or foreground;
    - progress read live from its output: a bar with percent, count, time left, rate, epoch, loss, and the last output line. Read formats: tqdm, keras, pip/rich, git, wget, curl, `epoch/step N/M`, `[N/M]`, a bare percent. With no scale in the output it shows the output's size, and flags output silent for two minutes;
  - an ended one folds into «Завершены» with its outcome and exit code, for 30 minutes;
  - the tab comes to the front by itself, with a toast, when a new long action begins (not while you hold a pane's keyboard). Агенты shows «◷ N долгих процессов» as a pointer.
- **Память** — how much context arrives from memory (hook injections, CLAUDE.md, `mb search` / `mb code`), prompt cache, turns, context and limits, vault health. This was the standalone mod `mem-meter` before.

| Command | Does |
|---|---|
| `/mc` | open the Агенты tab |
| `/mc close` | close it |
| `/mc clear` | drop ended agents and the feed of earlier turns |
| `/jobs` | open the Процессы tab |
| `/jobs close · clear` | close it · drop ended jobs |
| `/mem` | open the Память tab |
| `/mem close · hide · show · quiet · reset` | close the tab · hide/show the band above the prompt · soft alerts on/off · reset search and turn counters |

Tool for the model: `mcp__mission-control__snapshot`, the whole state as JSON (agents, feed, jobs, memory figures, pane status).

### Тимлид

Слой для сессии, где лид (Opus) делегирует исполнителям. Живёт в `hooks/lead/`, версия мода 0.4.0. Правила рубрики (кому что отдавать, как писать бриф) — в скиле `team-lead` движка Singularity; мод считает, ограждает и сообщает лиду, но не решает за него.

**Что считается.** Каждый запрос исполнителя пересчитывается в OE (Opus-эквивалент: токены × цена модели / цена входа Opus 5.5; кеш-запись × 1,25). Модель, которой нет в таблице цен (`claude-test`, новый релиз), считается по цене Fable и помечается `?`. Копится по агенту, по прогону workflow и по сессии; запросы лида идут только в сессию. На карточке во вкладке «Агенты» строка «модель: ярус · effort · N OE» (и лимит в `enforce`), в шапке — бюджет сессии и режим.

**Режимы** (`budgetMode` в настройках мода):

- `observe` (по умолчанию) — числа только считаются и попадают в сводку. Ни один запрос и ни один спавн не отклоняется из-за чисел.
- `enforce` — исполнитель, у которого исчерпан бюджет агента, прогона или сессии, останавливается до следующего запроса (идущий запрос не обрывается: превысить лимит может только он), новый спавн отклоняется. Запросы лида не блокируются никогда: он должен суметь спросить владельца.

Лимиты: `agentBudgetOE`, `runBudgetOE`, `sessionBudgetOE`; пусто или `0` — без лимита. Исключение: `fableCap` (вызовов Fable за сессию, по умолчанию 3) — `0` запрещает Fable, неверное значение даёт 3.

**Что действует в обоих режимах** (не зависит от чисел):

- Fable только через `advisor` и только со строкой `ПОЧЕМУ FABLE:` (с текстом) в начале строки промпта; сверх `fableCap` — отказ. Спавн `advisor` без модели считается спавном Fable (в его определении `model: fable`). В workflow Fable всегда переписывается на `opus`. Форк и возобновление не переписываются (движок их модель не читает); форк отмечается в сводке «форк · модель лида».
- Council: промпт с `COUNCIL MISSION`, `PLANNING MISSION` или `SRE MISSION` в начале строки допустим только в ходе, который открыл владелец командой `council`, `planning-council` или `observation-council` (окно переживает конец хода главного и ходы по уведомлениям фоновых членов: оно закрывается следующим собственным промптом владельца — терминал или мост, — который не council-команда, и только если ни один член совета не работает; промпты других источников его не закрывают); внутри окна модель Fable или не указанная становится `opus`. Маркер в середине строки (цитата в прозе) не считается.
- Заморозка владельца (`/mc halt`): новые спавны отклоняются, запросы исполнителей не уходят — в любом режиме.
- Сторож (ниже).
- Для агентов workflow effort ограничивается ярусом сверху: haiku — low, sonnet — medium, opus — high (ниже оставляется как есть, Fable не трогается). Агентам, запущенным через Agent, effort не меняется — это выбор лида.

Любой сбой ограждения пропускает спавн или запрос как есть и один раз пишет строку в сводку.

**Команды** (в `/mc`):

| Команда | Делает |
|---|---|
| `/mc budget` | таблица исполнителей, расход и лимиты |
| `/mc budget +N` | добавить N OE к лимиту сессии (N — целое больше нуля; без заданного `sessionBudgetOE` добавлять не к чему) |
| `/mc halt` | заморозить исполнителей; лиду уйдёт «владелец остановил исполнителей» (снять — `/mc resume`, лиду уйдёт «владелец снял заморозку») |
| `/mc resume` | снять заморозку |
| `/mc solo` | в ближайшей сводке лид получит «делай сам, не делегируй» |

**Инструмент `team`** (`mcp__mission-control__team`, только чтение): таблица «агент · ярус · effort · задача · ходы · OE[/лимит] · состояние», строка бюджета сессии и Fable, затем «новости:» — то, что сводка ещё не доставила (инструмент их не сбрасывает), и «флаги:».

**Сводка лиду.** Только изменения с прошлой сводки: запущен (`запущен: задача · ярус · effort`; ярус или effort, которых ещё не знаем, — «—», а effort при запуске обычно «—»: его узнают по первому запросу исполнителя; спавн не в фоне получает хвост `· не в фоне`), закончил (`закончил: задача · исход · N OE`, исход — готов, ошибка или прерван, N — OE этого прогона, как в журнале недели; по одной строке на прогон, возобновлённый исполнитель закончит ещё раз), напарники (teammates) и конец хода самого лида в сводку не входят, как и в журнал; нет вестей, долгий вызов, 80 % и исчерпание бюджета, отказ, переписанная модель, вызов встроенного советчика, команды владельца. Потолок 600 символов, одинаковые строки сливаются в «×N», обрезается по границе строки с «…и ещё N». Приходит как контекст после пакета инструментов главного и в контекст следующего промпта владельца; слэш-команда сводку не забирает (она остаётся лиду).

**Сторож и пробуждение.**

- Работающий исполнитель без событий 15 минут — «нет вестей N мин». Исполнитель, который ждёт своего идущего вызова, не «молчит».
- Один вызов инструмента дольше 20 минут — «вызов идёт N мин». Вызов короче 20 минут молчанием не считается.
- Пороги — константы (`hooks/lead/config.ts`), не настройки, до данных недели наблюдения. Короткое молчание (нет вывода модели) движок лечит сам перезапуском агента — мод это не дублирует.
- Тревога входит в сводку. Если лид простаивает (последнее событие главного — конец хода), мод будит его через `$.prompt.submit` одной строкой тревоги: не чаще раза на тревогу агента и не чаще раза в 10 минут на сессию. Тревога, пришедшаяся на занятого лида или на паузу между пробуждениями, не теряется: пробуждение придёт позже, как только будет можно.
- Мод агента не останавливает. Решает лид: `TaskStop`, `SendMessage` с вопросом или ждать.

**Журнал недели.** Конец каждого исполнителя (не лида и не бездействующего тиммейта) добавляет одну строку JSON в `lead-journal.jsonl`: `ts, type, tier, effort, turns, oe, ms, outcome` (`type` — subagentType, `tier` — `haiku`/`sonnet`/`opus`/`fable` или `?`, `turns` — шаги модели, `oe` — собственный расход, `ms` — время работы; все три — за последний прогон (от спавна или от возобновления), поэтому возобновлённый исполнитель даёт вторую строку только со своим новым расходом, и сумма строк равна итогу строки агента; `outcome` — `done`/`failed`/`aborted`). Каталог: `CLAUDE_PLUGIN_DATA`, если задан; иначе `<CLAUDE_CONFIG_DIR или ~/.claude>/plugins/data/mission-control/`. У `$.fs` движка нет добавления и есть предел 4 МиБ на чтение и запись, поэтому строка дописывается чтением и записью файла целиком, а ротация — при 3 МиБ: файл становится `lead-journal.1.jsonl` (хранится один предыдущий). Ошибка записи гасится и ход не ломает; одновременные концы выстраиваются в очередь.

Проверка качества за неделю (спека §7) делается вручную, не кодом мода: из журнала выбрать около 20 реальных делегированных задач, один вызов Opus по рубрике оценивает каждую (выполнено ли по критерию готовности · пришлось ли лиду переделывать · лишние ли вызовы; оценка 0–1 и pass/fail). Вместе с OE по ярусам из того же журнала это основание для чисел `enforce`.

**Настройки движка** (`~/.claude/settings.json`, часть 0 спеки) — мод их не дублирует, потому что движок применяет их раньше хука и надёжнее:

| Ключ | Значение | Зачем |
|---|---|---|
| `env.CLAUDE_CODE_SUBAGENT_MODEL` | `sonnet` | спавн без модели (ни вызов, ни скрипт, ни frontmatter) идёт на Sonnet, а не на модель лида |
| `env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` | `8` | предел одновременных субагентов |
| `env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` | `2` | исполнитель может позвать помощника, помощник — нет |
| `workflowSizeGuideline` | `small` | workflow меньше 5 агентов, если задача не требует иного |
| `advisorModel` | не задавать | иначе советчик уходит с Fable |
| `env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, `env.CLAUDE_CODE_EFFORT_LEVEL` | не задавать | иначе выбор лида (и ограждение мода) игнорируется |

`env` читается при старте процесса: проверять в сессии, запущенной после правки. Если сессия принудительно задаёт одну модель всем субагентам, она старше хука.

**Встроенный советчик.** Наблюдение 2026-10-18: в запросе каждого субагента есть серверный инструмент `advisor_20260301` на `claude-opus-5-5` (отложенная загрузка) даже при незаданном `advisorModel`. Мод его не может ни запретить, ни ограничить `fableCap` — это не спавн, `agent.spawn` не вызывается. Мод только сообщает: вызов такого инструмента попадает в сводку строкой «советчик вызван». Отключить инструмент можно только настройкой движка, если такая найдётся.

**Известные пределы.**

- Первый шаг исполнителя может прийти раньше, чем строка его спавна подтвердилась: этот один запрос не блокируется по бюджету и не получает потолок effort (запрос шага не несёт ни id прогона, ни id вызова); его расход при этом считается. Новые спавны исчерпанного прогона или сессии спавн-ограждение отклоняет.
- Параллельные `advisor` могут превысить `fableCap` на число одновременно идущих: счётчик читается при решении и растёт после.
- Council внутри workflow не ловится (промпт агента workflow может быть заглушкой) — только правило рубрики.
- Прогон без заданных лимитов ничего не блокирует: `enforce` без чисел равен `observe`.

### Theme

The look is an option, `theme`, in the plugin's `userConfig`. Set it in `/config` → mission-control → «Оформление». A change there reloads the mod, and the open tabs reopen under the new titles.

| Value | Look |
|---|---|
| `classic` (default) | the dark palette and labels above |
| `warhammer` | Warhammer 40k, a cogitator's amber data-slate:<br>• palette: amber phosphor on scorched black glass, brass bezels, scarlet for failure;<br>• each element a panel of its own: the aquila crest (a detailed picture where the terminal draws pictures, Ghostty and kitty; block glyphs elsewhere), an instrument block (a Mechanicus cog that turns while agents work, or on Обряды while a rite runs; the litany; an inverse status strip; the Machine Spirit's or the furnace's state with a lamp; a crawl of binaric cant; the Imperial date, «0 789 026.M3»), a purity seal hanging off Магистр's card, main in a double frame `╔═╡ ✠ МАГИСТР ╞═╗`, each subagent in a heavy frame on its branch of the tree, the vox-log of calls, each rite a card with a gauge `▕████▒▒▒▏`, each archive section a reliquary with a stamp, the commands as key caps;<br>• the tabs are «✠ ЛЕГИОН», «⌬ ОБРЯДЫ», «✎ АРХИВЫ»; main is «Магистр»; labels «обет», «во имя», «донесение»; jobs «Ковка», «Освящение», «Дозор»;<br>• the transcript too (terminal only): your prompt in an amber frame `┫ ✠ ВОЛЯ МАГИСТРА ┣`, each reply block in a brass frame `╡ ✠ ДОНЕСЕНИЕ ╞` with `✠` before headings, `⁜` before list items and `‡` before quotes (code and tables untouched), each tool call a rite in a thin frame with its kind and state, the spinner in the cogitator's words, «☩ Обряд свершён · 12с» with a litany at the end of a turn |

A theme changes only what the mod writes itself: colours, glyphs, frames, headings and labels. What an agent or a command said (task, reason, report, output) is shown as it came; in the transcript a reply's marks are added to the drawing, never to the stored message. A slate's frames line up only in the terminal's one-width cells, so the desktop app draws the plain layout in the theme's palette. The engine's own system lines (a plugin's «reloaded», the «※ recap») have no render site a plugin can hook: the colour theme below colours them, nothing more. Every theme glyph is one narrow cell with no emoji presentation; `tests/theme.test.ts` holds that.

A new theme is one more entry in `hooks/lib/theme.ts` (a `Theme`: palette, titles, banner, rule, tree, icons, words, and a `slate` for the framed look or `null` for the plain one) and its name in `plugin.json` → `userConfig.theme.options`.

Two more pieces finish the warhammer look, outside the mod's own drawing:

| Piece | Where | Does |
|---|---|---|
| Claude Code colour theme «Когитатор» | `mission-control/themes/cogitator.json`, shipped with the plugin; its id is `custom:mission-control:cogitator` | the colours of everything the engine draws itself: text, the prompt's border, permission and question dialogs, toasts, diffs, the background of your messages |
| Ghostty data-slate | `terminal/ghostty/`: `cogitator.conf` (palette, padding), `cogitator.glsl` (the shader), `cogitator-live.glsl` (the living screen, opt-in), `aquila.png` (from `tools/make-aquila.py`) | amber glass, scanlines and a phosphor glow, and around the glass a brass housing drawn in the window's padding: bevel, gilt trim, rivets, a cross medallion in each corner, a Mechanicus hazard band. With `--animated`, a refresh band rolls down the glass and the phosphor breathes (Ghostty then redraws all the time). Ghostty has no per-window profile, so it applies to every Ghostty window |
| Ranks, heresy, the thought for the day | the mod, warhammer only | agents are called by their Imperial ranks (ℑ Инквизитор, ★ Комиссар, ⌬ Техножрец, ⌖ Скаут…, the type kept after it); a failed rite reads «‡ ЕРЕСЬ ОБНАРУЖЕНА» in a heavy scarlet frame, a refused one «⊘ ОТВЕРГНУТО МАГИСТРОМ», a cut one «⊗ ОБРЯД ПРЕРВАН»; under Легион's instruments, a thought for the day (72 of the mod's own, one a day) |
| The warp's taint | the mod and the status line | from 80% of the context: the Archives' dial turns scarlet under «‡ ВАРП-ПОРЧА · ДУХ ПЕРЕГРУЖЕН», Легион's Machine Spirit reads «ПЕРЕГРУЖЕН» and its binaric cant breaks into noise, the status line's ДУХ МАШИНЫ plate turns scarlet: time to compact |
| The awakening | the band above the prompt | for 4.5 s after the session starts, the cogitator's boot: «+++ ИНИЦИАЦИЯ ДУХА МАШИНЫ +++», a gauge, the log's steps, «✠ ОМНИССИЯ БЛАГОСЛОВЛЯЕТ ✠» |
| The herald | the band above the prompt, while the conversation is empty | the slate's own card under the engine's logo (which has no render site a mod can restyle): the aquila (a picture, or a block mosaic), then «✠ КОГИТАТОР ИМПЕРИУМА ✠» in a double frame: the version, the model, the project and its branch (read from `.git/HEAD`, no git process), the vault's alarms, the quota, the commands, the Imperial date. The awakening's gauge plays on its strip; once the first prompt is sent the band goes back to Архивы. A short band keeps the card and leaves the aquila out |
| Sounds | `mission-control/sounds/*.wav`, synthesized by `tools/make-sounds.py` (this project's own) | the awakening's arpeggio, a vox chirp when a main turn ends, a servo's whir when a long rite begins, a choir's chord when it is done, a klaxon when it fails. The `sound` option (`/config` → «Звук когитатора»): `off`, `quiet` (default), `full`. macOS plays them (`afplay`); Linux and Windows terminals have no player and stay silent |
| Status line | `terminal/claude/statusline.py` (Python 3.9+, no dependencies) | the two lines under the prompt as an instrument strip: each section opens on a brass plate (the model on the amber one; ДУХ МАШИНЫ, the context; ЛИМИТЫ, the plan's windows with reset times; ДЕСЯТИНА, the cost), its figures follow in amber, gauges are solid two-tone bars; amber at rest, orange to watch, scarlet to act. The band above the prompt follows the same manner (АРХИВЫ, ‡ ТРЕВОГИ). The hint line under it speaks the cogitator's words too («правки дозволены», «shift+tab — сменить», «esc — прервать обряд») |
| Pixel art | `terminal/art/aquila-crest.png`, embedded in `hooks/lib/art.ts` by `tools/make-art.py` | the mod's own aquila on the Agents tab: drawn here in the emblem's manner, not a copy of any artwork |
| A crest you choose | the `aquilaImage` option: a PNG path | any emblem picture instead of the mod's own. `node tools/install.mjs --aquila <url or file>` cuts the emblem out of the picture (a gold or amber emblem on a dark ground: its own pixels kept, the ground made transparent, padded to 3 : 1; Python 3 with Pillow) into `terminal/art/aquila-custom.png` and points the option at it. That file is git-ignored on purpose: someone else's artwork stays on your machine and is never committed; run the same command on each machine. `--aquila none` goes back to the mod's own |
| A servo-skull you choose | the `servoSkull` option: a folder of frames | a servo-skull on Обряды in place of the cog, hovering, swaying a little, its optics pulsing, whenever the tab is on screen (pictures only: Ghostty, kitty; elsewhere the cog). `node tools/install.mjs --servo-skull <url or file>` cuts the picture out (`imgqa cutout` with its ML venv, or the `rembg` CLI: `python3 -m pip install "rembg[cpu,cli]"`), animates it into `terminal/art/servo-skull/frame-00.png …` (git-ignored, like the crest) and sets the option. `--servo-skull none` brings the cog back |
| A purity seal you choose | the `puritySeal` option: a PNG | a purity seal hanging in the top left corner of Архивы, as tall as every block down to the vault (Либрариум) and as wide as its 5 : 24 picture asks, at most a third of the column; the blocks stand beside it, laid out to the room it leaves (pictures only). `node tools/install.mjs --purity-seal <url or file>` cuts it out as for the servo-skull and pads it to 5 : 24 into `terminal/art/purity-seal.png` (git-ignored). `--purity-seal none` takes it down |
| Ranks' portraits you choose | the `rankPortraits` option: a folder of `<rank>.png` | a portrait hung on the tree's branch before each agent's card of that rank on Легион, 6 x 3 cells (pictures only); the ranks are `inquisitor`, `techpriest`, `commissar`, `arbitrator`, `chronicler`, `scout`, `strategist`, `augur`, `guardsman`, `magos`, `servitor`, and `magister` for main. `node tools/install.mjs --portrait <rank>=<url or file>` (repeatable) cuts each out and pads it square into `terminal/art/portraits/` (git-ignored); `<rank>=none` takes one down; a rank with none keeps its plain card |

`node tools/install.mjs` puts all three in place (see Install).

How Процессы sees a job (probed live 2026-10-14; the engine has no list of background shells for a plugin):
- every Bash call, foreground included, writes its output as it goes to `<tmp>/claude-<uid>/<cwd slug>/<session id>/tasks/<id>.output`. The folder is found once per session by the session id under the temp roots, or learned from the first background launch's result;
- a background job's file is named in its launch result; a foreground call's is the one new file since it began, attached only when exactly one is new;
- the end: the `[exited with code N]` line the engine appends to a background output, the task's notification (`prompt.submit`, origin `task-notification`), a `TaskStop`, a monitor's deadline, or the call's own return for a foreground command;
- the files are polled once a second while a job runs: a stat, and the last 8 KB only when the file grew (`tail -c` above 1 MB).

### Install

On any machine, from wherever the repo is cloned (Node 18+):

```bash
node tools/install.mjs              # the mod, its warhammer theme, the «Когитатор» colours, the Ghostty slate
node tools/install.mjs --animated   # also the living screen: a rolling refresh band, breathing phosphor
node tools/install.mjs --static     # back to the still screen (the default; a run with neither keeps the last choice)
node tools/install.mjs --aquila <url or file>  # the Agents tab's crest from a picture you choose (see below)
node tools/install.mjs --servo-skull <url or file>  # a hovering servo-skull on Обряды in place of the cog (see below)
node tools/install.mjs --purity-seal <url or file>  # a purity seal hanging in the top left corner of Архивы (see below)
node tools/install.mjs --portrait inquisitor=<url or file>  # a rank's portrait on Легион (repeatable; see below)
node tools/install.mjs --no-ghostty # no Ghostty block (Windows: Ghostty is skipped by itself)
node tools/install.mjs --no-wezterm # no WezTerm block (--no-windows-terminal: no Windows Terminal fragment)
node tools/install.mjs --dry-run    # say what would change, write nothing
node tools/install.mjs --uninstall  # take the look off; the mod stays loaded, in classic
```

It backs up each file it touches as `<file>.bak-<date>` and is safe to run again after a move or a pull. It writes:
- `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR`): `env.CLAUDE_CODE_PLUGIN_DIRS` gains `<repo>/mission-control` (other folders kept, an older clone of the mod dropped), `pluginConfigs.mission-control.options.theme = "warhammer"`, `theme = "custom:mission-control:cogitator"`, `statusLine` = `terminal/claude/statusline.py` (the theme and the status line before are kept in `~/.claude/singularity-mods.install.json` for `--uninstall`);
- the Ghostty config (`~/.config/ghostty/config`, or `$XDG_CONFIG_HOME`, or the macOS Application Support one when it exists): one marked block `# >>> singularity-mods cogitator >>>` that sets the shader and the aquila by this repo's absolute paths and includes `terminal/ghostty/cogitator.conf`, then checks it with `ghostty +validate-config`.

Then restart Claude Code (the plugin folder and the colour theme are read at start) and reload Ghostty's config (cmd+shift+, on macOS, ctrl+shift+, on Linux).

**On Windows** the same command sets up the Windows Terminal side instead of Ghostty: a fragment (`%LOCALAPPDATA%\Microsoft\Windows Terminal\Fragments\singularity-mods\cogitator.json`) adding the «Cogitator» colour scheme and a profile **«Когитатор (Claude Code)»** that starts `claude` in the amber housing: the HLSL twin of the shader (`terminal/windows-terminal/cogitator.hlsl`: scanlines, glow, brass bezel, rivets, medallions, hazard band), the padding it draws in, the aquila watermark and icon, a block cursor and a brass tab. Your `settings.json` is never touched; `--uninstall` deletes the fragment. Restart Windows Terminal and open the profile from the new-tab menu. What differs from macOS:
- pictures: the engine draws an `Image` in pixels only through kitty graphics with Unicode placeholders, which kitty and Ghostty have and neither runs on Windows; Windows Terminal has no kitty graphics, and WezTerm has them without the placeholders, so the slate takes neither for a terminal that draws pictures (it once took WezTerm for one, and its Legion showed the Image's empty alt whenever the single probe after a start met another tab on screen). So the slate draws them from the pixmaps beside them (`*.pix.json`, made by `tools/make-art.py`): the aquila in a block mosaic: each cell takes the block element (halves, eighths, quadrants, U+2580–259F) that fits the picture there best, so its edges fall to an eighth of a cell; the blocks are chosen on the picture with its dark outline thickened (the pixmap's `shape`), so the feathers stay apart, and their two colours are the picture's own, mixed in linear light, so the gold keeps its brightness. It is drawn as text runs, not a Raster: a Raster's palette rounds every colour to the terminal's 256 (measured: the gold came out olive and rose), a Text keeps it exact. The pixmap is 216 x 72 (a crest cut by `--aquila` gets one too); the servo-skull, the purity seal and the portraits in half blocks; coarser than pictures, but there;
- the housing in Windows Terminal: Windows Terminal lays the profile's padding outside the shader's surface, so the shader's bezel covers the outermost cells (the prompt under the hazard band). WezTerm below has the housing right;
- sound: the engine plays only on macOS, so the mod plays the clips itself through PowerShell (`System.Windows.Media.MediaPlayer`, at the `sound` option's volume); on Linux through `paplay` or `aplay`;
- the glyphs (✠ ☩ ⌬ ℑ …) want a font that has them: the profile uses MesloLGS Nerd Font when it is installed, and the installer says so when it is not;
- the status line wants Python 3 (`python` or `py -3`; the installer says when neither answers).
The HLSL shader compiles and runs in Windows Terminal (checked 2026-10-16), with the padding defect above.

**WezTerm** (Windows, macOS, Linux), where it is installed or configured: the installer writes one marked block `-- >>> singularity-mods cogitator >>>` into `~/.wezterm.lua` (or `$WEZTERM_CONFIG_FILE`), right before `return config`, that applies `terminal/wezterm/cogitator.lua`: the Cogitator palette, MesloLGS Nerd Font (JetBrains Mono, bundled, when it is missing), a block cursor, no tab bar for a single tab, and the brass housing. WezTerm runs no custom shader, so the housing is a picture under the text: `tools/make-housing.py` draws it with the shader's own maths (bezel, groove, gilt trim, rivets counted from each edge's middle, a cross medallion in each corner, the hazard band on the lower edge's middle third, the housing's shadow on the glass, the aquila faint in the glass's lower right) for the window's exact size, so nothing is stretched. A size met for the first time is drawn in the background in about a second, once the window held it for half a second (a size passed in a drag is not drawn), while the last housing stands stretched; housings are kept in `%LOCALAPPDATA%/singularity-mods/housing` (`~/.cache/…` elsewhere), the newest 24. It needs Python 3 with numpy and Pillow (the installer finds one and writes its path into the block, or says there is none). The housing is 0.8 of the shader's Retina sizes on a 1x screen, scaled by the screen's DPI. Scanlines and the phosphor glow, which the shader draws over the text, have no WezTerm twin. `--no-wezterm` skips it; `--uninstall` removes the block.

By hand, the mod alone is one line in `~/.claude/settings.json`, and Claude Code then loads it straight from this folder, watched and hot-reloaded:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/singularity-mods/mission-control" } }
```

The tabs open by themselves in a fullscreen terminal from 144 columns (from 110 once you have opened one yourself). `/mc` and `/mem` open them at any width.

### Develop

```bash
tools/verify.sh            # control bytes → claude plugin validate → claude plugin test → tsc
node tools/prove-tests.mjs # planted bugs: the suite must go red on every one
```

The live check, a real session in a pseudo-terminal with every screen it paints dumped as text (macOS, Linux, Windows; text only, no colours or pictures):

```bash
python3 -m venv ~/venvs/drive-tui && ~/venvs/drive-tui/bin/pip install pyte
~/venvs/drive-tui/bin/python tools/drive-tui.py "$PWD" /tmp/live "ответь одним словом: готов"
```

Before any session has loaded the mod, tsc needs the engine's types:

```bash
CLAUDE_CODE_TYPES=<…/plugin-authoring/types/claude-code.d.ts> tools/verify.sh
```

After a session has loaded the mod, the engine lays them in `mission-control/.claude-plugin/types/`, which is git-ignored.

The tests draw trees but paint nothing. The live check paints them:
- `tools/drive-tui.py` runs a real interactive session in a pseudo-terminal (170×50 by default) and saves the screens it paints. Setup and usage are in its header (macOS and Linux: `pyte`; Windows: `pywinpty` + `pyte`; a venv outside the repo).
- It found four defects no test could see:
  - the tab shown by default;
  - a label squeezed onto the reason's second line;
  - a reason wrapping to three lines;
  - a trimmed space.

Run it after any change to the drawing.

Layout:

| Path | What lives there |
|---|---|
| `hooks/register.tsx` | the module entry and lifecycle: `session.start`, `turn.complete`, `/mem`, `/mc`, `/jobs`, the snapshot tool, timers (the jobs' output poll among them), opening and raising the tabs |
| `hooks/jobs/` | `model.ts` (pure: a command in words, progress from output text, notifications, job rows), `hooks.tsx` (shell, Monitor and TaskStop calls, task notifications, tab render), `pane.tsx` (pure drawing) |
| `hooks/mission/` | `model.ts` (pure reducers and text helpers), `hooks.tsx` (agent observers, tab render), `pane.tsx` (pure drawing) |
| `hooks/memory/` | memory observers, the band above the prompt, the Память tab |
| `hooks/lib/` | pure helpers shared by both: palette and charts, themes (`theme.ts`), tool calls in words, `mb` output parsing |
| `tests/` | `claude plugin test` suites; `helpers.ts` stands in for the engine beneath the plugin |

Rules the engine enforces, all found by probes (`claude plugin validate` refuses a module that breaks one):

- one hooks module per plugin, and no imports from outside the plugin folder;
- an atom passed to `read`/`update` must be made by `atom(...)` in the same file, so each file declares the atoms it uses, with identical keys and initial values;
- `$` may only be passed into a function declared in the same file, never into an imported one;
- an event takes one hook without a matcher per module; that is why the events both features need live in `register.tsx`;
- never name a variable `h`: JSX compiles to the global `h(...)`.

In tests the kit's `$` has no `state` noun. Read exact state through the snapshot tool (`tests/helpers.ts` → `snapshot($)`), and what the person sees through `$.ui.mount`.

### Troubleshoot

- **A failure inside an observer is fail-open by design.** Every hook that only watches (`tool.call`, `agent.spawn`, `turn.*`, `session.start`, …) ends in a `.catch` that lets the event go on, so a broken part of the mod can never block a tool, a prompt or the model's stream. Such a failure leaves no line in the transcript; what you see is a stale or missing row. Compare with `mcp__mission-control__snapshot`.
- **A module that does not load at all** (a syntax error, a rule of the engine broken) does show: a dim line in the transcript naming the plugin and the reason, and every detail in the debug log (`claude --debug`). Run `tools/verify.sh` before saving changes into a live folder.
- **A drawing that throws** shows its own error in place of the tab or the band (`mission-control: вкладка «Агенты» упала: …`), never an empty column.
- **A tab that does not show:** call `mcp__mission-control__snapshot`. Its `agentsPaneStatus` and `paneStatus` say what `$.ui.open` answered.
- **A job that does not show, or shows no progress:** the snapshot's `jobs` and `jobsDir`. `jobsDir: null` means the tasks folder was not found: background jobs still show (their launch names the file), a foreground one shows its time but no progress. A job with `outputPath` and `progress: null` prints nothing the parser knows: its last line still shows.
- **An agent row that is missing or stale:** the snapshot's `agents` is the raw state. The list reconcile runs every 2 s while a subagent works.
- **Design and decisions:** `docs/specs/2026-10-11-mission-control-design.md` and `docs/plans/2026-10-11-mission-control.md`.

### Uninstall

`node tools/install.mjs --uninstall` takes the look off. To unload the mod itself, remove `CLAUDE_CODE_PLUGIN_DIRS` from `~/.claude/settings.json` and restart Claude Code.

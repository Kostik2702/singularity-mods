import { describe, expect, test } from 'claude-code/testing'

import {
  LONG_MS,
  applyCallEnd,
  applyJobStart,
  applyOutput,
  commandParts,
  describeJob,
  exitCodeOf,
  freshOutput,
  isShown,
  outputPathOf,
  parseNotifications,
  parseProgress,
  screenLines,
} from '../hooks/jobs/model'
import type { JobStart } from '../hooks/jobs/model'

describe('describeJob: what a command is, in the tab’s words', () => {
  const cases: [string, string, string][] = [
    ['curl -L -o model.bin https://huggingface.co/org/m/resolve/main/model.bin', 'download', 'скачивает model.bin ← huggingface.co'],
    ['huggingface-cli download Qwen/Qwen2.5-7B --local-dir w', 'download', 'скачивает Qwen/Qwen2.5-7B ← Hugging Face'],
    ['git clone https://github.com/a/repo.git', 'download', 'скачивает репозиторий repo'],
    // env assignments and wrappers come off; `2>&1` is a redirection, not a split.
    ['cd ml && CUDA_VISIBLE_DEVICES=0 nohup python train.py --epochs 5 2>&1 | tee log', 'train', 'обучает: train.py'],
    ['accelerate launch sft.py --config c.yaml', 'train', 'обучает: sft.py'],
    // A chain is named by what matters most: preparing data, not installing.
    ['pip install torch transformers && python scripts/prepare_dataset.py', 'data', 'готовит данные: prepare_dataset.py'],
    ['python -m eval.run --model x', 'eval', 'оценивает: eval.run'],
    ['uv pip install numpy pandas scipy polars', 'install', 'ставит numpy, pandas, scipy, …'],
    ['npm ci', 'install', 'ставит зависимости (npm)'],
    ['npm run build', 'build', 'собирает npm build'],
    ['pytest -q tests', 'test', 'гоняет тесты: pytest'],
    ['python -c "from huggingface_hub import snapshot_download; snapshot_download(\'x\')"', 'download', 'скачивает с Hugging Face'],
    ['uvicorn app:api --port 8000', 'server', 'держит запущенным uvicorn app:api'],
  ]
  for (const [command, kind, gist] of cases) {
    test(command, () => {
      expect(describeJob('Bash', command, '')).toMatchObject({ kind, gist })
    })
  }

  test('a command it does not know keeps its own words', () => {
    expect(describeJob('Bash', 'sleep 30', 'Wait for the server')).toMatchObject({ kind: 'run', gist: 'выполняет sleep 30' })
    expect(describeJob('Bash', './run_all.sh', '')).toMatchObject({ kind: 'run', gist: 'выполняет run_all.sh' })
  })

  test('a monitor watches what its description says', () => {
    expect(describeJob('Monitor', 'tail -f log', 'training log')).toMatchObject({ kind: 'watch', label: 'Наблюдение', gist: 'следит: training log' })
  })

  test('parts drop the stage-setting words', () => {
    expect(commandParts('cd x && export A=1 && echo go; FOO=1 time make -j8 2>&1')).toEqual(['make -j8 2>&1'])
  })
})

describe('parseProgress: how far a job got, from its output', () => {
  const at = (text: string) => parseProgress(screenLines(text))

  test('tqdm: percent, count, time left, rate', () => {
    expect(at(' 45%|████▌     | 450/1000 [00:12<00:15, 36.2it/s]')).toMatchObject({ fraction: 0.45, count: '450/1000', eta: '00:15', rate: '36.2it/s' })
  })

  test('a line rewritten with \\r reads its last state; ANSI codes are dropped', () => {
    const text = 'Downloading: 10%|#| 1/10 [00:01<00:09]\rDownloading: 30%|###| 3/10 [00:03<00:07]\r\x1b[32mDownloading: 50%|#####| 5/10 [00:05<00:05]\x1b[0m'
    expect(at(text)).toMatchObject({ fraction: 0.5, count: '5/10', eta: '00:05' })
  })

  test('keras: count, ETA and the loss', () => {
    expect(at('Epoch 3/10\n120/500 [=====>........] - ETA: 12s - loss: 0.3127')).toMatchObject({
      fraction: 0.24,
      count: '120/500',
      eta: '12s',
      stage: 'эпоха 3/10',
      metric: 'loss 0.3127',
    })
  })

  test('pip and rich bars', () => {
    expect(at('   ━━━━━━━━━━╸━━━━━━━━━━ 1.2/3.0 MB 5.6 MB/s eta 0:00:01')).toMatchObject({ fraction: 0.4, count: '1.2/3.0 MB', eta: '0:00:01', rate: '5.6MB/s' })
  })

  test('git clone', () => {
    expect(at('Receiving objects:  45% (450/1000), 1.20 MiB | 2.40 MiB/s')).toMatchObject({ fraction: 0.45, count: '450/1000', rate: '2.40MiB/s' })
  })

  test('wget bar and dots', () => {
    expect(at('model.bin  45%[=====>       ]  1.20G  3.40MB/s    eta 5m 2s')).toMatchObject({ fraction: 0.45, rate: '3.40MB/s', eta: '5m 2s' })
    expect(at('  51200K .......... .......... .......... 62% 3.20M 4s')).toMatchObject({ fraction: 0.62, eta: '4s', rate: '3.20M/s' })
  })

  test('curl’s meter', () => {
    const meter = '  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current\n  45  123M   45 55.6M    0     0  10.2M      0  0:00:12  0:00:05  0:00:07 10.5M'
    expect(at(meter)).toMatchObject({ fraction: 0.45, count: '55.6M/123M', eta: '0:00:07', rate: '10.5M/s' })
  })

  test('a training loop and a bracketed count', () => {
    expect(at('Epoch 3/10 train_loss=0.21')).toMatchObject({ fraction: 0.3, count: 'эпоха 3/10', stage: null, metric: 'train_loss 0.21' })
    expect(at('[12/100] tokenizing shard')).toMatchObject({ fraction: 0.12, count: '12/100' })
  })

  test('a bare percentage, the last on its line', () => {
    expect(at('processed 3 files, 45.5% done')).toMatchObject({ fraction: 0.455 })
  })

  test('nothing to read is null; a date is not progress', () => {
    expect(at('Starting server on 2026-10-14 13:43\nready')).toBeNull()
    expect(at('')).toBeNull()
  })
})

describe('engine texts', () => {
  test('the exit marker a background output ends with', () => {
    expect(exitCodeOf(screenLines('done\n\n[exited with code 0]\n'))).toBe(0)
    expect(exitCodeOf(screenLines('boom\n[exited with code 137]'))).toBe(137)
    expect(exitCodeOf(screenLines('still going 45%'))).toBeNull()
  })

  test('a notification: completed with a failing exit code is an error; killed is killed', () => {
    const text = [
      '<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>tu-1</tool-use-id>\n<status>completed</status>\n<summary>Background command "x" completed (exit code 1)</summary>\n</task-notification>',
      '<task-notification><task-id>b2</task-id><status>killed</status><summary>stopped</summary></task-notification>',
      '<task-notification><task-id>b3</task-id><status>completed</status><summary>Background command "y" completed (exit code 0)</summary></task-notification>',
    ].join('\n')
    expect(parseNotifications(text)).toEqual([
      { taskId: 'b1', toolUseId: 'tu-1', status: 'error', exitCode: 1 },
      { taskId: 'b2', toolUseId: null, status: 'killed', exitCode: null },
      { taskId: 'b3', toolUseId: null, status: 'ok', exitCode: 0 },
    ])
  })

  test('the output path a background launch names', () => {
    expect(
      outputPathOf('Command running in background with ID: b1. Output is being written to: /private/tmp/claude-501/-p/s/tasks/b1.output. You will be notified when it completes.'),
    ).toBe('/private/tmp/claude-501/-p/s/tasks/b1.output')
  })

  test('a foreground call’s file is the one new file nobody claims, and only when it is one', () => {
    expect(freshOutput(['a.output'], ['a.output', 'f1.output'], new Set())).toBe('f1.output')
    expect(freshOutput(['a.output'], ['a.output', 'f1.output', 'f2.output'], new Set())).toBeNull()
    expect(freshOutput(['a.output'], ['a.output', 'f1.output', 'b9.output'], new Set(['b9.output']))).toBe('f1.output')
  })
})

describe('rows', () => {
  const start = (over: Partial<JobStart> = {}): JobStart => ({
    id: 'tu-1',
    tool: 'Bash',
    agentId: null,
    agentLabel: 'главный',
    command: 'python train.py',
    description: 'Train',
    intent: null,
    isBackground: false,
    before: [],
    timeoutMs: null,
    now: 0,
    ...over,
  })

  test('a foreground call shows only once it is long; a short one is dropped at its end', () => {
    const jobs = applyJobStart([], start())
    expect(isShown(jobs[0]!, LONG_MS - 1)).toBe(false)
    expect(isShown(jobs[0]!, LONG_MS)).toBe(true)
    expect(applyCallEnd(jobs, { id: 'tu-1', now: 1000, taskId: null, outputPath: null, status: 'ok' })).toEqual([])
    expect(applyCallEnd(jobs, { id: 'tu-1', now: 9000, taskId: null, outputPath: null, status: 'ok' })[0]).toMatchObject({ status: 'ok', endedAt: 9000 })
  })

  test('a call moved to the background keeps running under its task id', () => {
    const jobs = applyCallEnd(applyJobStart([], start()), { id: 'tu-1', now: 1000, taskId: 'b1', outputPath: '/t/b1.output', status: 'ok' })
    expect(jobs[0]).toMatchObject({ status: 'run', taskId: 'b1', isBackground: true, outputPath: '/t/b1.output' })
  })

  test('the output’s exit marker ends a background job with its code', () => {
    const jobs = applyCallEnd(applyJobStart([], start({ isBackground: true })), { id: 'tu-1', now: 0, taskId: 'b1', outputPath: '/t/b1.output', status: 'ok' })
    const read = applyOutput(jobs, [{ id: 'tu-1', path: '/t/b1.output', size: 40, tail: 'Epoch 5/5\n[exited with code 2]\n' }], 7000)
    expect(read[0]).toMatchObject({ status: 'error', exitCode: 2, endedAt: 7000, lastLine: 'Epoch 5/5', outputAt: 7000 })
    expect(read[0]?.progress).toMatchObject({ fraction: 1, count: 'эпоха 5/5' })
  })
})

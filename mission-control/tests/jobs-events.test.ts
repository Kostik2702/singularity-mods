import { expect, test } from 'claude-code/testing'

import { TASKS_DIR, engineBeneath, fakeFs, mountAgents, mountJobs, runCommand, snapshot, spawn, step, submit, toolCall } from './helpers'

const SESSION = { cwd: '/proj', surface: 'terminal' as const, isInteractive: true }

function launched(taskId: string) {
  return {
    result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: taskId },
    text: `Command running in background with ID: ${taskId}. Output is being written to: ${TASKS_DIR}/${taskId}.output. You will be notified when it completes.`,
  }
}

const CURL = '  45  123M   45 55.6M    0     0  10.2M      0  0:00:12  0:00:05  0:00:07 10.5M'

test('a background download: who started it and why, its gist and progress, then its end from the output', async ($, on) => {
  const fs = fakeFs(on)
  fs.write(`${TASKS_DIR}/old.output`, '')
  const engine = engineBeneath(on, { bash: () => launched('b1') })
  await $.session.start(SESSION)
  await submit($, 'скачай веса')
  await $.turn.start({ text: 'скачай веса', turnId: 't1' })
  engine.say('Скачаю веса модели. Без них оценку не запустить.')
  await step($)
  await toolCall($, {
    tool: 'Bash',
    tool_use_id: 'tu-dl',
    command: 'curl -L -o model.bin https://huggingface.co/org/m/resolve/main/model.bin',
    description: 'Download model weights',
    run_in_background: true,
  })
  fs.write(`${TASKS_DIR}/b1.output`, `  % Total    % Received\n\r${CURL}`)
  await engine.clock.advance(1000)

  let s = await snapshot($)
  expect(s.jobsDir).toBe(TASKS_DIR)
  expect(s.jobs[0]).toMatchObject({
    id: 'tu-dl',
    taskId: 'b1',
    kind: 'download',
    agentLabel: 'главный',
    intent: 'Без них оценку не запустить.',
    gist: 'скачивает model.bin ← huggingface.co',
    isBackground: true,
    status: 'run',
    isAnnounced: true,
  })
  expect(s.jobs[0]?.progress).toMatchObject({ fraction: 0.45, eta: '0:00:07' })
  // The tab came forward by itself for the new job: opened at the start, and again now.
  expect(engine.opened.at(-1)).toBe('jobs')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountJobs($, surface)
    expect(await ui.find({ text: /● Скачивание · главный · 1с · в фоне/ })).toBeDefined()
    expect(await ui.find({ text: /Download model weights/ })).toBeDefined()
    expect(await ui.find({ text: /суть:\sскачивает model\.bin ← huggingface\.co/ })).toBeDefined()
    expect(await ui.find({ text: /зачем:\s«Без них оценку не запустить\.»/ })).toBeDefined()
    expect(await ui.find({ text: / 45%/ })).toBeDefined()
    expect(await ui.find({ text: /55\.6M\/123M · осталось 0:00:07 · 10\.5M\/s/ })).toBeDefined()
    await ui.unmount()
  }
  const agents = await mountAgents($, 'terminal')
  expect(await agents.find({ text: /1 долгий процесс идёт — вкладка «Процессы», \/jobs/ })).toBeDefined()
  await agents.unmount()

  fs.append(`${TASKS_DIR}/b1.output`, '\n\n[exited with code 0]\n')
  await engine.clock.advance(1000)
  s = await snapshot($)
  expect(s.jobs[0]).toMatchObject({ status: 'ok', exitCode: 0 })
  const ui = await mountJobs($, 'terminal')
  expect(await ui.find({ text: /Долгих процессов нет/ })).toBeDefined()
  expect(await ui.find({ text: /✓ Скачивание · главный · 2с · Download model weights/ })).toBeDefined()
  await ui.unmount()
})

test('a subagent’s long foreground training: its own output file is found, its epochs and loss read', async ($, on) => {
  const fs = fakeFs(on)
  fs.write(`${TASKS_DIR}/old.output`, '')
  let finish: (() => void) | undefined
  const ran = new Promise<void>(resolve => {
    finish = resolve
  })
  const engine = engineBeneath(on, {
    // The command itself makes its output file once it runs, as the engine's shell does.
    bash: async () => {
      fs.write(`${TASKS_DIR}/f1.output`, 'Epoch 2/5\n 40%|████      | 40/100 [00:10<00:15, 4.0it/s, loss=0.42]')
      await ran
      return { result: { stdout: 'done', stderr: '', interrupted: false }, text: 'done' }
    },
  })
  await $.session.start(SESSION)
  await submit($, 'обучи')
  await $.turn.start({ text: 'обучи', turnId: 't1' })
  await spawn($, { subagentType: 'coder', description: 'дообучить модель' })
  engine.say('Запускаю обучение. Пять эпох хватит для проверки.')
  await step($, 'a1')
  const call = toolCall($, { tool: 'Bash', tool_use_id: 'tu-tr', command: 'CUDA_VISIBLE_DEVICES=0 python train.py --epochs 5 2>&1', description: 'Fine-tune the model' }, 'a1')
  await engine.clock.advance(3000)

  let s = await snapshot($)
  expect(s.jobs[0]).toMatchObject({ kind: 'train', agentId: 'a1', agentLabel: 'coder', isBackground: false, outputPath: `${TASKS_DIR}/f1.output`, isAnnounced: false })
  expect(s.jobs[0]?.progress).toMatchObject({ fraction: 0.4, stage: 'эпоха 2/5', metric: 'loss 0.42' })
  // Under five seconds a foreground call is not a long action yet.
  let ui = await mountJobs($, 'terminal')
  expect(await ui.find({ text: /Долгих процессов нет/ })).toBeDefined()
  await ui.unmount()

  await engine.clock.advance(3000)
  s = await snapshot($)
  expect(s.jobs[0]?.isAnnounced).toBe(true)
  ui = await mountJobs($, 'terminal')
  expect(await ui.find({ text: /● Обучение · coder · 6с · на переднем плане/ })).toBeDefined()
  expect(await ui.find({ text: /суть:\sобучает: train\.py/ })).toBeDefined()
  expect(await ui.find({ text: /зачем:\s«Пять эпох хватит для проверки\.»/ })).toBeDefined()
  expect(await ui.find({ text: /эпоха 2\/5 · 40\/100 · осталось 00:15 · 4\.0it\/s · loss 0\.42/ })).toBeDefined()
  expect(await ui.find({ text: /› 40%\|████/ })).toBeDefined()
  await ui.unmount()

  finish?.()
  await call
  s = await snapshot($)
  expect(s.jobs[0]).toMatchObject({ status: 'ok' })
})

test('a short foreground command never becomes a job', async ($, on) => {
  fakeFs(on)
  const engine = engineBeneath(on, { bash: () => ({ result: { stdout: 'x', stderr: '', interrupted: false }, text: 'x' }) })
  await $.session.start(SESSION)
  await toolCall($, { tool: 'Bash', tool_use_id: 'tu-ls', command: 'ls -la', description: 'List files' })
  await engine.clock.advance(1000)
  expect((await snapshot($)).jobs).toEqual([])
})

test('the task’s notification and a TaskStop end background jobs; /jobs clear drops them', async ($, on) => {
  fakeFs(on)
  const ids = ['b1', 'b2']
  engineBeneath(on, { bash: () => launched(ids.shift() ?? 'bx') })
  await $.session.start(SESSION)
  await toolCall($, { tool: 'Bash', tool_use_id: 'tu-1', command: 'python prepare_dataset.py', description: 'Prepare the dataset', run_in_background: true })
  await toolCall($, { tool: 'Bash', tool_use_id: 'tu-2', command: 'python -m http.server', description: 'Serve files', run_in_background: true })
  await $.prompt.submit({
    text: '<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>tu-1</tool-use-id>\n<status>completed</status>\n<summary>Background command "Prepare the dataset" completed (exit code 3)</summary>\n</task-notification>',
    wait: false,
    origin: { kind: 'task-notification' },
  })
  await toolCall($, { tool: 'TaskStop', task_id: 'b2' })
  let s = await snapshot($)
  expect(s.jobs.find(j => j.id === 'tu-1')).toMatchObject({ kind: 'data', status: 'error', exitCode: 3 })
  expect(s.jobs.find(j => j.id === 'tu-2')).toMatchObject({ kind: 'server', status: 'killed' })
  const ui = await mountJobs($, 'terminal')
  expect(await ui.find({ text: /✖ Подготовка данных · главный · 0с · код 3 · Prepare the dataset/ })).toBeDefined()
  expect(await ui.find({ text: /⊘ Сервер/ })).toBeDefined()
  await ui.unmount()

  expect(await runCommand($, 'jobs', 'clear')).toMatch(/убраны/)
  s = await snapshot($)
  expect(s.jobs).toEqual([])
})

test('/jobs opens the Processes tab', async ($, on) => {
  fakeFs(on)
  const engine = engineBeneath(on)
  expect(await runCommand($, 'jobs', '')).toMatch(/вкладка «Процессы» открыта/)
  expect(engine.opened.at(-1)).toBe('jobs')
  expect((await snapshot($)).jobsPaneStatus).toBe('placed')
})

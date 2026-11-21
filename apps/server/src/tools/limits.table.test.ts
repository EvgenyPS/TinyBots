/**
 * FILE: apps/server/src/tools/limits.table.test.ts
 * НАЗНАЧЕНИЕ: I5. На каждой границе вызов проходит, на один шаг дальше — отказ.
 * ВХОД: временная папка и мок модели. Числа берутся из limits.ts, не из текста теста.
 * ВЫХОД: отказ с понятной причиной. Дедлайн 180 с крутится на фейковых таймерах.
 */

import { closeSync, ftruncateSync, mkdirSync, openSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stringify } from 'yaml'
import { afterEach, expect, test, vi } from 'vitest'
import { repoRoot } from '../root.js'
import { deliverChat } from '../llm/turn.js'
import { createProposal } from '../proposals/engine.js'
import { readProposal } from '../proposals/store.js'
import { runTool, type ToolRunContext } from './call.js'
import { applyUnifiedDiff, parseUnifiedDiff } from './diff.js'
import {
  CLOSED_KEEP_MS,
  DIFF_FILE_MAX,
  DIFF_FILES_MAX,
  DIFF_MAX,
  LIST_DEPTH_MAX,
  LIST_DIR_MAX,
  MODEL_REQUEST_LIMIT,
  OPEN_PROPOSALS_MAX,
  PROPOSALS_BYTES_MAX,
  READ_CALL_MAX,
  READ_FILE_MAX,
  READ_LINES_MAX,
  SEARCH_BYTES_MAX,
  SEARCH_DIRS_MAX,
  SEARCH_FILES_MAX,
  SEARCH_MATCH_MAX,
  SEARCH_QUERY_MAX,
  SEARCH_QUERY_MIN,
  TOOL_CALL_LIMIT,
  TOOL_OUTPUT_LIMIT,
  TOOL_TIMEOUT_MS,
  TURN_DEADLINE_MS,
} from './limits.js'
import { runToolLoop, withTimeout } from './loop.js'
import { TOOL_DATA_MARK } from './mask.js'

const dirs: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const NOW = new Date('2026-11-21T12:00:00.000Z')

async function scratch(): Promise<{ root: string; data: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'tinybots-lim-'))
  dirs.push(root)
  const data = path.join(root, 'data')
  await mkdir(data, { recursive: true })
  return { root: await realpath(root), data: await realpath(data) }
}

async function toolCtx(project: string, data: string): Promise<ToolRunContext> {
  const rootReal = await realpath(project)
  const dataReal = await realpath(data)
  return {
    sandbox: {
      rootReal,
      dataReal,
      launcherConfigReal: null,
      respectGitignore: false,
      gitignore: [],
      platform: 'linux',
    },
    level: 'read',
    projectId: 'demo-keys',
    botId: 'nora',
    dataDir: data,
    dataReal,
    launcherCwd: data,
    configReal: null,
    respectGitignore: false,
    projectReal: rootReal,
    now: NOW,
  }
}

function parsed(raw: string): { ok?: boolean; error?: string } {
  return JSON.parse(raw) as { ok?: boolean; error?: string }
}

test('I5 read_file: 256 КиБ, 64 КиБ и 2000 строк', async () => {
  const { root, data } = await scratch()
  const ctx = await toolCtx(root, data)
  const exact = path.join(root, 'exact.txt')
  const over = path.join(root, 'over.txt')
  await writeFile(exact, 'a\n'.repeat(READ_FILE_MAX / 2))
  await writeFile(over, `${'a\n'.repeat(READ_FILE_MAX / 2)}x`)
  const onFile = parsed(await runTool(ctx, 'read_file', JSON.stringify({ path: 'exact.txt', max_lines: 1 })))
  const pastFile = parsed(await runTool(ctx, 'read_file', JSON.stringify({ path: 'over.txt', max_lines: 1 })))
  expect(onFile.ok).toBe(true)
  expect(pastFile).toMatchObject({ ok: false, error: 'файл больше 256 КиБ' })

  await writeFile(path.join(root, 'call.txt'), 'b'.repeat(READ_CALL_MAX))
  await writeFile(path.join(root, 'call-over.txt'), 'b'.repeat(READ_CALL_MAX + 1))
  expect(parsed(await runTool(ctx, 'read_file', JSON.stringify({ path: 'call.txt' }))).ok).toBe(true)
  expect(parsed(await runTool(ctx, 'read_file', JSON.stringify({ path: 'call-over.txt' })))).toMatchObject({
    ok: false,
    error: 'за вызов больше 64 КиБ',
  })

  await writeFile(path.join(root, 'lines.txt'), `${'c\n'.repeat(READ_LINES_MAX)}`)
  expect(parsed(await runTool(ctx, 'read_file', JSON.stringify({ path: 'lines.txt', max_lines: READ_LINES_MAX }))).ok).toBe(true)
  expect(parsed(await runTool(ctx, 'read_file', JSON.stringify({ path: 'lines.txt', max_lines: READ_LINES_MAX + 1 })))).toMatchObject({
    ok: false,
    error: 'слишком много строк',
  })
})

test('I5 list_dir: 500 записей и глубина 12', async () => {
  const { root, data } = await scratch()
  const ctx = await toolCtx(root, data)
  const bucket = path.join(root, 'bucket')
  await mkdir(bucket)
  for (let index = 0; index < LIST_DIR_MAX; index += 1) {
    await writeFile(path.join(bucket, `f${index}.txt`), 'x')
  }
  expect(parsed(await runTool(ctx, 'list_dir', JSON.stringify({ path: 'bucket' }))).ok).toBe(true)
  await writeFile(path.join(bucket, 'extra.txt'), 'x')
  expect(parsed(await runTool(ctx, 'list_dir', JSON.stringify({ path: 'bucket' })))).toMatchObject({
    ok: false,
    error: 'слишком много записей',
  })

  const deep = Array.from({ length: LIST_DEPTH_MAX }, () => 'd').join('/')
  const deeper = `${deep}/d`
  await mkdir(path.join(root, deep), { recursive: true })
  expect(parsed(await runTool(ctx, 'list_dir', JSON.stringify({ path: deep }))).ok).toBe(true)
  expect(parsed(await runTool(ctx, 'list_dir', JSON.stringify({ path: deeper })))).toMatchObject({ ok: false, error: 'глубина' })
})

test('I5 search: файлы, каталоги, байты, совпадения и длина запроса', async () => {
  const { root, data } = await scratch()
  const ctx = await toolCtx(root, data)
  const files = path.join(root, 'files')
  mkdirSync(files)
  for (let index = 0; index < SEARCH_FILES_MAX; index += 1) {
    const bucket = path.join(files, `n${index}`)
    mkdirSync(bucket)
    writeFileSync(path.join(bucket, 'f.txt'), 'a')
  }
  expect(parsed(await runTool(ctx, 'search', JSON.stringify({ query: 'zz', path: 'files' }))).ok).toBe(true)
  await writeFile(path.join(files, 'n0', 'extra.txt'), 'a')
  expect(parsed(await runTool(ctx, 'search', JSON.stringify({ query: 'zz', path: 'files' })))).toMatchObject({
    ok: false,
    error: 'слишком много файлов',
  })

  const dirsRoot = path.join(root, 'dirs')
  mkdirSync(dirsRoot)
  for (let index = 0; index < SEARCH_DIRS_MAX - 1; index += 1) {
    mkdirSync(path.join(dirsRoot, `d${index}`))
  }
  expect(parsed(await runTool(ctx, 'search', JSON.stringify({ query: 'zz', path: 'dirs' }))).ok).toBe(true)
  await mkdir(path.join(dirsRoot, 'extra'))
  expect(parsed(await runTool(ctx, 'search', JSON.stringify({ query: 'zz', path: 'dirs' })))).toMatchObject({
    ok: false,
    error: 'слишком много каталогов',
  })

  const fat = path.join(root, 'fat')
  await mkdir(fat)
  await writeFile(path.join(fat, 'blob.txt'), Buffer.alloc(SEARCH_BYTES_MAX, 0x61))
  expect(parsed(await runTool(ctx, 'search', JSON.stringify({ query: 'zz', path: 'fat' }))).ok).toBe(true)
  await writeFile(path.join(fat, 'blob.txt'), Buffer.alloc(SEARCH_BYTES_MAX + 1, 0x61))
  expect(parsed(await runTool(ctx, 'search', JSON.stringify({ query: 'zz', path: 'fat' })))).toMatchObject({
    ok: false,
    error: 'слишком большой обход',
  })

  const hitsDir = path.join(root, 'hits')
  await mkdir(hitsDir)
  const hits = `${'qq\n'.repeat(SEARCH_MATCH_MAX)}`
  await writeFile(path.join(hitsDir, 'one.txt'), hits)
  expect(parsed(await runTool(ctx, 'search', JSON.stringify({ query: 'qq', path: 'hits' }))).ok).toBe(true)
  await writeFile(path.join(hitsDir, 'one.txt'), `${hits}qq\n`)
  expect(parsed(await runTool(ctx, 'search', JSON.stringify({ query: 'qq', path: 'hits' })))).toMatchObject({
    ok: false,
    error: 'слишком много совпадений',
  })

  await mkdir(path.join(root, 'empty'))
  const ask = (query: string) => runTool(ctx, 'search', JSON.stringify({ query, path: 'empty' }))
  expect(parsed(await ask('z'.repeat(SEARCH_QUERY_MIN))).ok).toBe(true)
  expect(parsed(await ask('z'.repeat(SEARCH_QUERY_MAX))).ok).toBe(true)
  expect(parsed(await ask('z'))).toMatchObject({ ok: false, error: 'длина запроса' })
  expect(parsed(await ask('z'.repeat(SEARCH_QUERY_MAX + 1)))).toMatchObject({ ok: false, error: 'длина запроса' })
}, 480_000)

test('I5 diff: 256 КиБ, 20 файлов и итог 1 МиБ', () => {
  const one = '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n'
  const padded = one + ' '.repeat(DIFF_MAX - Buffer.byteLength(one))
  expect(Buffer.byteLength(padded)).toBe(DIFF_MAX)
  const at = parseUnifiedDiff(padded)
  if (!at.ok) {
    expect(at.reason).not.toBe('дифф больше 256 КиБ')
  }
  expect(parseUnifiedDiff(`${padded} `)).toEqual({ ok: false, reason: 'дифф больше 256 КиБ' })

  const hunk = (name: string): string => `--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-old\n+new\n`
  const files = Array.from({ length: DIFF_FILES_MAX }, (_, index) => hunk(`f${index}.txt`)).join('')
  expect(parseUnifiedDiff(files).ok).toBe(true)
  expect(parseUnifiedDiff(`${files}${hunk('extra.txt')}`)).toEqual({ ok: false, reason: 'больше 20 файлов' })

  const line = 'a'.repeat(DIFF_FILE_MAX - 3)
  const original = Buffer.from(`x\n${line}\n`, 'utf8')
  expect(original.length).toBe(DIFF_FILE_MAX)
  const same = applyUnifiedDiff('--- a/big.txt\n+++ b/big.txt\n@@ -1 +1 @@\n-x\n+x\n', () => original)
  const grown = applyUnifiedDiff('--- a/big.txt\n+++ b/big.txt\n@@ -1 +1 @@\n-x\n+xx\n', () => original)
  expect(same.ok).toBe(true)
  expect(grown).toEqual({ ok: false, reason: 'файл больше 1 МиБ' })
})

function toolReply(id: string, file: string): unknown {
  return {
    choices: [{
      message: {
        content: '',
        tool_calls: [{ id, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: file }) } }],
      },
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }
}

function textReply(text: string): unknown {
  return {
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }
}

test('I5 ход: 16 вызовов, 6 запросов и 256 КиБ вывода', async () => {
  const { root, data } = await scratch()
  await writeFile(path.join(root, 'note.txt'), 'old\n')
  const payload = 'a'.repeat(60_000)
  await writeFile(path.join(root, 'big.txt'), payload)
  const one = Buffer.byteLength(`${TOOL_DATA_MARK}\n${JSON.stringify({ ok: true, path: 'big.txt', text: payload, lines: 1 })}`)
  const callsOk = Math.floor(TOOL_OUTPUT_LIMIT / one)
  expect(callsOk).toBeGreaterThan(0)
  expect(callsOk).toBeLessThan(TOOL_CALL_LIMIT)
  expect((callsOk + 1) * one).toBeGreaterThan(TOOL_OUTPUT_LIMIT)
  const ctx = await toolCtx(root, data)
  const loop = (handler: (body: string) => unknown) => {
    const bodies: string[] = []
    return {
      bodies,
      run: runToolLoop({
        baseUrl: 'http://127.0.0.1:9/v1',
        apiKey: 'demo',
        model: 'demo',
        system: 'sys',
        user: 'user',
        ctx: { ...ctx, level: 'read' },
        offerPropose: false,
        lookup: () => Promise.resolve(['127.0.0.1']),
        fetchImpl: (async (_url: string, init?: RequestInit) => {
          bodies.push(String(init?.body ?? ''))
          return new Response(JSON.stringify(handler(String(init?.body ?? ''))), { status: 200 })
        }) as typeof fetch,
      }),
    }
  }

  const many = (count: number, file: string): unknown => ({
    choices: [{
      message: {
        content: '',
        tool_calls: Array.from({ length: count }, (_, index) => ({
          id: `c${index}`,
          type: 'function',
          function: { name: 'read_file', arguments: JSON.stringify({ path: file }) },
        })),
      },
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })

  let step = 0
  const calls = loop((body) => {
    step += 1
    if (step === 1) {
      return many(TOOL_CALL_LIMIT, 'note.txt')
    }
    expect((body.match(/"role":"tool"/g) ?? []).length).toBe(TOOL_CALL_LIMIT)
    return textReply('хватит')
  })
  const callsResult = await calls.run
  expect(callsResult.ok && callsResult.text).toBe('хватит')

  step = 0
  const extra = loop((body) => {
    step += 1
    if (step === 1) {
      return many(TOOL_CALL_LIMIT + 1, 'note.txt')
    }
    expect((body.match(/"role":"tool"/g) ?? []).length).toBe(TOOL_CALL_LIMIT)
    expect(body).toContain('16')
    return textReply('стоп вызовы')
  })
  const extraResult = await extra.run
  expect(extraResult.ok && extraResult.text).toBe('стоп вызовы')

  step = 0
  const requests = loop(() => {
    step += 1
    if (step < MODEL_REQUEST_LIMIT) {
      return toolReply(`r${step}`, 'note.txt')
    }
    return textReply('шестой')
  })
  const requestResult = await requests.run
  expect(requestResult.ok && requestResult.text).toBe('шестой')
  expect(requests.bodies).toHaveLength(MODEL_REQUEST_LIMIT)

  step = 0
  const seventh = loop(() => {
    step += 1
    return toolReply(`q${step}`, 'note.txt')
  })
  const seventhResult = await seventh.run
  expect(seventhResult.ok).toBe(false)
  if (!seventhResult.ok) {
    expect(seventhResult.message).toContain('6')
  }
  expect(seventh.bodies).toHaveLength(MODEL_REQUEST_LIMIT)

  step = 0
  const bytesOk = loop(() => {
    step += 1
    if (step === 1) {
      return many(callsOk, 'big.txt')
    }
    return textReply('влезло')
  })
  const fittedBytes = await bytesOk.run
  expect(fittedBytes.ok && fittedBytes.text).toBe('влезло')

  step = 0
  const bytesOver = loop((body) => {
    step += 1
    if (step === 1) {
      return many(callsOk + 1, 'big.txt')
    }
    expect(body).toContain('256')
    return textReply('не влезло')
  })
  const overResult = await bytesOver.run
  expect(overResult.ok && overResult.text).toBe('не влезло')
})

test('I5 инструмент: ровно 10 с ещё ответ, 10 с и 1 мс — отказ', async () => {
  vi.useFakeTimers()
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
  const signal = new AbortController().signal
  const onTime = withTimeout(() => sleep(TOOL_TIMEOUT_MS).then(() => 'ok'), sleep, signal)
  const late = withTimeout(() => sleep(TOOL_TIMEOUT_MS + 1).then(() => 'late'), sleep, signal)
  const both = Promise.allSettled([onTime, late])
  await vi.advanceTimersByTimeAsync(TOOL_TIMEOUT_MS)
  const settled = await both
  expect(settled[0]).toEqual({ status: 'fulfilled', value: 'ok' })
  expect(settled[1]?.status).toBe('rejected')
})

test('I5 зависший инструмент в ходе отвечает отказом короче дедлайна', async () => {
  const { root, data } = await scratch()
  await writeFile(path.join(root, 'note.txt'), 'old\n')
  const ctx = await toolCtx(root, data)
  ctx.hooks = {
    beforeOpen: () => new Promise((resolve) => {
      setTimeout(resolve, TOOL_TIMEOUT_MS + 1)
    }),
  }
  vi.useFakeTimers()
  let step = 0
  const bodies: string[] = []
  const pending = runToolLoop({
    baseUrl: 'http://127.0.0.1:9/v1',
    apiKey: 'demo',
    model: 'demo',
    system: 'sys',
    user: 'user',
    ctx,
    offerPropose: false,
    lookup: () => Promise.resolve(['127.0.0.1']),
    sleep: (ms) => new Promise((resolve) => {
      setTimeout(resolve, ms)
    }),
    fetchImpl: (async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''))
      step += 1
      const payload = step === 1 ? toolReply('slow', 'note.txt') : textReply('дальше')
      return new Response(JSON.stringify(payload), { status: 200 })
    }) as typeof fetch,
  })
  await vi.advanceTimersByTimeAsync(TOOL_TIMEOUT_MS + 1)
  const result = await pending
  expect(result.ok && result.text).toBe('дальше')
  expect(bodies[1]).toContain('дольше 10 с')
})

test('I5 мок завис на 3-м запросе: ход кончается на 180 с, замок отпущен', async () => {
  const base = path.join(repoRoot(), 'data')
  await mkdir(base, { recursive: true })
  const dir = await mkdtemp(path.join(base, 'vitest-deadline-'))
  dirs.push(dir)
  const file = path.join(dir, 'demo-project', 'note.txt')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, 'old\n')
  await mkdir(path.join(dir, 'store'), { recursive: true })
  const config = {
    schema_version: 1,
    owner: { name: 'Ника', confirms_merge: true },
    data_dir: 'store',
    delivery: 'clipboard',
    bots: [{
      id: 'nora',
      name: 'Нора',
      role: 'справка',
      instructions: 'Коротко.',
      provider: 'deepseek',
      model: 'deepseek-chat',
      base_url: 'http://127.0.0.1:9/v1',
      api_key_env: 'DEEPSEEK_API_KEY',
      project_tools: 'read',
    }, { id: 'bitk', name: 'Бит', role: 'код' }],
    projects: [{
      id: 'demo-keys',
      title: 'Demo',
      lead: 'nora',
      owner: 'owner',
      merge_executor: 'bitk',
      allow_bot_tools: true,
      source: { files: { path: 'demo-project' } },
      chats: [{
        id: 'build',
        title: 'Сборка',
        lead: 'nora',
        members: ['nora'],
        rules: { do: 'код', dont: 'чужое' },
        context: [],
        economy: { wake: 'mentioned_only', reply_limit: 'short' },
      }],
    }],
    economy: { defaults: { wake: 'mentioned_only', reply_limit: 'short', max_wakes_per_task: 3 }, stale_after_hours: 6 },
  }
  await writeFile(path.join(dir, 'config.yaml'), stringify(config))
  const configPath = path.relative(repoRoot(), path.join(dir, 'config.yaml')).split(path.sep).join('/')
  let step = 0
  const hung = (async (_url: string, init?: RequestInit) => {
    step += 1
    if (step < 3) {
      return new Response(JSON.stringify(toolReply(`h${step}`, 'note.txt')), { status: 200 })
    }
    return new Promise<Response>((_resolve, reject) => {
      const abort = (): void => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      if (init?.signal?.aborted) {
        abort()
        return
      }
      init?.signal?.addEventListener('abort', abort, { once: true })
    })
  }) as typeof fetch
  const deps = {
    lookup: () => Promise.resolve(['127.0.0.1']),
    env: { DEEPSEEK_API_KEY: 'demo-deepseek-key' },
    now: () => NOW,
    timeoutMs: TURN_DEADLINE_MS + 60_000,
    fetchImpl: hung,
  }
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  let finished = false
  const pending = deliverChat({
    root: repoRoot(),
    options: { configPath },
    botId: 'nora',
    text: 'прочитай',
    projectId: 'demo-keys',
    chatId: 'build',
    deps,
  }).then((value) => {
    finished = true
    return value
  })
  await new Promise<void>((resolve, reject) => {
    let ticks = 0
    const timer = setInterval(() => {
      ticks += 1
      if (step >= 3) {
        clearInterval(timer)
        resolve()
        return
      }
      if (ticks > 300) {
        clearInterval(timer)
        reject(new Error(`мок не дошёл до третьего запроса, шаг ${step}`))
      }
    }, 10)
  })
  await vi.advanceTimersByTimeAsync(TURN_DEADLINE_MS - 1_000)
  expect(finished).toBe(false)
  await vi.advanceTimersByTimeAsync(2_000)
  const spoken = await pending
  expect(spoken.ok).toBe(true)
  if (spoken.ok) {
    expect(spoken.reply).toContain('180')
  }
  expect(await readFile(file, 'utf8')).toBe('old\n')
  const next = await deliverChat({
    root: repoRoot(),
    options: { configPath },
    botId: 'nora',
    text: 'ещё',
    projectId: 'demo-keys',
    chatId: 'build',
    deps: {
      ...deps,
      fetchImpl: (async () => new Response(JSON.stringify(textReply('свободно')), { status: 200 })) as typeof fetch,
    },
  })
  expect(next.ok).toBe(true)
  if (next.ok) {
    expect(next.reply).toBe('свободно')
  }
})

function proposalInput(project: string, data: string, summary: string) {
  return {
    projectReal: project,
    dataDir: data,
    dataReal: data,
    launcherCwd: project,
    configReal: null,
    respectGitignore: true,
    projectId: 'demo-keys',
    botId: 'nora',
    summary,
    diff: '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n',
    now: NOW,
  }
}

test('I5 хранение: 20 открытых, 256 МиБ и чистка закрытых', async () => {
  const { root, data } = await scratch()
  const project = path.join(root, 'proj')
  await mkdir(project)
  await writeFile(path.join(project, 'note.txt'), 'old\n')
  const real = await realpath(project)
  for (let index = 0; index < OPEN_PROPOSALS_MAX; index += 1) {
    const made = await createProposal(proposalInput(real, data, `номер ${index}`))
    expect(made.ok, String(index)).toBe(true)
  }
  const overflow = await createProposal(proposalInput(real, data, 'лишнее'))
  expect(overflow).toMatchObject({ ok: false, error: 'уже 20 открытых предложений' })
  expect(await readFile(path.join(real, 'note.txt'), 'utf8')).toBe('old\n')

  const fat = await scratch()
  const fatProject = path.join(fat.root, 'proj')
  await mkdir(fatProject)
  await writeFile(path.join(fatProject, 'note.txt'), 'old\n')
  const fatReal = await realpath(fatProject)
  const proposals = path.join(fat.data, 'proposals')
  await mkdir(proposals)
  const diffText = proposalInput(fatReal, fat.data, 'размер').diff
  const adding = Buffer.byteLength(diffText) + Buffer.byteLength('new\n')
  const pad = path.join(proposals, 'pad.bin')
  const fd = openSync(pad, 'w')
  try {
    ftruncateSync(fd, PROPOSALS_BYTES_MAX - adding)
  } finally {
    closeSync(fd)
  }
  const fitted = await createProposal(proposalInput(fatReal, fat.data, 'влезает'))
  expect(fitted.ok).toBe(true)
  const grown = openSync(pad, 'r+')
  try {
    ftruncateSync(grown, PROPOSALS_BYTES_MAX)
  } finally {
    closeSync(grown)
  }
  const tooBig = await createProposal(proposalInput(fatReal, fat.data, 'не влезает'))
  expect(tooBig).toMatchObject({ ok: false, error: 'каталог предложений больше 256 МиБ' })

  const sweep = await scratch()
  const sweepProject = path.join(sweep.root, 'proj')
  await mkdir(sweepProject)
  await writeFile(path.join(sweepProject, 'note.txt'), 'old\n')
  const sweepReal = await realpath(sweepProject)
  const store = path.join(sweep.data, 'proposals')
  await mkdir(store)
  const writeClosed = async (id: string, at: string, state: 'rejected' | 'applied'): Promise<void> => {
    const body = {
      schema_version: 1,
      id,
      project: 'demo-keys',
      bot: 'nora',
      summary: 'закрыто',
      state,
      patch_sha256: 'a'.repeat(64),
      mode: 'files',
      files: [{ path: 'note.txt', base_sha256: 'b'.repeat(64), post_sha256: 'c'.repeat(64) }],
      history: [{ state, at, by: 'nora', why: 'закрыто' }],
    }
    await writeFile(path.join(store, `${id}.json`), `${JSON.stringify(body, null, 2)}\n`)
  }
  const oldAt = new Date(NOW.getTime() - CLOSED_KEEP_MS - 24 * 60 * 60 * 1000).toISOString()
  await writeClosed('old-closed', oldAt, 'rejected')
  await writeClosed('kept-applied', oldAt, 'applied')
  for (let index = 0; index < 101; index += 1) {
    const at = new Date(NOW.getTime() - (101 - index) * 1000).toISOString()
    await writeClosed(`c${index}`, at, 'rejected')
  }
  const made = await createProposal(proposalInput(sweepReal, sweep.data, 'после чистки'))
  expect(made.ok).toBe(true)
  expect(readProposal(sweep.data, 'old-closed')).toBeNull()
  expect(readProposal(sweep.data, 'c0')).toBeNull()
  expect(readProposal(sweep.data, 'c1')?.state).toBe('rejected')
  expect(readProposal(sweep.data, 'c100')?.state).toBe('rejected')
  expect(readProposal(sweep.data, 'kept-applied')?.state).toBe('applied')
})

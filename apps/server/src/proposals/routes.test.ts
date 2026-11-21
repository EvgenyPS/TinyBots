/**
 * FILE: apps/server/src/proposals/routes.test.ts
 * НАЗНАЧЕНИЕ: I10. Таблица маршрут × случай для apply, reject и revert.
 * ВХОД: живой сервер на 127.0.0.1 и одно предложение в data_dir.
 * ВЫХОД: 403 или 409, байты проекта и json предложения те же.
 * Снятие строки из isWrite даёт 405 вместо 403 — этот тест краснеет.
 */

import http from 'node:http'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stringify } from 'yaml'
import { afterEach, expect, test } from 'vitest'
import { BIND_HOST } from '../bind.js'
import { repoRoot } from '../root.js'
import { startServer, type RunningServer } from '../server.js'
import { createProposal } from './engine.js'
import { readProposal } from './store.js'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function httpCall(
  port: number,
  method: string,
  pathname: string,
  headers: Record<string, string>,
): Promise<{ status: number; json: { error?: string } }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: BIND_HOST, port, path: pathname, method, headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          try {
            resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) as { error?: string } })
          } catch {
            resolve({ status: res.statusCode ?? 0, json: {} })
          }
        })
      },
    )
    req.on('error', reject)
    req.end(headers['content-type'] ? headers.body : undefined)
  })
}

test('I10 apply reject revert: чужой запрос не меняет файлы', async () => {
  await mkdir(path.join(repoRoot(), 'data'), { recursive: true })
  const dir = await mkdtemp(path.join(repoRoot(), 'data', 'vitest-routes-'))
  const outside = await mkdtemp(path.join(tmpdir(), 'tinybots-route-'))
  dirs.push(dir, outside)
  const project = await realpath(outside)
  const note = path.join(project, 'note.txt')
  await writeFile(note, 'old\n')
  const config = {
    schema_version: 1,
    owner: { name: 'Ника', confirms_merge: true },
    data_dir: '.',
    delivery: 'clipboard',
    bots: [
      {
        id: 'nora',
        name: 'Нора',
        role: 'справка',
        instructions: 'Коротко.',
        provider: 'deepseek',
        model: 'deepseek-chat',
        base_url: 'http://127.0.0.1:9/v1',
        api_key_env: 'DEEPSEEK_API_KEY',
        project_tools: 'propose',
      },
      { id: 'bitk', name: 'Бит', role: 'код' },
    ],
    projects: [{
      id: 'demo-keys',
      title: 'Demo',
      lead: 'nora',
      owner: 'owner',
      merge_executor: 'bitk',
      allow_bot_tools: true,
      source: { files: { path: project } },
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
  const configFile = path.join(dir, 'config.yaml')
  await writeFile(configFile, stringify(config))
  const configPath = path.relative(repoRoot(), configFile).split(path.sep).join('/')
  const made = await createProposal({
    projectReal: project,
    dataDir: dir,
    dataReal: dir,
    launcherCwd: repoRoot(),
    configReal: null,
    respectGitignore: true,
    projectId: 'demo-keys',
    botId: 'nora',
    summary: 'поменять строку',
    diff: '--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-old\n+new\n',
    now: new Date('2026-11-21T12:00:00.000Z'),
  })
  if (!made.ok) {
    throw new Error(made.error)
  }
  const stored = readProposal(dir, made.id)
  if (!stored) {
    throw new Error('json')
  }
  const jsonFile = path.join(dir, 'proposals', `${made.id}.json`)
  const beforeNote = await readFile(note)
  const beforeJson = await readFile(jsonFile)
  const wrong = stored.patch_sha256 === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64)
  let server: RunningServer | undefined
  try {
    server = await startServer({ port: 0, configPath })
    const host = `${BIND_HOST}:${server.port}`
    const opened = await httpCall(server.port, 'GET', '/api/launcher', { Host: host })
    expect(opened.status).toBe(200)
    const csrf = (opened.json as { csrf?: string }).csrf ?? ''
    expect(csrf.length).toBeGreaterThan(10)
    const routes = ['/api/proposals/apply', '/api/proposals/reject', '/api/proposals/revert']
    const same = async (): Promise<void> => {
      expect((await readFile(note)).equals(beforeNote)).toBe(true)
      expect((await readFile(jsonFile)).equals(beforeJson)).toBe(true)
    }
    for (const route of routes) {
      const send = async (headers: Record<string, string>, hash: string): Promise<{ status: number; json: { error?: string } }> => {
        const body = JSON.stringify({ id: made.id, patch_sha256: hash })
        return new Promise((resolve, reject) => {
          const req = http.request(
            {
              hostname: BIND_HOST,
              port: server?.port,
              path: route,
              method: 'POST',
              headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) },
            },
            (res) => {
              const chunks: Buffer[] = []
              res.on('data', (chunk: Buffer) => chunks.push(chunk))
              res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8')
                try {
                  resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) as { error?: string } })
                } catch {
                  resolve({ status: res.statusCode ?? 0, json: {} })
                }
              })
            },
          )
          req.on('error', reject)
          req.end(body)
        })
      }
      const cases: Array<{ name: string; headers: Record<string, string> }> = [
        { name: 'нет CSRF', headers: { Host: host, Origin: `http://${host}`, 'Content-Type': 'application/json' } },
        { name: 'чужой CSRF', headers: { Host: host, Origin: `http://${host}`, 'Content-Type': 'application/json', 'X-CSRF-Token': 'not-the-token' } },
        { name: 'нет Origin', headers: { Host: host, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } },
        { name: 'чужой Origin', headers: { Host: host, Origin: `http://${BIND_HOST}:9`, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } },
        { name: 'same-site', headers: { Host: host, Origin: `http://${host}`, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Sec-Fetch-Site': 'same-site' } },
        { name: 'cross-site', headers: { Host: host, Origin: `http://${host}`, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Sec-Fetch-Site': 'cross-site' } },
      ]
      for (const item of cases) {
        const sent = await send(item.headers, stored.patch_sha256)
        expect(sent.status, `${route} ${item.name}`).toBe(403)
        await same()
      }
      const hashed = await send(
        { Host: host, Origin: `http://${host}`, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        wrong,
      )
      expect(hashed.status, `${route} hash`).toBe(409)
      expect(hashed.json.error).toBe('patch_sha256')
      await same()
    }
    for (const site of ['same-site', 'cross-site']) {
      const got = await httpCall(server.port, 'GET', '/api/proposals?project=demo-keys', {
        Host: host,
        'Sec-Fetch-Site': site,
      })
      expect(got.status, site).toBe(403)
      await same()
    }
    const yaml = await readFile(configFile, 'utf8')
    await writeFile(configFile, yaml.replace('confirms_merge: true', 'confirms_merge: false'))
    for (const route of ['/api/proposals/apply', '/api/proposals/revert']) {
      const body = JSON.stringify({ id: made.id, patch_sha256: stored.patch_sha256 })
      const sent = await new Promise<{ status: number; json: { error?: string } }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: BIND_HOST,
            port: server?.port,
            path: route,
            method: 'POST',
            headers: {
              Host: host,
              Origin: `http://${host}`,
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrf,
              'content-length': String(Buffer.byteLength(body)),
            },
          },
          (res) => {
            const chunks: Buffer[] = []
            res.on('data', (chunk: Buffer) => chunks.push(chunk))
            res.on('end', () => {
              resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) as { error?: string } })
            })
          },
        )
        req.on('error', reject)
        req.end(body)
      })
      expect(sent.status, route).toBe(403)
      expect(sent.json.error).toBe('owner_required')
      await same()
    }
  } finally {
    await server?.close()
  }
})

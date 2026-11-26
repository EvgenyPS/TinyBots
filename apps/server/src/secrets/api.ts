/**
 * FILE: apps/server/src/secrets/api.ts
 * НАЗНАЧЕНИЕ: окно ключа для владельца. Значение только на запись.
 * ВХОД: POST с метаданными и необязательным значением. GET без значения.
 * ВЫХОД: метаданные и флаг «задан». Тело ответа значение не содержит.
 * Allowlist и привязку к ботам меняет только этот POST. Бот сюда не ходит.
 */

import { loadConfigAt, resolveDataDir, selectConfigRequest } from '../config/load.js'
import type { LaunchOptions } from '../launcher/view.js'
import { osSecretIsSet, writeOsSecret } from '../llm/os-secret.js'
import { listSecretFiles, metaHoldsValue, normalizeWrite, secretWriteSchema, toView, writeSecretFile, type SecretView } from './meta.js'

export type SecretReply = { status: number; body: Record<string, unknown> }

function opened(root: string, options: LaunchOptions | undefined): { dataDir: string; bots: string[] } | null {
  const loaded = loadConfigAt(root, selectConfigRequest(root, options?.configPath))
  if (!loaded.ok) {
    return null
  }
  const dataDir = resolveDataDir(root, loaded.directory, loaded.config.data_dir)
  if (!dataDir.ok) {
    return null
  }
  return { dataDir: dataDir.dir, bots: loaded.config.bots.map((bot) => bot.id) }
}

export async function getSecrets(root: string, options: LaunchOptions | undefined): Promise<SecretReply> {
  const box = opened(root, options)
  if (!box) {
    return { status: 422, body: { ok: false, error: 'config' } }
  }
  const secrets: SecretView[] = []
  for (const file of listSecretFiles(box.dataDir)) {
    const set = await osSecretIsSet(file.name)
    secrets.push(toView(file, set))
  }
  return { status: 200, body: { ok: true, secrets } }
}

export async function postSecret(root: string, options: LaunchOptions | undefined, payload: unknown, now = new Date()): Promise<SecretReply> {
  const box = opened(root, options)
  if (!box) {
    return { status: 422, body: { ok: false, error: 'config' } }
  }
  const parsed = secretWriteSchema.safeParse(payload)
  if (!parsed.success) {
    return { status: 422, body: { ok: false, error: 'invalid' } }
  }
  const input = normalizeWrite(parsed.data)
  if (!input || metaHoldsValue(input)) {
    return { status: 422, body: { ok: false, error: 'invalid' } }
  }
  if (input.bots.some((id) => !box.bots.includes(id))) {
    return { status: 422, body: { ok: false, error: 'invalid' } }
  }
  if (new Set(input.allow.map((item) => item.host)).size !== input.allow.length) {
    return { status: 422, body: { ok: false, error: 'invalid' } }
  }
  if (input.value !== undefined) {
    const saved = await writeOsSecret(input.name, input.value, input.replace === true)
    if (saved === 'exists') {
      return { status: 409, body: { ok: false, error: 'exists' } }
    }
    if (saved !== 'ok') {
      return { status: 503, body: { ok: false, error: 'store' } }
    }
  }
  const file = await writeSecretFile(box.dataDir, input, now)
  if (!file) {
    return { status: 422, body: { ok: false, error: 'invalid' } }
  }
  const set = await osSecretIsSet(file.name)
  const view = toView(file, set)
  return { status: 200, body: { ok: true, secret: view } }
}

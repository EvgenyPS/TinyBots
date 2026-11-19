/**
 * FILE: apps/server/src/config/setup.ts
 * НАЗНАЧЕНИЕ: описание мастера и запись config.yaml.
 * ВХОД: корень, явный путь конфига, разобранное тело POST.
 * ВЫХОД: шаги для экрана или файл на диске. Куда писать, решает сервер, не тело запроса.
 * Схема zod проходит до mkdir и rename. Без confirm_overwrite файл создаётся флагом wx:
 * второй параллельный POST видит, что цель уже есть, и получает 409.
 * Семи шагов хватает на проход: потолок критерия — десять.
 */

import { mkdir, open, rm, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { configSchema } from '@tinybots/schema'
import { stringify } from 'yaml'
import type { ZodError } from 'zod'
import { z } from 'zod'
import { writeAtomic } from '../store/atomic.js'
import { staysInRoot } from './confine.js'
import { parseConfigText } from './load.js'
import { resolveSetupTarget } from './setup-target.js'

export const SETUP_STEP_LIMIT = 10

export const SETUP_STEPS = [
  { id: 'owner', title: 'Владелец' },
  { id: 'bots', title: 'Боты' },
  { id: 'project', title: 'Проект' },
  { id: 'chats', title: 'Чаты' },
  { id: 'source', title: 'Источник' },
  { id: 'delivery', title: 'Доставка' },
  { id: 'economy', title: 'Экономия' },
] as const

const envelopeSchema = z.strictObject({
  confirm_overwrite: z.boolean().optional(),
  config: z.unknown(),
})

export type SetupReply = {
  status: 200 | 403 | 409 | 422
  body: Record<string, unknown>
}

function clip(reason: string): string {
  const oneLine = reason.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= 400) {
    return oneLine
  }
  return `${oneLine.slice(0, 400)}…`
}

function issueReason(error: ZodError): string {
  const issue = error.issues[0]
  if (!issue) {
    return 'конфиг не прошёл схему'
  }
  const joined = issue.path.map((part) => String(part)).join('.')
  if (joined.length === 0) {
    return clip(issue.message)
  }
  return clip(`${joined}: ${issue.message}`)
}

export function describeSetup(root: string, explicit: string | undefined, csrf: string): SetupReply {
  const target = resolveSetupTarget(root, explicit)
  if (!target.ok) {
    return { status: 422, body: { ok: false, reason: target.reason } }
  }
  return {
    status: 200,
    body: {
      ok: true,
      csrf,
      target: target.target,
      exists: target.exists,
      required: target.required,
      writable: target.writable,
      demo: target.demo,
      steps: SETUP_STEPS,
    },
  }
}

export async function saveSetup(root: string, explicit: string | undefined, payload: unknown): Promise<SetupReply> {
  const envelope = envelopeSchema.safeParse(payload)
  if (!envelope.success) {
    return { status: 422, body: { ok: false, error: 'invalid_config', reason: issueReason(envelope.error) } }
  }
  const parsed = configSchema.safeParse(envelope.data.config)
  if (!parsed.success) {
    return { status: 422, body: { ok: false, error: 'invalid_config', reason: issueReason(parsed.error) } }
  }

  const target = resolveSetupTarget(root, explicit)
  if (!target.ok) {
    return { status: 422, body: { ok: false, error: 'invalid_config', reason: target.reason } }
  }
  if (!target.writable || !staysInRoot(root, target.absolute)) {
    return { status: 403, body: { ok: false, error: 'demo_protected' } }
  }

  // Повторный разбор уже сериализованного текста: на диск не попадёт YAML, который схема не примет.
  const yamlText = stringify(parsed.data, { lineWidth: 100 })
  const text = yamlText.endsWith('\n') ? yamlText : `${yamlText}\n`
  const roundtrip = parseConfigText(text, target.target)
  if (!roundtrip.ok) {
    return { status: 422, body: { ok: false, error: 'invalid_config', reason: roundtrip.reason } }
  }

  const overwrite = envelope.data.confirm_overwrite === true
  let claimed = false
  try {
    await mkdir(path.dirname(target.absolute), { recursive: true })
    if (!overwrite) {
      // wx — создание «только если файла ещё нет». Проверка exists до записи проигрывает гонку.
      claimed = await claimNewFile(target.absolute)
      if (!claimed) {
        return { status: 409, body: { ok: false, error: 'config_exists', file: target.target } }
      }
    }
    await writeAtomic(target.absolute, text)
  } catch {
    if (claimed) {
      await rm(target.absolute, { force: true }).catch(() => undefined)
    }
    // Текст исключения может содержать абсолютный путь. Наружу его не отдаём.
    return { status: 422, body: { ok: false, error: 'invalid_config', reason: 'не удалось записать файл' } }
  }
  return { status: 200, body: { ok: true, file: target.target } }
}

/** true — этот вызов создал пустой файл. false — цель уже была. */
async function claimNewFile(target: string): Promise<boolean> {
  let handle: FileHandle | undefined
  try {
    handle = await open(target, 'wx')
    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'EEXIST') {
      return false
    }
    throw error
  } finally {
    await handle?.close()
  }
}

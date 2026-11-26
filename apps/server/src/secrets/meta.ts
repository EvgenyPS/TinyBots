/**
 * FILE: apps/server/src/secrets/meta.ts
 * НАЗНАЧЕНИЕ: метаданные закрытого ключа на диске. Значения здесь нет.
 * ВХОД: data_dir и тело от владельца.
 * ВЫХОД: файл data_dir/secrets/keys/<NAME>.json и вид для GET (плюс «задан»).
 * Allowlist и список ботов пишет только этот модуль. config.yaml и /api/bots/tools его не вызывают.
 * Удаления нет: файл ключа снимает владелец вручную, бот этого сделать не может.
 */

import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { idSchema } from '@tinybots/schema'
import { z } from 'zod'
import { writeAtomic } from '../store/atomic.js'
import { SECRET_MASK_MIN } from './mask.js'

export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/

export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

const headerSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,63}(?:: [A-Za-z0-9._~+/-]{1,64})?$/)

function punyHost(host: string): string | null {
  if (host.includes('*') || host.includes('/') || host.includes('@') || host.includes(' ') || host.includes(':')) {
    return null
  }
  let url: URL
  try {
    url = new URL(`https://${host}`)
  } catch {
    return null
  }
  if (url.username.length > 0 || url.password.length > 0 || url.pathname !== '/' || url.search.length > 0) {
    return null
  }
  if (url.port.length > 0 && url.port !== '443') {
    return null
  }
  return url.hostname
}

const allowItem = z.strictObject({
  host: z.string().min(1).max(253),
  methods: z.array(z.enum(HTTP_METHODS)).min(1).max(HTTP_METHODS.length),
})

export const secretFileSchema = z.strictObject({
  schema_version: z.literal(1),
  updated_at: z.string().min(1),
  name: z.string().regex(SECRET_NAME),
  description: z.string().min(1).max(200),
  header: headerSchema,
  body: z.boolean(),
  allow: z.array(z.strictObject({
    host: z.string().min(1),
    methods: z.array(z.enum(HTTP_METHODS)).min(1),
  })).min(1).max(16),
  bots: z.array(idSchema).max(32),
})

export type SecretFile = z.infer<typeof secretFileSchema>

export const secretWriteSchema = z.strictObject({
  name: z.string().regex(SECRET_NAME),
  description: z.string().trim().min(1).max(200),
  header: headerSchema,
  body: z.boolean().optional(),
  allow: z.array(allowItem).min(1).max(16),
  bots: z.array(idSchema).max(32),
  value: z.string().min(SECRET_MASK_MIN).max(4096).optional(),
  replace: z.boolean().optional(),
})

export type SecretWrite = {
  name: string
  description: string
  header: string
  body?: boolean
  allow: { host: string; methods: string[] }[]
  bots: string[]
  value?: string
  replace?: boolean
}

/** Хост в файле всегда punycode. Звёздочка и userinfo сюда не доходят. */
export function normalizeWrite(input: z.infer<typeof secretWriteSchema>): SecretWrite | null {
  const allow: { host: string; methods: string[] }[] = []
  for (const item of input.allow) {
    const host = punyHost(item.host)
    if (host === null) {
      return null
    }
    allow.push({ host, methods: [...new Set(item.methods)] })
  }
  return {
    name: input.name,
    description: input.description,
    header: input.header,
    body: input.body,
    allow,
    bots: [...input.bots],
    value: input.value,
    replace: input.replace,
  }
}

export type SecretView = {
  name: string
  description: string
  header: string
  body: boolean
  allow: { host: string; methods: string[] }[]
  bots: string[]
  set: boolean
}

function keysDir(dataDir: string): string {
  return path.join(dataDir, 'secrets', 'keys')
}

export function secretFilePath(dataDir: string, name: string): string | null {
  if (!SECRET_NAME.test(name)) {
    return null
  }
  return path.join(keysDir(dataDir), `${name}.json`)
}

function duplicateHost(allow: { host: string }[]): boolean {
  const seen = new Set<string>()
  for (const item of allow) {
    if (seen.has(item.host)) {
      return true
    }
    seen.add(item.host)
  }
  return false
}

/** Описание и заголовок не должны нести значение и не должны содержать ссылку. */
export function metaHoldsValue(input: SecretWrite): boolean {
  const fields = [
    input.description,
    input.header,
    ...input.allow.flatMap((item) => [item.host, ...item.methods]),
    ...input.bots,
  ]
  if (fields.some((field) => field.includes('{{secret:'))) {
    return true
  }
  const value = input.value
  if (value !== undefined && value.length >= 8 && fields.some((field) => field.includes(value))) {
    return true
  }
  return false
}

export function readSecretFile(dataDir: string, name: string): SecretFile | null {
  const file = secretFilePath(dataDir, name)
  if (file === null) {
    return null
  }
  try {
    const parsed = secretFileSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')) as unknown)
    if (!parsed.success || parsed.data.name !== name) {
      return null
    }
    return parsed.data
  } catch {
    return null
  }
}

export function listSecretFiles(dataDir: string): SecretFile[] {
  const dir = keysDir(dataDir)
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const out: SecretFile[] = []
  for (const fileName of names) {
    if (!fileName.endsWith('.json')) {
      continue
    }
    const name = fileName.slice(0, -5)
    const file = readSecretFile(dataDir, name)
    if (file) {
      out.push(file)
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export function listBotSecrets(dataDir: string, botId: string): { name: string; description: string }[] {
  return listSecretFiles(dataDir)
    .filter((file) => file.bots.includes(botId))
    .map((file) => ({ name: file.name, description: file.description }))
}

export async function writeSecretFile(dataDir: string, input: SecretWrite, now: Date): Promise<SecretFile | null> {
  if (metaHoldsValue(input) || duplicateHost(input.allow)) {
    return null
  }
  const body: SecretFile = {
    schema_version: 1,
    updated_at: now.toISOString(),
    name: input.name,
    description: input.description,
    header: input.header,
    body: input.body ?? false,
    allow: input.allow.map((item) => ({
      host: item.host,
      methods: item.methods.filter((method): method is SecretFile['allow'][number]['methods'][number] => (
        method === 'GET' || method === 'HEAD' || method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'
      )),
    })),
    bots: [...input.bots],
  }
  const checked = secretFileSchema.safeParse(body)
  if (!checked.success) {
    return null
  }
  const file = secretFilePath(dataDir, input.name)
  if (file === null) {
    return null
  }
  mkdirSync(keysDir(dataDir), { recursive: true })
  await writeAtomic(file, `${JSON.stringify(checked.data, null, 2)}\n`, { mode: 0o600 })
  return checked.data
}

export function toView(file: SecretFile, set: boolean): SecretView {
  return {
    name: file.name,
    description: file.description,
    header: file.header,
    body: file.body,
    allow: file.allow.map((item) => ({ host: item.host, methods: [...item.methods] })),
    bots: [...file.bots],
    set,
  }
}

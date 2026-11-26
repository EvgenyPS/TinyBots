/**
 * FILE: apps/web/src/ui/setup-model.ts
 * НАЗНАЧЕНИЕ: состояние мастера, проверка шагов и сборка config.yaml.
 * ВХОД: ответы человека. ВЫХОД: объект конфига или текст ошибки.
 * Id бота в мастере собирается из имени и суффикса -bot. Схему id не меняем.
 * Id проекта и чата остаются без суффикса.
 */

import type { ProviderFields } from './bot-presets'

export type Step = { id: string; title: string }

export type SetupInfo = {
  ok: true
  csrf: string
  target: string
  exists: boolean
  required: boolean
  writable: boolean
  demo: boolean
  steps: Step[]
}

export type Probe = { path: string; git: boolean; warning: string | null }

export type ToolLevel = 'off' | 'read' | 'propose'

export type BotForm = {
  name: string
  role: string
  id: string
  avatar: string
  avatarId: string | null
  avatarColor: string | null
  idTouched: boolean
  api: boolean
  instructions: string
  /** Какой шаблон выбран. «Своя» — custom, текст может быть пустым или своим. */
  instructionTemplate: string
  /** Человек правил поле после шаблона. Смена шаблона тогда спрашивает. */
  instructionsTouched: boolean
  provider: string
  model: string
  modelCustom: boolean
  modelTouched: boolean
  baseUrl: string
  baseUrlTouched: boolean
  apiKeyEnv: string
  apiKeyEnvTouched: boolean
  extraOpen: boolean
  projectTools: ToolLevel
  applyMode: 'git' | 'files'
}

export type Form = {
  ownerName: string
  confirms: boolean
  bots: BotForm[]
  projectTitle: string
  projectId: string
  projectIdTouched: boolean
  lead: string
  executor: string
  chatTitle: string
  chatId: string
  chatIdTouched: boolean
  chatLead: string
  members: string[]
  rulesDo: string
  rulesDont: string
  sourcePath: string
  allowTools: boolean
  respectGitignore: boolean
  repo: string
  probe: Probe | null
  delivery: 'clipboard' | 'queue'
  reply: 'short' | 'long'
  wakes: string
  stale: string
  confirmOverwrite: boolean
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/
/** Как в idSchema: один символ плюс ещё 63. */
const ID_MAX = 64
/** Суффикс id бота. Дефис уже разрешён схемой, второе поле не заводим. */
const BOT_SUFFIX = '-bot'
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
export const KNOWN = new Set(['owner', 'bots', 'project', 'chats', 'source', 'access', 'delivery', 'economy'])

const RU: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

export function slugify(raw: string, fallback: string, limit = ID_MAX): string {
  let out = ''
  for (const ch of raw.trim().toLowerCase()) {
    const mapped = RU[ch]
    if (mapped !== undefined) {
      out += mapped
      continue
    }
    if (/[a-z0-9]/.test(ch)) {
      out += ch
      continue
    }
    if (ch === ' ' || ch === '_' || ch === '-') {
      out += '-'
    }
  }
  out = out.replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (!/^[a-z0-9]/.test(out)) {
    return fallback
  }
  return out.slice(0, limit)
}

/**
 * Id бота всегда заканчивается на -bot и не длиннее 64.
 * Повторный вызов не приклеивает суффикс второй раз.
 * Основа обрезается, чтобы хвост поместился.
 */
export function withBotSuffix(stem: string): string {
  let bare = stem.trim().toLowerCase()
  if (bare.endsWith(BOT_SUFFIX)) {
    bare = bare.slice(0, -BOT_SUFFIX.length)
  }
  bare = bare.replace(/-+$/g, '').slice(0, ID_MAX - BOT_SUFFIX.length).replace(/-+$/g, '')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(bare)) {
    return ''
  }
  return `${bare}${BOT_SUFFIX}`
}

/** Автогенерация: «Ревик» → revik-bot, пустое имя → bot1-bot. Совпадение получает номер: revik2-bot. */
export function autoBotId(name: string, index: number, taken: ReadonlySet<string>): string {
  const fallback = `bot${index + 1}`
  const stem = name.trim().length === 0 ? fallback : slugify(name, fallback, ID_MAX - BOT_SUFFIX.length)
  return uniqueBotId(stem, taken)
}

function uniqueBotId(stem: string, taken: ReadonlySet<string>): string {
  const base = withBotSuffix(stem)
  if (base.length > 0 && !taken.has(base)) {
    return base
  }
  const bare = (stem.endsWith(BOT_SUFFIX) ? stem.slice(0, -BOT_SUFFIX.length) : stem).replace(/-+$/g, '')
  for (let n = 2; n < 10000; n += 1) {
    const tail = `${n}${BOT_SUFFIX}`
    const cut = bare.slice(0, ID_MAX - tail.length).replace(/-+$/g, '')
    if (!/^[a-z0-9]/.test(cut)) {
      continue
    }
    const candidate = `${cut}${tail}`
    if (candidate.length <= ID_MAX && !taken.has(candidate)) {
      return candidate
    }
  }
  return base.length > 0 ? base : `bot${BOT_SUFFIX}`
}

/**
 * Ручной id. Суффикс дописываем один раз, не на каждый символ.
 * Уже оканчивается на -bot — оставляем. Пустое поле не заполняем выдумкой.
 */
export function finishManualBotId(raw: string): string {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) {
    return ''
  }
  if (trimmed.endsWith(BOT_SUFFIX)) {
    const suffixed = withBotSuffix(trimmed)
    return suffixed.length > 0 && SLUG.test(suffixed) ? suffixed : trimmed.slice(0, ID_MAX)
  }
  const stemmed = slugify(trimmed, '', ID_MAX - BOT_SUFFIX.length)
  if (stemmed.length === 0) {
    return trimmed.slice(0, ID_MAX)
  }
  const suffixed = withBotSuffix(stemmed)
  return suffixed.length > 0 ? suffixed : trimmed.slice(0, ID_MAX)
}

/** Перед проверкой и записью: авто-id пересчитать, ручному дописать суффикс. */
export function finalizeBots(bots: readonly BotForm[]): BotForm[] {
  const next: BotForm[] = []
  for (let index = 0; index < bots.length; index += 1) {
    const bot = bots[index]
    if (!bot) {
      continue
    }
    const taken = new Set(next.map((item) => item.id).filter((id) => id.length > 0))
    if (!bot.idTouched) {
      next.push({ ...bot, id: autoBotId(bot.name, index, taken) })
      continue
    }
    next.push({ ...bot, id: finishManualBotId(bot.id), idTouched: true })
  }
  return next
}

/** Текст под полем id, когда общая проверка уже споткнулась об этот бот. */
export function botIdFieldError(bots: readonly BotForm[], index: number): string | null {
  const id = bots[index]?.id.trim() ?? ''
  if (id.length === 0) {
    return null
  }
  if (!SLUG.test(id)) {
    return 'Id бота: строчные буквы, цифры и дефис'
  }
  if (bots.some((bot, i) => i !== index && bot.id.trim() === id)) {
    return 'Id ботов должны различаться'
  }
  return null
}

/** Папка проекта может быть где угодно, в том числе вне лаунчера. Управляющие символы и UNC нельзя. */
export function projectFolderOk(value: string): boolean {
  if (value.length === 0 || value.length > 300) {
    return false
  }
  // \/evil и /\evil — тот же UNC, что //evil. Слэши сравниваем после приведения.
  if (value.replace(/\\/g, '/').startsWith('//')) {
    return false
  }
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x1f) {
      return false
    }
  }
  return true
}

/** Куда писать сам config.yaml: только относительный путь внутри лаунчера. */
export function contained(value: string): boolean {
  if (value.length === 0 || value.includes('..') || value.includes('\\')) {
    return false
  }
  if (value.startsWith('/') || value.startsWith('~')) {
    return false
  }
  return !/^[A-Za-z]:/.test(value)
}

export function safeTarget(value: string): string {
  if (!contained(value)) {
    return 'config.yaml'
  }
  return value
}

export function emptyBot(): BotForm {
  return {
    name: '',
    role: '',
    id: '',
    avatar: '',
    avatarId: null,
    avatarColor: null,
    idTouched: false,
    api: false,
    instructions: '',
    instructionTemplate: 'custom',
    instructionsTouched: false,
    provider: 'deepseek',
    model: '',
    modelCustom: false,
    modelTouched: false,
    baseUrl: '',
    baseUrlTouched: false,
    apiKeyEnv: '',
    apiKeyEnvTouched: false,
    extraOpen: false,
    projectTools: 'off',
    applyMode: 'files',
  }
}

export const EXTRA_PROBLEMS = new Set([
  'Id бота: строчные буквы, цифры и дефис',
  'Id ботов должны различаться',
  'Имя ключа — переменная вида NAME_API_KEY',
  'Для своего провайдера нужен base_url',
])

export function fieldsOf(bot: BotForm): ProviderFields {
  return {
    provider: bot.provider,
    model: bot.model,
    modelCustom: bot.modelCustom,
    modelTouched: bot.modelTouched,
    baseUrl: bot.baseUrl,
    baseUrlTouched: bot.baseUrlTouched,
    apiKeyEnv: bot.apiKeyEnv,
    apiKeyEnvTouched: bot.apiKeyEnvTouched,
  }
}

export function withFields(bot: BotForm, fields: ProviderFields): BotForm {
  return { ...bot, ...fields }
}

/** Ошибка в свёрнутом блоке: раскрываем его, иначе человек не увидит поле. */
export function withExtraOpen(form: Form): Form {
  return {
    ...form,
    bots: form.bots.map((bot) => ({ ...bot, extraOpen: true })),
  }
}

const API_KEY_ENV = /^[A-Z][A-Z0-9_]*_API_KEY$/

export function emptyForm(): Form {
  return {
    ownerName: '',
    confirms: true,
    bots: [emptyBot()],
    projectTitle: '',
    projectId: '',
    projectIdTouched: false,
    lead: '',
    executor: '',
    chatTitle: '',
    chatId: '',
    chatIdTouched: false,
    chatLead: '',
    members: [],
    rulesDo: 'код и проверка',
    rulesDont: 'не будить весь чат',
    sourcePath: '',
    allowTools: false,
    respectGitignore: true,
    repo: '',
    probe: null,
    delivery: 'clipboard',
    reply: 'short',
    wakes: '3',
    stale: '6',
    confirmOverwrite: false,
  }
}

export function isSetup(value: unknown): value is SetupInfo {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as { ok?: unknown; csrf?: unknown; steps?: unknown; writable?: unknown }
  return row.ok === true && typeof row.csrf === 'string' && Array.isArray(row.steps) && typeof row.writable === 'boolean'
}

export function isProbe(value: unknown): value is { ok: true; git: boolean; warning: string | null } | { ok: false; reason: string } {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as { ok?: unknown; git?: unknown; reason?: unknown }
  if (row.ok === true && typeof row.git === 'boolean') {
    return true
  }
  return row.ok === false && typeof row.reason === 'string'
}

function botIds(form: Form): string[] {
  return form.bots.map((bot) => bot.id.trim()).filter((id) => id.length > 0)
}

export function validate(step: string, form: Form): string | null {
  if (step === 'owner') {
    if (form.ownerName.trim().length === 0) {
      return 'Нужно имя владельца'
    }
    return null
  }
  if (step === 'bots') {
    if (form.bots.length === 0) {
      return 'Нужен хотя бы один бот'
    }
    const ids = new Set<string>()
    for (const bot of form.bots) {
      if (bot.name.trim().length === 0 || bot.role.trim().length === 0) {
        return 'У бота нужны имя и роль'
      }
      if (!SLUG.test(bot.id.trim())) {
        return 'Id бота: строчные буквы, цифры и дефис'
      }
      if (ids.has(bot.id.trim())) {
        return 'Id ботов должны различаться'
      }
      if (bot.api) {
        if (bot.instructions.trim().length === 0 || bot.model.trim().length === 0) {
          return 'Своему боту нужны инструкции и модель'
        }
        if (!API_KEY_ENV.test(bot.apiKeyEnv.trim())) {
          return 'Имя ключа — переменная вида NAME_API_KEY'
        }
        if (bot.provider === 'other' && bot.baseUrl.trim().length === 0) {
          return 'Для своего провайдера нужен base_url'
        }
      }
      ids.add(bot.id.trim())
      if (bot.avatar.trim().length > 0 && !contained(bot.avatar.trim())) {
        return 'Аватар — относительный путь'
      }
    }
    return null
  }
  if (step === 'project') {
    if (form.projectTitle.trim().length === 0) {
      return 'Нужно название проекта'
    }
    if (!SLUG.test(form.projectId.trim())) {
      return 'Id проекта: строчные буквы, цифры и дефис'
    }
    const ids = botIds(form)
    if (!ids.includes(form.lead) || !ids.includes(form.executor)) {
      return 'Главный и исполнитель выбираются из ботов'
    }
    return null
  }
  if (step === 'chats') {
    if (form.chatTitle.trim().length === 0) {
      return 'Нужно название чата'
    }
    if (!SLUG.test(form.chatId.trim())) {
      return 'Id чата: строчные буквы, цифры и дефис'
    }
    if (!form.members.includes(form.chatLead)) {
      return 'Главный чата должен быть среди участников'
    }
    if (form.rulesDo.trim().length === 0 || form.rulesDont.trim().length === 0) {
      return 'Нужны оба правила чата'
    }
    return null
  }
  if (step === 'source') {
    const pathValue = form.sourcePath.trim()
    if (!projectFolderOk(pathValue)) {
      return 'Укажите папку проекта'
    }
    if (!form.probe || form.probe.path !== pathValue) {
      return 'Сначала проверьте путь'
    }
    if (form.probe.git && form.repo.trim().length > 0 && !REPO.test(form.repo.trim())) {
      return 'Репозиторий в виде owner/name'
    }
    return null
  }
  if (step === 'economy') {
    const wakes = Number(form.wakes)
    const stale = Number(form.stale)
    if (!Number.isInteger(wakes) || wakes < 1) {
      return 'Пробуждений на задачу — целое число от 1'
    }
    if (!Number.isFinite(stale) || stale <= 0) {
      return 'Порог устаревания — число часов больше нуля'
    }
    return null
  }
  return null
}

export function withStepDefaults(stepId: string, form: Form): Form {
  if (stepId === 'bots') {
    const ids = botIds(form)
    const first = ids[0] ?? ''
    return {
      ...form,
      lead: ids.includes(form.lead) ? form.lead : first,
      executor: ids.includes(form.executor) ? form.executor : first,
    }
  }
  if (stepId === 'project') {
    const ids = botIds(form)
    const chatLead = ids.includes(form.chatLead) ? form.chatLead : form.lead
    const membersOk = form.members.length > 0 && form.members.every((id) => ids.includes(id))
    const members = membersOk ? form.members : ids
    const withLead = members.includes(chatLead) ? members : [chatLead, ...members]
    return { ...form, chatLead, members: withLead }
  }
  return form
}

export function buildConfig(form: Form): { ok: true; config: Record<string, unknown> } | { ok: false; reason: string } {
  const problem = validate('economy', form) ?? validate('source', form)
  if (problem) {
    return { ok: false, reason: problem }
  }
  const wakes = Number(form.wakes)
  const stale = Number(form.stale)
  const bots = form.bots.map((bot) => {
    const row: Record<string, unknown> = {
      id: bot.id.trim(),
      name: bot.name.trim(),
      role: bot.role.trim(),
    }
    if (bot.avatar.trim().length > 0) {
      row.avatar = bot.avatar.trim()
    }
    if (bot.avatarId) {
      row.avatarId = bot.avatarId
      if (bot.avatarColor) {
        row.avatarColor = bot.avatarColor
      }
    }
    if (bot.id.trim() === form.executor) {
      row.executor_for_merge = true
    }
    if (bot.api) {
      row.instructions = bot.instructions.trim()
      row.provider = bot.provider.trim()
      row.model = bot.model.trim()
      row.api_key_env = bot.apiKeyEnv.trim()
      row.project_tools = bot.projectTools
      row.apply_mode = form.probe?.git && bot.applyMode === 'git' ? 'git' : 'files'
      if (bot.baseUrl.trim().length > 0) {
        row.base_url = bot.baseUrl.trim()
      }
    }
    return row
  })
  const source: Record<string, unknown> = {}
  if (form.probe?.git) {
    const repo = form.repo.trim()
    source.git = { provider: 'github', repo: repo.length > 0 ? repo : null }
  }
  source.files = { path: form.sourcePath.trim() }
  return {
    ok: true,
    config: {
      schema_version: 1,
      owner: { name: form.ownerName.trim(), confirms_merge: form.confirms },
      data_dir: 'data',
      delivery: form.delivery,
      bots,
      projects: [
        {
          id: form.projectId.trim(),
          title: form.projectTitle.trim(),
          lead: form.lead,
          owner: 'owner',
          merge_executor: form.executor,
          source,
          allow_bot_tools: form.allowTools,
          respect_gitignore: form.respectGitignore,
          chats: [
            {
              id: form.chatId.trim(),
              title: form.chatTitle.trim(),
              lead: form.chatLead,
              members: form.members,
              rules: { do: form.rulesDo.trim(), dont: form.rulesDont.trim() },
              context: [],
              economy: { wake: 'mentioned_only', reply_limit: form.reply },
            },
          ],
        },
      ],
      economy: {
        defaults: {
          wake: 'mentioned_only',
          reply_limit: form.reply,
          max_wakes_per_task: wakes,
        },
        stale_after_hours: stale,
      },
    },
  }
}

export function readError(body: unknown): string {
  if (!body || typeof body !== 'object') {
    return 'Запись не прошла'
  }
  const row = body as { reason?: unknown; error?: unknown }
  if (row.error === 'config_exists') {
    return 'Файл уже есть. Отметьте замену, иначе он останется как был.'
  }
  if (row.error === 'csrf' || row.error === 'forbidden_host' || row.error === 'demo_protected') {
    return 'Запись отклонена'
  }
  if (typeof row.reason === 'string' && row.reason.length > 0) {
    return row.reason
  }
  return 'Запись не прошла'
}


/**
 * FILE: apps/web/src/ui/setup-wizard.tsx
 * НАЗНАЧЕНИЕ: семь шагов мастера. В конце пишет config.yaml и открывает пульт.
 * ВХОД: GET /api/setup (шаги, токен, можно ли писать) и проверка пути GET /api/setup/source.
 * ВЫХОД: POST /api/setup с тем же токеном. Куда ляжет файл, решает сервер.
 * Без проверки пути дальше нельзя: человек должен увидеть, скрыта ли вкладка Git.
 * Аватар и репозиторий можно пропустить. Очередь доставки по умолчанию выключена.
 */

import { useEffect, useRef, useState } from 'react'

type Step = { id: string; title: string }

type SetupInfo = {
  ok: true
  csrf: string
  target: string
  exists: boolean
  required: boolean
  writable: boolean
  demo: boolean
  steps: Step[]
}

type Probe = { path: string; git: boolean; warning: string | null }

type ToolLevel = 'off' | 'read' | 'propose'

type BotForm = {
  name: string
  role: string
  id: string
  avatar: string
  idTouched: boolean
  api: boolean
  instructions: string
  provider: string
  model: string
  baseUrl: string
  apiKeyEnv: string
  projectTools: ToolLevel
  applyMode: 'git' | 'files'
}

type Form = {
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
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const KNOWN = new Set(['owner', 'bots', 'project', 'chats', 'source', 'access', 'delivery', 'economy'])

const RU: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

function slugify(raw: string, fallback: string): string {
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
  return out.slice(0, 64)
}

/** Папка проекта может быть где угодно, в том числе вне лаунчера. Управляющие символы и UNC нельзя. */
function projectFolderOk(value: string): boolean {
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
function contained(value: string): boolean {
  if (value.length === 0 || value.includes('..') || value.includes('\\')) {
    return false
  }
  if (value.startsWith('/') || value.startsWith('~')) {
    return false
  }
  return !/^[A-Za-z]:/.test(value)
}

function safeTarget(value: string): string {
  if (!contained(value)) {
    return 'config.yaml'
  }
  return value
}

function emptyBot(): BotForm {
  return {
    name: '',
    role: '',
    id: '',
    avatar: '',
    idTouched: false,
    api: false,
    instructions: '',
    provider: 'deepseek',
    model: '',
    baseUrl: '',
    apiKeyEnv: '',
    projectTools: 'off',
    applyMode: 'files',
  }
}

const API_KEY_ENV = /^[A-Z][A-Z0-9_]*_API_KEY$/

function emptyForm(): Form {
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

function isSetup(value: unknown): value is SetupInfo {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as { ok?: unknown; csrf?: unknown; steps?: unknown; writable?: unknown }
  return row.ok === true && typeof row.csrf === 'string' && Array.isArray(row.steps) && typeof row.writable === 'boolean'
}

function isProbe(value: unknown): value is { ok: true; git: boolean; warning: string | null } | { ok: false; reason: string } {
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

function validate(step: string, form: Form): string | null {
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

function withStepDefaults(stepId: string, form: Form): Form {
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

function buildConfig(form: Form): { ok: true; config: Record<string, unknown> } | { ok: false; reason: string } {
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

function readError(body: unknown): string {
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

export function SetupWizard() {
  const [info, setInfo] = useState<SetupInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [form, setForm] = useState<Form>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/setup', { cache: 'no-store' })
      .then(async (res) => {
        const body: unknown = await res.json()
        if (cancelled) {
          return
        }
        if (!isSetup(body) || body.steps.length === 0 || body.steps.some((step) => !KNOWN.has(step.id))) {
          setLoadError('Мастер не ответил')
          return
        }
        setInfo(body)
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError('Мастер не ответил')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    heading.current?.focus()
  }, [index])

  const step = info?.steps[index]
  const last = info ? index === info.steps.length - 1 : false

  function updateBot(botIndex: number, patch: Partial<BotForm>, touchId = false) {
    setForm((prev) => ({
      ...prev,
      bots: prev.bots.map((bot, i) => {
        if (i !== botIndex) {
          return bot
        }
        const next = { ...bot, ...patch }
        if (patch.name !== undefined && !bot.idTouched) {
          next.id = slugify(patch.name, `bot-${botIndex + 1}`)
        }
        if (touchId) {
          next.idTouched = true
        }
        return next
      }),
    }))
  }

  function goNext() {
    if (!step || busy) {
      return
    }
    const problem = validate(step.id, form)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setForm((prev) => withStepDefaults(step.id, prev))
    setIndex((current) => current + 1)
  }

  async function checkSource() {
    if (!info) {
      return
    }
    const pathValue = form.sourcePath.trim()
    if (!projectFolderOk(pathValue)) {
      setError('Укажите папку проекта')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/setup/source?path=${encodeURIComponent(pathValue)}`, {
        cache: 'no-store',
        headers: { 'X-CSRF-Token': info.csrf },
      })
      const body: unknown = await res.json()
      if (!isProbe(body)) {
        setError('Проверка пути не ответила')
        setForm((prev) => ({ ...prev, probe: null }))
        return
      }
      if (!body.ok) {
        setError(body.reason)
        setForm((prev) => ({ ...prev, probe: null }))
        return
      }
      setForm((prev) => ({
        ...prev,
        probe: { path: pathValue, git: body.git, warning: body.warning },
      }))
    } catch {
      setError('Проверка пути не ответила')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!info || !step || busy) {
      return
    }
    // Назад и смена id не должны оставить в конфиге бота, которого уже нет.
    const prepared = withStepDefaults('project', withStepDefaults('bots', form))
    for (const item of info.steps) {
      const problem = validate(item.id, prepared)
      if (problem) {
        setForm(prepared)
        setError(problem)
        return
      }
    }
    if (!info.writable) {
      setError('Этот файл мастер не перезаписывает.')
      return
    }
    if (info.exists && !form.confirmOverwrite) {
      setError('Файл уже есть. Отметьте замену, иначе он останется как был.')
      return
    }
    const built = buildConfig(prepared)
    if (!built.ok) {
      setError(built.reason)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': info.csrf,
        },
        body: JSON.stringify({ confirm_overwrite: form.confirmOverwrite, config: built.config }),
      })
      const body: unknown = await res.json()
      if (!res.ok) {
        setError(readError(body))
        setBusy(false)
        return
      }
      window.location.assign('/')
    } catch {
      setError('Запись не прошла')
      setBusy(false)
    }
  }

  const pathValue = form.sourcePath.trim()
  const probe = form.probe && form.probe.path === pathValue ? form.probe : null

  return (
    <main className={step?.id === 'access' ? 'setup wizard wide' : 'setup wizard'} data-testid="setup-wizard">
      <p className="k">Мастер</p>
      <h1 tabIndex={-1} ref={heading}>{step?.id === 'access' ? 'Доступ к проекту' : 'Настроить'}</h1>
      {loadError ? <p data-testid="setup-error">{loadError}</p> : null}
      {!info && !loadError ? <p data-testid="setup-loading">Загрузка мастера</p> : null}
      {info && step ? (
        <>
          <p className="sub">
            Шаг {index + 1} из {info.steps.length}. Файл: {safeTarget(info.target)}.
            {info.required ? ' Своего конфига ещё нет.' : ''}
          </p>
          {info.demo ? <p><a className="btn" href="/?demo=1" data-testid="open-demo">Открыть демо</a></p> : null}
          <ol className="steps" aria-label="Шаги мастера" data-testid="setup-steps" data-steps={info.steps.length}>
            {info.steps.map((item, itemIndex) => (
              <li
                key={item.id}
                data-testid="setup-step"
                data-step={item.id}
                className={itemIndex === index ? 'on' : undefined}
                aria-current={itemIndex === index ? 'step' : undefined}
              >
                {item.title}
              </li>
            ))}
          </ol>

          {step.id === 'owner' ? (
            <div>
              <label className="field">
                <span>Имя владельца</span>
                <input data-testid="owner-name" value={form.ownerName} autoComplete="off" onChange={(event) => setForm({ ...form, ownerName: event.target.value })} />
              </label>
              <label className="check">
                <input data-testid="owner-confirms" type="checkbox" checked={form.confirms} onChange={(event) => setForm({ ...form, confirms: event.target.checked })} />
                Владелец подтверждает мерж
              </label>
            </div>
          ) : null}

          {step.id === 'bots' ? (
            <div>
              {form.bots.map((bot, botIndex) => (
                <div className="bot-row" key={botIndex}>
                  <label className="field">
                    <span>Имя</span>
                    <input data-testid={`bot-name-${botIndex}`} value={bot.name} autoComplete="off" onChange={(event) => updateBot(botIndex, { name: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>Роль</span>
                    <input data-testid={`bot-role-${botIndex}`} value={bot.role} autoComplete="off" onChange={(event) => updateBot(botIndex, { role: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>Id</span>
                    <input data-testid={`bot-id-${botIndex}`} value={bot.id} autoComplete="off" onChange={(event) => updateBot(botIndex, { id: event.target.value }, true)} />
                  </label>
                  <label className="field">
                    <span>Аватар, можно пустым</span>
                    <input data-testid={`bot-avatar-${botIndex}`} value={bot.avatar} autoComplete="off" onChange={(event) => updateBot(botIndex, { avatar: event.target.value })} />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      data-testid={`bot-api-${botIndex}`}
                      checked={bot.api}
                      onChange={(event) => updateBot(botIndex, { api: event.target.checked })}
                    />
                    Свой API-бот
                  </label>
                  {bot.api ? (
                    <div>
                      <label className="field">
                        <span>Инструкции</span>
                        <textarea data-testid={`bot-instructions-${botIndex}`} value={bot.instructions} onChange={(event) => updateBot(botIndex, { instructions: event.target.value })} />
                      </label>
                      <label className="field">
                        <span>Провайдер</span>
                        <select data-testid={`bot-provider-${botIndex}`} value={bot.provider} onChange={(event) => updateBot(botIndex, { provider: event.target.value })}>
                          <option value="deepseek">deepseek</option>
                          <option value="qwen">qwen</option>
                          <option value="other">другой</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Модель</span>
                        <input data-testid={`bot-model-${botIndex}`} value={bot.model} autoComplete="off" onChange={(event) => updateBot(botIndex, { model: event.target.value })} />
                      </label>
                      <label className="field">
                        <span>Имя переменной ключа</span>
                        <input data-testid={`bot-key-${botIndex}`} value={bot.apiKeyEnv} autoComplete="off" onChange={(event) => updateBot(botIndex, { apiKeyEnv: event.target.value })} />
                      </label>
                      <label className="field">
                        <span>base_url, можно пустым для deepseek и qwen</span>
                        <input data-testid={`bot-base-${botIndex}`} value={bot.baseUrl} autoComplete="off" onChange={(event) => updateBot(botIndex, { baseUrl: event.target.value })} />
                      </label>
                      <label className="field">
                        <span>Доступ к папке проекта</span>
                        <select
                          data-testid={`bot-tools-${botIndex}`}
                          value={bot.projectTools}
                          onChange={(event) => updateBot(botIndex, { projectTools: event.target.value === 'read' || event.target.value === 'propose' ? event.target.value : 'off' })}
                        >
                          <option value="off">выключен</option>
                          <option value="read">только чтение</option>
                          <option value="propose">чтение и предложения</option>
                        </select>
                      </label>
                    </div>
                  ) : null}
                  {form.bots.length > 1 ? (
                    <button type="button" className="btn" onClick={() => setForm((prev) => ({ ...prev, bots: prev.bots.filter((_, i) => i !== botIndex) }))}>
                      Убрать
                    </button>
                  ) : null}
                </div>
              ))}
              <p className="sub">Ключ остаётся в .env. В конфиг пишется только имя переменной. У бота Grok доступа к папке нет.</p>
              {form.bots.length < 8 ? (
                <button type="button" className="btn" onClick={() => setForm((prev) => ({ ...prev, bots: [...prev.bots, emptyBot()] }))}>
                  Ещё бот
                </button>
              ) : null}
            </div>
          ) : null}

          {step.id === 'project' ? (
            <div>
              <label className="field">
                <span>Название</span>
                <input
                  data-testid="project-title"
                  value={form.projectTitle}
                  autoComplete="off"
                  onChange={(event) => setForm((prev) => ({
                    ...prev,
                    projectTitle: event.target.value,
                    projectId: prev.projectIdTouched ? prev.projectId : slugify(event.target.value, 'project'),
                  }))}
                />
              </label>
              <label className="field">
                <span>Id</span>
                <input data-testid="project-id" value={form.projectId} autoComplete="off" onChange={(event) => setForm({ ...form, projectId: event.target.value, projectIdTouched: true })} />
              </label>
              <label className="field">
                <span>Главный в проекте</span>
                <select data-testid="project-lead" value={form.lead} onChange={(event) => setForm({ ...form, lead: event.target.value })}>
                  {form.bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name || bot.id}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Исполнитель мержа</span>
                <select data-testid="project-executor" value={form.executor} onChange={(event) => setForm({ ...form, executor: event.target.value })}>
                  {form.bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name || bot.id}</option>)}
                </select>
              </label>
            </div>
          ) : null}

          {step.id === 'chats' ? (
            <div>
              <label className="field">
                <span>Название чата</span>
                <input
                  data-testid="chat-title"
                  value={form.chatTitle}
                  autoComplete="off"
                  onChange={(event) => setForm((prev) => ({
                    ...prev,
                    chatTitle: event.target.value,
                    chatId: prev.chatIdTouched ? prev.chatId : slugify(event.target.value, 'chat'),
                  }))}
                />
              </label>
              <label className="field">
                <span>Id</span>
                <input data-testid="chat-id" value={form.chatId} autoComplete="off" onChange={(event) => setForm({ ...form, chatId: event.target.value, chatIdTouched: true })} />
              </label>
              <label className="field">
                <span>Главный в чате</span>
                <select data-testid="chat-lead" value={form.chatLead} onChange={(event) => setForm({ ...form, chatLead: event.target.value })}>
                  {form.bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name || bot.id}</option>)}
                </select>
              </label>
              <fieldset className="field">
                <legend>Участники</legend>
                {form.bots.map((bot) => (
                  <label className="check" key={bot.id}>
                    <input
                      type="checkbox"
                      checked={form.members.includes(bot.id)}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...form.members, bot.id]
                          : form.members.filter((id) => id !== bot.id)
                        setForm({ ...form, members: next })
                      }}
                    />
                    {bot.name || bot.id}
                  </label>
                ))}
              </fieldset>
              <label className="field">
                <span>Делают</span>
                <textarea data-testid="rules-do" value={form.rulesDo} onChange={(event) => setForm({ ...form, rulesDo: event.target.value })} />
              </label>
              <label className="field">
                <span>Не делают</span>
                <textarea data-testid="rules-dont" value={form.rulesDont} onChange={(event) => setForm({ ...form, rulesDont: event.target.value })} />
              </label>
            </div>
          ) : null}

          {step.id === 'source' ? (
            <div>
              <label className="field">
                <span>Папка проекта — любая, в том числе вне лаунчера</span>
                <input
                  data-testid="source-path"
                  value={form.sourcePath}
                  autoComplete="off"
                  onChange={(event) => setForm((prev) => ({ ...prev, sourcePath: event.target.value, probe: null }))}
                />
              </label>
              <button type="button" className="btn" data-testid="source-check" disabled={busy} onClick={() => void checkSource()}>
                Проверить путь
              </button>
              {probe?.warning ? <p className="warn-box" data-testid="git-warning">{probe.warning}</p> : null}
              {probe?.git ? <p className="ok-box" data-testid="git-ok">Git в папке есть</p> : null}
              {probe?.git ? (
                <label className="field">
                  <span>Репозиторий GitHub, можно пустым</span>
                  <input data-testid="source-repo" value={form.repo} autoComplete="off" placeholder="example/demo-game" onChange={(event) => setForm({ ...form, repo: event.target.value })} />
                </label>
              ) : null}
            </div>
          ) : null}

          {step.id === 'access' ? (
            <div>
              <p className="sub">Шаг можно поменять потом в настройках бота. Grok папку не видит.</p>
              {form.bots.map((bot, botIndex) => bot.api ? (
                <div key={bot.id || botIndex} data-testid={`wizard-access-${botIndex}`}>
                  <div className="k">{bot.name || 'бот'}</div>
                  <div className="rcards">
                    <label className={bot.projectTools === 'off' ? 'rcard on' : 'rcard'}>
                      <input type="radio" name={`wiz-tools-${botIndex}`} data-testid={`wiz-tools-off-${botIndex}`} checked={bot.projectTools === 'off'} onChange={() => updateBot(botIndex, { projectTools: 'off' })} />
                      <b>Выключено</b>
                      <small>бот не видит файлы</small>
                      <span className="def">по умолчанию</span>
                    </label>
                    <label className={bot.projectTools === 'read' ? 'rcard on' : 'rcard'}>
                      <input type="radio" name={`wiz-tools-${botIndex}`} data-testid={`wiz-tools-read-${botIndex}`} checked={bot.projectTools === 'read'} onChange={() => setForm((current) => ({ ...current, allowTools: true, bots: current.bots.map((item, i) => i === botIndex ? { ...item, projectTools: 'read' } : item) }))} />
                      <b>Только чтение</b>
                      <small>поиск и чтение файлов</small>
                    </label>
                    <label className={bot.projectTools === 'propose' ? 'rcard on' : 'rcard'}>
                      <input type="radio" name={`wiz-tools-${botIndex}`} data-testid={`wiz-tools-propose-${botIndex}`} checked={bot.projectTools === 'propose'} onChange={() => setForm((current) => ({ ...current, allowTools: true, bots: current.bots.map((item, i) => i === botIndex ? { ...item, projectTools: 'propose' } : item) }))} />
                      <b>Чтение и правки</b>
                      <small>бот предлагает, применяете вы</small>
                    </label>
                  </div>
                  {bot.projectTools === 'off' ? <p className="hint-off">Пока выключено, переключатели ниже не действуют.</p> : null}
                  <div className={bot.projectTools === 'off' ? 'off-area' : undefined}>
                    <label className="sw">
                      <input type="checkbox" data-testid="allow-bot-tools" checked={form.allowTools} onChange={(event) => setForm({ ...form, allowTools: event.target.checked })} />
                      Разрешить инструментам ботов читать эту папку
                    </label>
                    <label className="sw">
                      <input type="checkbox" data-testid="respect-gitignore" checked={form.respectGitignore} onChange={(event) => setForm({ ...form, respectGitignore: event.target.checked })} />
                      Не читать файлы из .gitignore
                    </label>
                    <div className="seg" data-testid={`wiz-apply-${botIndex}`}>
                      <label className={bot.applyMode === 'git' ? 'on' : ''}>
                        <input type="radio" name={`wiz-apply-${botIndex}`} data-testid={`wiz-apply-git-${botIndex}`} checked={bot.applyMode === 'git'} disabled={!form.probe?.git} onChange={() => updateBot(botIndex, { applyMode: 'git' })} />
                        Git-ветка {form.probe?.git ? <span className="rec">реком.</span> : null}
                      </label>
                      <label className={bot.applyMode === 'files' ? 'on' : ''}>
                        <input type="radio" name={`wiz-apply-${botIndex}`} data-testid={`wiz-apply-files-${botIndex}`} checked={bot.applyMode === 'files'} onChange={() => updateBot(botIndex, { applyMode: 'files' })} />
                        Снимок файлов
                      </label>
                    </div>
                    {form.probe?.git ? null : <p className="sub">В папке нет git — ветка недоступна, будет снимок.</p>}
                  </div>
                  <div className="alert warn" data-testid="tools-provider-warning">Прочитанные файлы уходят провайдеру модели по вашему ключу и тратят токены. .env, ключи, сертификаты и .git бот не видит никогда.</div>
                  <div className="alert info">Защиты те же: без удаления и переименования, не больше 20 файлов, не больше половины файла.</div>
                </div>
              ) : (
                <p key={bot.id || botIndex} className="sub" data-testid={`wizard-grok-${botIndex}`}>У бота Grok нет доступа к папке.</p>
              ))}
            </div>
          ) : null}

          {step.id === 'delivery' ? (
            <fieldset className="field">
              <legend>Как отдать бриф</legend>
              <label className="check">
                <input type="radio" name="delivery" checked={form.delivery === 'clipboard'} onChange={() => setForm({ ...form, delivery: 'clipboard' })} />
                Скопировать бриф
              </label>
              <label className="check">
                <input type="radio" name="delivery" data-testid="delivery-queue" checked={form.delivery === 'queue'} onChange={() => setForm({ ...form, delivery: 'queue' })} />
                Очередь в файлах
              </label>
              <p className="sub">Очередь по умолчанию выключена.</p>
            </fieldset>
          ) : null}

          {step.id === 'economy' ? (
            <div>
              <p className="sub">Будим только упомянутого. Ответ по умолчанию короткий.</p>
              <label className="field">
                <span>Лимит ответа</span>
                <select data-testid="reply-limit" value={form.reply} onChange={(event) => setForm({ ...form, reply: event.target.value === 'long' ? 'long' : 'short' })}>
                  <option value="short">короткий</option>
                  <option value="long">длинный</option>
                </select>
              </label>
              <label className="field">
                <span>Пробуждений на задачу</span>
                <input data-testid="max-wakes" value={form.wakes} inputMode="numeric" onChange={(event) => setForm({ ...form, wakes: event.target.value })} />
              </label>
              <label className="field">
                <span>Записка устаревает через, часов</span>
                <input data-testid="stale-hours" value={form.stale} inputMode="decimal" onChange={(event) => setForm({ ...form, stale: event.target.value })} />
              </label>
              {info.exists ? (
                <label className="check">
                  <input data-testid="confirm-overwrite" type="checkbox" checked={form.confirmOverwrite} onChange={(event) => setForm({ ...form, confirmOverwrite: event.target.checked })} />
                  Заменить существующий конфиг
                </label>
              ) : null}
              {!info.writable ? <p className="sub">Демо-файл мастер не перезаписывает. Свой конфиг появится при запуске без готового config.yaml.</p> : null}
            </div>
          ) : null}

          {error ? <p data-testid="setup-error">{error}</p> : null}
          <div className="wizard-actions">
            {index > 0 ? (
              <button type="button" className="btn" data-testid="setup-back" onClick={() => { setError(null); setIndex((current) => current - 1) }}>
                Назад
              </button>
            ) : null}
            {!last ? (
              <button type="button" className="btn primary" data-testid="setup-next" onClick={goNext}>
                Дальше
              </button>
            ) : (
              <button type="button" className="btn primary" data-testid="setup-save" disabled={busy || !info.writable} onClick={() => void save()}>
                Записать и открыть пульт
              </button>
            )}
          </div>
        </>
      ) : null}
    </main>
  )
}

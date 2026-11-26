/**
 * FILE: apps/web/src/ui/setup-wizard.tsx
 * НАЗНАЧЕНИЕ: каркас мастера на shadcn. Восемь шагов, рейл, тема, запись config.yaml.
 * ВХОД: GET /api/setup. ВЫХОД: POST /api/setup и переход на пульт.
 * Узкий экран прячет степпер. Enter идёт дальше, кроме summary, кнопок и полей выбора.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { FileText, Info, Lock, Moon, Sparkles, Sun, TriangleAlert } from 'lucide-react'
import { followPointer } from '../avatars/tinybots-avatar.js'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { RadioCard, RadioGroup } from '@/components/ui/radio-group'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleItem } from '@/components/ui/toggle-group'
import { TooltipProvider } from '@/components/ui/tooltip'
import '../wizard.css'
import { BotAvatar } from './bot-avatar'
import { BotsStep } from './setup-bots'
import {
  EXTRA_PROBLEMS,
  KNOWN,
  buildConfig,
  autoBotId,
  emptyForm,
  finalizeBots,
  finishManualBotId,
  isProbe,
  isSetup,
  projectFolderOk,
  readError,
  safeTarget,
  slugify,
  validate,
  withExtraOpen,
  withStepDefaults,
  type BotForm,
  type Form,
  type SetupInfo,
} from './setup-model'

const STEP_VIEW: Record<string, { title: string; hint: string; heading: string; desc: string }> = {
  owner: { title: 'Владелец', hint: 'Кто подтверждает мерж', heading: 'Кто владелец', desc: 'Начнём с вас. Это одна строка.' },
  bots: { title: 'Боты', hint: 'Имя, роль, модель', heading: 'Боты', desc: 'Кто будет работать в проекте. Каждый бот — своя вкладка.' },
  project: { title: 'Проект', hint: 'Название и главный', heading: 'Проект', desc: 'Название, id и кто здесь главный.' },
  chats: { title: 'Чаты', hint: 'Кто в чате и правила', heading: 'Чаты', desc: 'Один чат: кто в нём и два правила.' },
  source: { title: 'Папка', hint: 'Где лежит проект', heading: 'Папка', desc: 'Где лежат файлы. Папка может быть вне лаунчера.' },
  access: { title: 'Доступ', hint: 'Что боту можно', heading: 'Доступ к проекту', desc: 'Что бот может делать с файлами. Меняется потом в настройках бота.' },
  delivery: { title: 'Доставка', hint: 'Как отдать бриф', heading: 'Доставка', desc: 'Как отдать бриф. Очередь по умолчанию выключена.' },
  economy: { title: 'Экономия', hint: 'Лимиты ответов', heading: 'Экономия', desc: 'Чтобы боты не тратили лишнего. Значения по умолчанию уже разумные.' },
}

function toolsLabel(level: BotForm['projectTools']): string {
  if (level === 'read') return 'только чтение'
  if (level === 'propose') return 'чтение и правки'
  return 'выключено'
}

export function SetupWizard() {
  const [info, setInfo] = useState<SetupInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [form, setForm] = useState<Form>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState(0)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [layer, setLayer] = useState<HTMLDivElement | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => followPointer(document), [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/setup', { cache: 'no-store' })
      .then(async (res) => {
        const body: unknown = await res.json()
        if (cancelled) return
        if (!isSetup(body) || body.steps.length === 0 || body.steps.some((step) => !KNOWN.has(step.id))) {
          setLoadError('Мастер не ответил')
          return
        }
        setInfo(body)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Мастер не ответил')
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => { heading.current?.focus() }, [index])

  const step = info?.steps[index]
  const last = info ? index === info.steps.length - 1 : false
  const view = STEP_VIEW[step?.id ?? 'owner'] ?? STEP_VIEW.owner

  function updateBot(botIndex: number, patch: Partial<BotForm>, touchId = false) {
    setForm((prev) => ({
      ...prev,
      bots: prev.bots.map((bot, i) => {
        if (i !== botIndex) return bot
        const next = { ...bot, ...patch }
        if (touchId) next.idTouched = true
        // Пока id не правили руками, он едет за именем: Ревик → revik-bot.
        if (patch.name !== undefined && !next.idTouched) {
          const taken = new Set(prev.bots.flatMap((item, j) => (j === i || item.id.trim().length === 0 ? [] : [item.id.trim()])))
          next.id = autoBotId(next.name, i, taken)
        }
        return next
      }),
    }))
  }

  function commitBotId(botIndex: number) {
    setForm((prev) => ({
      ...prev,
      bots: prev.bots.map((bot, i) => (i === botIndex ? { ...bot, id: finishManualBotId(bot.id), idTouched: true } : bot)),
    }))
  }

  function writeBot(botIndex: number, recipe: (bot: BotForm) => BotForm) {
    setForm((prev) => ({ ...prev, bots: prev.bots.map((bot, i) => (i === botIndex ? recipe(bot) : bot)) }))
  }

  function goNext() {
    if (!step || busy) return
    const current = step.id === 'bots' ? { ...form, bots: finalizeBots(form.bots) } : form
    const problem = validate(step.id, current)
    if (problem) {
      setForm(EXTRA_PROBLEMS.has(problem) ? withExtraOpen(current) : current)
      setError(problem)
      return
    }
    setError(null)
    setAvatarOpen(false)
    setForm(withStepDefaults(step.id, current))
    setIndex((current) => current + 1)
  }

  async function checkSource() {
    if (!info) return
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
      setForm((prev) => ({ ...prev, probe: { path: pathValue, git: body.git, warning: body.warning } }))
    } catch {
      setError('Проверка пути не ответила')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!info || !step || busy) return
    const prepared = withStepDefaults('project', withStepDefaults('bots', { ...form, bots: finalizeBots(form.bots) }))
    for (const item of info.steps) {
      const problem = validate(item.id, prepared)
      if (problem) {
        setForm(EXTRA_PROBLEMS.has(problem) ? withExtraOpen(prepared) : prepared)
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
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': info.csrf },
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

  function onWizardKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (target.closest('textarea, summary, button, a, select')) return
    if (target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio')) return
    if (avatarOpen) return
    event.preventDefault()
    if (last) void save()
    else goNext()
  }

  const pathValue = form.sourcePath.trim()
  const probe = form.probe && form.probe.path === pathValue ? form.probe : null
  const preview = step?.id === 'economy' ? buildConfig(withStepDefaults('project', withStepDefaults('bots', form))) : null

  return (
    <TooltipProvider>
      <div className={theme === 'dark' ? 'tb-wizard dark' : 'tb-wizard'} onKeyDown={onWizardKey}>
        <header className="flex h-16 items-center justify-between gap-3 px-6 max-[719px]:px-3">
          <div className="flex items-center gap-2.5 text-sm">
            <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground"><Sparkles width={16} height={16} /></span>
            <b>TinyBots</b>
            <span className="text-border">/</span>
            <h1 className="text-sm font-medium text-muted-foreground">Настроить</h1>
          </div>
          <div className="flex items-center gap-2">
            {info ? <Badge><FileText width={12} height={12} />{safeTarget(info.target)} · {info.exists ? 'есть' : 'новый'}</Badge> : null}
            <Button variant="ghost" size="icon" data-testid="setup-theme" aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun width={16} height={16} /> : <Moon width={16} height={16} />}
            </Button>
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col px-6 pb-6 max-[719px]:px-3" data-testid="setup-wizard">
          <div className="wz-shell">
            <aside className="wz-rail">
              <div className="px-2 pb-3.5">
                <span className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Шаг {info ? index + 1 : 1} из {info?.steps.length ?? 8}</span>
                <p className="wz-narrow mt-1 text-sm font-semibold">{view?.title}</p>
                <Progress value={info && info.steps.length > 0 ? ((index + 1) / info.steps.length) * 100 : 12} />
              </div>
              {info ? (
                <ol className="wz-steps" aria-label="Шаги мастера" data-testid="setup-steps" data-steps={info.steps.length}>
                  {info.steps.map((item, itemIndex) => {
                    const meta = STEP_VIEW[item.id] ?? { title: item.title, hint: '' }
                    const state = itemIndex < index ? 'done' : itemIndex === index ? 'on' : 'todo'
                    return (
                      <li key={item.id} data-testid="setup-step" data-step={item.id} aria-current={itemIndex === index ? 'step' : undefined} className={state === 'on' ? 'flex items-center gap-2.5 rounded-md bg-card px-2 py-1.5 shadow-[0_0_0_1px_var(--border)]' : 'flex items-center gap-2.5 rounded-md px-2 py-1.5'}>
                        <span className={state === 'done' ? 'grid size-6 place-items-center rounded-full bg-primary text-primary-foreground' : state === 'on' ? 'grid size-6 place-items-center rounded-full border-2 border-primary text-xs font-bold text-primary' : 'grid size-6 place-items-center rounded-full border border-input bg-card text-xs font-bold text-muted-foreground'}>
                          {state === 'done' ? '✓' : itemIndex + 1}
                        </span>
                        <span className="flex flex-col">
                          <b className={state === 'todo' ? 'text-[13px] font-medium text-muted-foreground' : 'text-[13px] font-semibold'}>{meta.title}</b>
                          <small className="text-[11.5px] text-muted-foreground">{meta.hint}</small>
                        </span>
                      </li>
                    )
                  })}
                </ol>
              ) : null}
              <p className="wz-rail-foot mt-auto flex items-center gap-1.5 px-2 text-[11.5px] text-muted-foreground"><Lock width={12} height={12} /> Ключи вводятся только в окне «Ключи»</p>
            </aside>
            <Card>
              <CardHeader>
                <CardTitle tabIndex={-1} ref={heading}>{view?.heading}</CardTitle>
                <CardDescription>{view?.desc}</CardDescription>
              </CardHeader>
              <CardContent>
                {loadError ? <p data-testid="setup-error">{loadError}</p> : null}
                {!info && !loadError ? <p data-testid="setup-loading">Загрузка мастера</p> : null}
                {info?.demo ? <p><Button variant="outline" asChild><a href="/?demo=1" data-testid="open-demo">Открыть демо</a></Button></p> : null}
                {info && step?.id === 'owner' ? (
                  <div className="flex flex-col gap-3.5">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="owner-name">Имя владельца</Label>
                      <Input id="owner-name" data-testid="owner-name" value={form.ownerName} autoComplete="off" onChange={(event) => setForm({ ...form, ownerName: event.target.value })} />
                      <p className="text-xs text-muted-foreground">Так боты будут к вам обращаться в чатах.</p>
                    </div>
                    <Switch data-testid="owner-confirms" checked={form.confirms} label="Владелец подтверждает мерж" hint="Боты не мержат сами. Ветка вливается только после вашего «мержи»." onChange={(event) => setForm({ ...form, confirms: event.target.checked })} />
                    {info.required ? <Alert icon={<Info width={16} height={16} />} title="Своего конфига ещё нет">Мастер создаст <code className="wz-mono rounded bg-muted px-1">{safeTarget(info.target)}</code>. Всё можно поменять потом.</Alert> : null}
                  </div>
                ) : null}
                {info && step?.id === 'bots' ? (
                  <BotsStep form={form} tab={tab} setTab={setTab} avatarOpen={avatarOpen} setAvatarOpen={setAvatarOpen} layer={layer} setForm={setForm} updateBot={updateBot} writeBot={writeBot} commitBotId={commitBotId} idError={error} />
                ) : null}
                {info && step?.id === 'project' ? (
                  <div className="flex flex-col gap-3.5">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="project-title">Название</Label>
                      <Input id="project-title" data-testid="project-title" value={form.projectTitle} autoComplete="off" onChange={(event) => setForm((prev) => ({ ...prev, projectTitle: event.target.value, projectId: prev.projectIdTouched ? prev.projectId : slugify(event.target.value, 'project') }))} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="project-id">Id</Label>
                      <Input id="project-id" className="wz-mono" data-testid="project-id" value={form.projectId} autoComplete="off" onChange={(event) => setForm({ ...form, projectId: event.target.value, projectIdTouched: true })} />
                    </div>
                    <div className="wz-pair">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="project-lead">Главный в проекте</Label>
                        <Select id="project-lead" data-testid="project-lead" value={form.lead} onChange={(event) => setForm({ ...form, lead: event.target.value })}>
                          {form.bots.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
                        </Select>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="project-executor">Исполнитель мержа</Label>
                        <Select id="project-executor" data-testid="project-executor" value={form.executor} onChange={(event) => setForm({ ...form, executor: event.target.value })}>
                          {form.bots.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
                        </Select>
                      </div>
                    </div>
                  </div>
                ) : null}
                {info && step?.id === 'chats' ? (
                  <div className="flex flex-col gap-3.5">
                    <div className="wz-pair">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="chat-title">Название чата</Label>
                        <Input id="chat-title" data-testid="chat-title" value={form.chatTitle} autoComplete="off" onChange={(event) => setForm((prev) => ({ ...prev, chatTitle: event.target.value, chatId: prev.chatIdTouched ? prev.chatId : slugify(event.target.value, 'chat') }))} />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="chat-id">Id</Label>
                        <Input id="chat-id" className="wz-mono" data-testid="chat-id" value={form.chatId} autoComplete="off" onChange={(event) => setForm({ ...form, chatId: event.target.value, chatIdTouched: true })} />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="chat-lead">Главный в чате</Label>
                      <Select id="chat-lead" data-testid="chat-lead" value={form.chatLead} onChange={(event) => setForm({ ...form, chatLead: event.target.value })}>
                        {form.bots.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
                      </Select>
                    </div>
                    <fieldset className="flex flex-col gap-2 border-0 p-0">
                      <legend className="text-[13px] font-semibold">Участники</legend>
                      {form.bots.map((item) => (
                        <Checkbox key={item.id || item.name} checked={form.members.includes(item.id)} label={item.name || item.id} onChange={(event) => {
                          const next = event.target.checked ? [...form.members, item.id] : form.members.filter((id) => id !== item.id)
                          setForm({ ...form, members: next })
                        }} />
                      ))}
                    </fieldset>
                    <div className="wz-pair">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="rules-do">Делают</Label>
                        <Textarea id="rules-do" data-testid="rules-do" value={form.rulesDo} onChange={(event) => setForm({ ...form, rulesDo: event.target.value })} />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="rules-dont">Не делают</Label>
                        <Textarea id="rules-dont" data-testid="rules-dont" value={form.rulesDont} onChange={(event) => setForm({ ...form, rulesDont: event.target.value })} />
                      </div>
                    </div>
                  </div>
                ) : null}
                {info && step?.id === 'source' ? (
                  <div className="flex flex-col gap-3.5">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="source-path">Папка проекта — любая, в том числе вне лаунчера</Label>
                      <Input id="source-path" className="wz-mono" data-testid="source-path" value={form.sourcePath} autoComplete="off" onChange={(event) => setForm((prev) => ({ ...prev, sourcePath: event.target.value, probe: null }))} />
                    </div>
                    <div><Button variant="outline" data-testid="source-check" disabled={busy} onClick={() => void checkSource()}>Проверить путь</Button></div>
                    {probe?.warning ? <p className="wz-warn" data-testid="git-warning">{probe.warning}</p> : null}
                    {probe?.git ? <p className="rounded-lg border border-border bg-accent/60 px-4 py-3 text-sm" data-testid="git-ok">Git в папке есть</p> : null}
                    {probe?.git ? (
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="source-repo">Репозиторий GitHub, можно пустым</Label>
                        <Input id="source-repo" className="wz-mono" data-testid="source-repo" value={form.repo} autoComplete="off" placeholder="example/demo-game" onChange={(event) => setForm({ ...form, repo: event.target.value })} />
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {info && step?.id === 'access' ? (
                  <div className="flex flex-col gap-4">
                    {form.bots.map((item, botIndex) => item.api ? (
                      <div key={item.id || botIndex} className="flex flex-col gap-3.5" data-testid={`wizard-access-${botIndex}`}>
                        <div className="flex items-center gap-3 rounded-lg border border-border py-2 pr-3 pl-2">
                          <span className="grid size-9 place-items-center rounded-[10px] bg-muted">{item.avatarId ? <BotAvatar id={item.avatarId} color={item.avatarColor} state="idle" size={30} /> : null}</span>
                          <div className="min-w-0 flex-1"><b>{item.name || 'бот'}</b><span className="text-muted-foreground"> · {item.role || 'роль'} · {item.provider}</span></div>
                          <Badge variant="mono" className="wz-mono">{form.sourcePath || 'папка'}</Badge>
                        </div>
                        <RadioGroup label={`Доступ ${item.name || botIndex}`}>
                          <RadioCard title="Выключено" hint="Бот видит только чат." name={`wiz-tools-${botIndex}`} data-testid={`wiz-tools-off-${botIndex}`} checked={item.projectTools === 'off'} onChange={() => updateBot(botIndex, { projectTools: 'off' })} />
                          <RadioCard title="Только чтение" hint="Читает и ищет по файлам." name={`wiz-tools-${botIndex}`} data-testid={`wiz-tools-read-${botIndex}`} checked={item.projectTools === 'read'} onChange={() => setForm((current) => ({ ...current, allowTools: true, bots: current.bots.map((row, i) => i === botIndex ? { ...row, projectTools: 'read' } : row) }))} />
                          <RadioCard title="Чтение и правки" hint="Предлагает правки, применяете вы." name={`wiz-tools-${botIndex}`} data-testid={`wiz-tools-propose-${botIndex}`} checked={item.projectTools === 'propose'} onChange={() => setForm((current) => ({ ...current, allowTools: true, bots: current.bots.map((row, i) => i === botIndex ? { ...row, projectTools: 'propose' } : row) }))} />
                        </RadioGroup>
                        {item.projectTools === 'off' ? <p className="text-xs text-muted-foreground">Пока выключено, переключатели ниже не действуют.</p> : null}
                        <div className="rounded-lg border border-border px-4">
                          <Switch flat data-testid="allow-bot-tools" checked={form.allowTools} label="Разрешить инструментам ботов читать эту папку" onChange={(event) => setForm({ ...form, allowTools: event.target.checked })} />
                          <Switch flat data-testid="respect-gitignore" checked={form.respectGitignore} label="Не читать файлы из .gitignore" hint="Сборки, кэш и локальные файлы бот пропустит." onChange={(event) => setForm({ ...form, respectGitignore: event.target.checked })} />
                          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3">
                            <div>
                              <b className="block text-sm">Как применять правки</b>
                              <p className="text-[13px] text-muted-foreground">{probe?.git ? 'В папке найден git — ветка безопаснее.' : 'В папке нет git — ветка недоступна, будет снимок.'}</p>
                            </div>
                            <ToggleGroup data-testid={`wiz-apply-${botIndex}`}>
                              <ToggleItem name={`wiz-apply-${botIndex}`} data-testid={`wiz-apply-git-${botIndex}`} checked={item.applyMode === 'git'} disabled={!probe?.git} onChange={() => updateBot(botIndex, { applyMode: 'git' })}>Git-ветка {probe?.git ? <Badge variant="soft">реком.</Badge> : null}</ToggleItem>
                              <ToggleItem name={`wiz-apply-${botIndex}`} data-testid={`wiz-apply-files-${botIndex}`} checked={item.applyMode === 'files'} onChange={() => updateBot(botIndex, { applyMode: 'files' })}>Снимок файлов</ToggleItem>
                            </ToggleGroup>
                          </div>
                        </div>
                        <Alert variant="warning" data-testid="tools-provider-warning" icon={<TriangleAlert width={16} height={16} />} title="Прочитанные файлы уходят провайдеру модели">
                          По вашему ключу и тратят токены. <code className="wz-mono">.env</code>, ключи, сертификаты и <code className="wz-mono">.git</code> бот не видит никогда.
                        </Alert>
                        <p className="text-xs text-muted-foreground">Защиты те же: без удаления и переименования, не больше 20 файлов, не больше половины файла.</p>
                      </div>
                    ) : <p key={item.id || botIndex} className="text-[13px] text-muted-foreground" data-testid={`wizard-grok-${botIndex}`}>У бота Grok нет доступа к папке.</p>)}
                  </div>
                ) : null}
                {info && step?.id === 'delivery' ? (
                  <fieldset className="flex flex-col gap-2 border-0 p-0">
                    <legend className="mb-1 text-[13px] font-semibold">Как отдать бриф</legend>
                    <label className="flex items-center gap-2 text-sm"><input type="radio" name="delivery" className="wz-radio" checked={form.delivery === 'clipboard'} onChange={() => setForm({ ...form, delivery: 'clipboard' })} /> Скопировать бриф</label>
                    <label className="flex items-center gap-2 text-sm"><input type="radio" name="delivery" className="wz-radio" data-testid="delivery-queue" checked={form.delivery === 'queue'} onChange={() => setForm({ ...form, delivery: 'queue' })} /> Очередь в файлах</label>
                    <p className="text-[13px] text-muted-foreground">Очередь по умолчанию выключена.</p>
                  </fieldset>
                ) : null}
                {info && step?.id === 'economy' ? (
                  <div className="flex flex-col gap-3.5">
                    <div className="wz-trio">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="reply-limit">Лимит ответа</Label>
                        <Select id="reply-limit" data-testid="reply-limit" value={form.reply} onChange={(event) => setForm({ ...form, reply: event.target.value === 'long' ? 'long' : 'short' })}>
                          <option value="short">Короткий</option>
                          <option value="long">Длинный</option>
                        </Select>
                        <p className="text-xs text-muted-foreground">Длинный — только по просьбе.</p>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="max-wakes">Пробуждений на задачу</Label>
                        <Input id="max-wakes" data-testid="max-wakes" value={form.wakes} inputMode="numeric" onChange={(event) => setForm({ ...form, wakes: event.target.value })} />
                        <p className="text-xs text-muted-foreground">Будим только упомянутого.</p>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="stale-hours">Записка устаревает через</Label>
                        <div className="flex">
                          <Input id="stale-hours" className="rounded-r-none" data-testid="stale-hours" value={form.stale} inputMode="decimal" onChange={(event) => setForm({ ...form, stale: event.target.value })} />
                          <span className="inline-flex items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-[13px] text-muted-foreground">часов</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2.5 rounded-lg border border-border p-4">
                      <div className="flex items-center justify-between"><b>Что запишем</b><Badge variant="mono" className="wz-mono">{safeTarget(info.target)}</Badge></div>
                      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[13.5px]">
                        <dt className="text-muted-foreground">Владелец</dt><dd>{form.ownerName || '—'}{form.confirms ? ' · подтверждает мерж' : ''}</dd>
                        <dt className="text-muted-foreground">Боты</dt>
                        <dd className="flex flex-wrap gap-1.5">
                          {form.bots.map((item, botIndex) => (
                            <span key={item.id || botIndex} className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-muted pr-2.5 pl-1 text-xs font-semibold">
                              {item.avatarId ? <BotAvatar id={item.avatarId} color={item.avatarColor} state="idle" size={18} /> : null}
                              {item.name || item.id} · {item.api ? item.model || 'модель' : 'Grok Bot'}
                            </span>
                          ))}
                        </dd>
                        <dt className="text-muted-foreground">Проект</dt><dd>{form.projectTitle || '—'} · главный {form.bots.find((item) => item.id === form.lead)?.name || form.lead}</dd>
                        <dt className="text-muted-foreground">Папка</dt><dd className="wz-mono text-xs">{form.sourcePath}</dd>
                        <dt className="text-muted-foreground">Доступ</dt><dd>{form.bots.filter((item) => item.api).map((item) => `${item.name || item.id} — ${toolsLabel(item.projectTools)}`).join('; ') || 'у Grok папки нет'}</dd>
                        <dt className="text-muted-foreground">Доставка</dt><dd>{form.delivery === 'queue' ? 'Очередь в файлах' : 'Скопировать бриф'}</dd>
                      </dl>
                      {preview?.ok ? <pre className="wz-mono max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs" data-testid="setup-config-preview">{JSON.stringify(preview.config, null, 2)}</pre> : null}
                    </div>
                    <Alert icon={<Info width={16} height={16} />} title="Остался шаг в окне «Ключи»">
                      {form.bots.some((item) => item.api)
                        ? <>Добавьте {form.bots.filter((item) => item.api).map((item) => item.apiKeyEnv).filter(Boolean).join(', ') || 'ключ'} в окне «Ключи» пульта. В этот файл значение не пишется.</>
                        : <>Ключ своего бота задаётся в окне «Ключи», не в мастере.</>}
                    </Alert>
                    {info.exists ? <Checkbox data-testid="confirm-overwrite" checked={form.confirmOverwrite} label="Заменить существующий конфиг" onChange={(event) => setForm({ ...form, confirmOverwrite: event.target.checked })} /> : null}
                    {!info.writable ? <p className="text-[13px] text-muted-foreground">Демо-файл мастер не перезаписывает. Свой конфиг появится при запуске без готового config.yaml.</p> : null}
                  </div>
                ) : null}
              </CardContent>
              {error ? <p className="px-7 pb-2 text-sm font-semibold text-[#9f1239] dark:text-[#fecdd3]" data-testid="setup-error" role="alert">{error}</p> : null}
              <CardFooter>
                {index > 0 ? <Button variant="outline" data-testid="setup-back" onClick={() => { setError(null); setAvatarOpen(false); setIndex((current) => current - 1) }}>Назад</Button> : <span />}
                <div className="flex items-center gap-3.5">
                  <span className="text-xs text-muted-foreground"><kbd className="rounded border border-border border-b-2 bg-muted px-1.5 py-0.5 font-mono text-[11px]">Enter</kbd> дальше</span>
                  {!last ? <Button data-testid="setup-next" onClick={goNext}>Дальше</Button> : <Button data-testid="setup-save" disabled={busy || !info?.writable} onClick={() => void save()}>Записать и открыть пульт</Button>}
                </div>
              </CardFooter>
            </Card>
          </div>
          <div ref={setLayer} />
        </main>
      </div>
    </TooltipProvider>
  )
}

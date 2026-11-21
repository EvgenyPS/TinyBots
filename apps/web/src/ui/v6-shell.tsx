/**
 * FILE: apps/web/src/ui/v6-shell.tsx
 * НАЗНАЧЕНИЕ: тёмная оболочка пульта по сетке v6 (рейл, чаты, сцена).
 * ВХОД: GET /api/launcher. Имена, записки и задачи приходят только оттуда.
 * ВЫХОД: орбита, карточка бота, Задания, Канбан, Правила и бриф в колонке чата.
 * Пустые состояния ведут на /setup — мастер записывает config.yaml. Запрос на мерж — модалка.
 * Карточка бота стоит колонкой справа от орбиты и не накрывает правого бота.
 * Записка старше порога уже помечена сервером: здесь только серый цвет и слово «устарело».
 */

import { ApiChat } from './api-chat'
import { BriefPanel } from './brief-panel'
import { DocsPanel } from './docs-panel'
import { FilesPanel } from './files-panel'
import { GitPanel } from './git-panel'
import { MergeModal, ProposalModal, type DecideInput, type MergeView, type ProposalView } from './merge-modal'

import { useEffect, useState } from 'react'

type Note = {
  bot_id: string
  status: 'ok' | 'missing' | 'broken'
  stale: boolean
  updated_label: string | null
  text: string | null
  question_to_owner: string | null
  state: string | null
}

type Bot = {
  id: string
  name: string
  role: string
  paused: boolean
  lead: boolean
  transport?: 'grok' | 'api'
  provider?: string | null
  model?: string | null
  usage_label?: string | null
}
type Project = { id: string; title: string; letter: string; lead_id: string; lead_name: string; has_git?: boolean }
type Chat = {
  id: string
  project_id: string
  title: string
  lead_id: string
  lead_name: string
  members: Array<{ id: string; name: string }>
  rules: { do: string; dont: string }
}
type Task = {
  id: string
  project_id: string
  chat_id: string
  chat_title: string
  assignee_id: string
  assignee_name: string
  goal: string
  status: string
}
type View = {
  ok: true
  timezone: string
  synced_label: string | null
  owner: { name: string; initials: string }
  delivery: 'clipboard' | 'queue'
  economy: { wake: string; reply_limit: string; max_wakes_per_task: number; stale_after_hours: number }
  projects: Project[]
  bots: Bot[]
  chats: Chat[]
  tasks: Task[]
  notes: Note[]
  merge_requests: MergeView[]
}
type Failure = { ok: false; file: string; line: number; reason: string }
type Load = { kind: 'loading' } | { kind: 'network' } | { kind: 'config'; failure: Failure } | { kind: 'ready'; data: View }
type Panel = 'orbit' | 'tasks' | 'kanban' | 'rules' | 'files' | 'git' | 'docs'

const COLORS = ['#c4b5fd', '#93c5fd', '#86efac', '#fdba74', '#f9a8d4', '#fde68a', '#a5b4fc', '#99f6e4']
const RAIL = ['#c4b5fd', '#93c5fd', '#fdba74', '#86efac']

const COLUMNS: Array<{ id: string; title: string; hint: string; statuses: string[] }> = [
  { id: 'new', title: 'Очередь', hint: 'Сюда попадают новые задачи', statuses: ['new'] },
  { id: 'working', title: 'В работе', hint: 'Сюда попадают задачи в работе и блок', statuses: ['working', 'blocked'] },
  { id: 'review', title: 'На проверке', hint: 'Сюда попадают задачи на проверке', statuses: ['review'] },
  { id: 'done', title: 'Готово', hint: 'Сюда попадают готовые задачи', statuses: ['done'] },
]

const STATUS_LABEL: Record<string, string> = {
  new: 'очередь',
  working: 'в работе',
  review: 'на проверке',
  done: 'готово',
  blocked: 'блок',
}

function isView(value: unknown): value is View {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as { ok?: unknown; projects?: unknown; bots?: unknown; notes?: unknown; merge_requests?: unknown }
  return row.ok === true && Array.isArray(row.projects) && Array.isArray(row.bots) && Array.isArray(row.notes) && Array.isArray(row.merge_requests)
}

function isFailure(value: unknown): value is Failure {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as { ok?: unknown; file?: unknown; line?: unknown; reason?: unknown }
  return row.ok === false && typeof row.file === 'string' && typeof row.line === 'number' && typeof row.reason === 'string'
}

function colorFor(id: string): string {
  let n = 0
  for (const ch of id) {
    n = (n + ch.charCodeAt(0)) % COLORS.length
  }
  return COLORS[n] ?? COLORS[0]
}

function noteOf(data: View, botId: string): Note | undefined {
  return data.notes.find((note) => note.bot_id === botId)
}

function botsForProject(data: View, project: Project): Bot[] {
  const ids = new Set<string>([project.lead_id])
  for (const chat of data.chats) {
    if (chat.project_id !== project.id) {
      continue
    }
    ids.add(chat.lead_id)
    for (const member of chat.members) {
      ids.add(member.id)
    }
  }
  return data.bots.filter((bot) => ids.has(bot.id))
}

function Mark(props: { id: string; name: string; lead: boolean; dim: boolean }) {
  const letter = Array.from(props.name)[0] ?? '?'
  return (
    <span className={props.dim ? 'mark is-dim' : 'mark'} style={{ background: colorFor(props.id) }} aria-label={props.name}>
      {letter}
      {props.lead ? <i className="crown" aria-hidden="true" /> : null}
    </span>
  )
}

function NoteBlock(props: { note: Note | undefined; testId: string }) {
  const note = props.note
  if (!note || note.status !== 'ok' || !note.updated_label) {
    return (
      <span className="note is-missing" data-testid={props.testId} data-status={note?.status ?? 'missing'}>
        нет записки
      </span>
    )
  }
  return (
    <span className={note.stale ? 'note is-stale' : 'note'} data-testid={props.testId} data-status="ok">
      {note.text ? <span className="note-text">{note.text}</span> : null}
      <span className="note-time">обновлено {note.updated_label}</span>
      {note.stale ? <span className="stale-tag">устарело</span> : null}
    </span>
  )
}

function EmptyState(props: { kind: 'projects' | 'bots' | 'notes' }) {
  const copy = {
    projects: {
      title: 'Нет проектов',
      text: 'В конфиге нет ни одного проекта. Пульт появится, когда проект будет добавлен.',
    },
    bots: {
      title: 'Нет ботов',
      text: 'В конфиге нет ни одного бота. Орбита и карточки соберутся после добавления.',
    },
    notes: {
      title: 'Нет записок',
      text: 'Файлов статуса нет. На орбите и в карточке написано «нет записки».',
    },
  }[props.kind]
  return (
    <section className="empty" data-testid="empty-state" data-kind={props.kind}>
      <h2>{copy.title}</h2>
      <p>{copy.text}</p>
      <a className="btn primary" href="/setup" data-testid="setup-link">Настроить</a>
    </section>
  )
}

export function Dashboard() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [tick, setTick] = useState(0)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [chatId, setChatId] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>('orbit')
  const [botId, setBotId] = useState<string | null>(null)
  const [csrf, setCsrf] = useState('')
  const [mergeId, setMergeId] = useState<string | null>(null)
  const [proposals, setProposals] = useState<ProposalView[]>([])
  const [proposalId, setProposalId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [revertOpen, setRevertOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/launcher', { cache: 'no-store' })
      .then(async (res) => {
        const body: unknown = await res.json()
        if (cancelled) {
          return
        }
        if (isView(body)) {
          const token = (body as { csrf?: unknown }).csrf
          setCsrf(typeof token === 'string' ? token : '')
          setLoad({ kind: 'ready', data: body })
          return
        }
        if (isFailure(body)) {
          setLoad({ kind: 'config', failure: body })
          return
        }
        setLoad({ kind: 'network' })
      })
      .catch(() => {
        if (!cancelled) {
          setLoad({ kind: 'network' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [tick])

  useEffect(() => {
    if (load.kind !== 'ready') {
      return
    }
    const data = load.data
    const project = data.projects.find((item) => item.id === projectId) ?? data.projects[0]
    if (project && project.id !== projectId) {
      setProjectId(project.id)
    }
    const chats = project ? data.chats.filter((chat) => chat.project_id === project.id) : []
    if (project && !chats.some((chat) => chat.id === chatId)) {
      setChatId(chats[0]?.id ?? null)
    }
    if (project && !project.has_git && panel === 'git') {
      setPanel('files')
    }
    document.title = project ? `Пульт · ${project.title}` : 'Пульт'
  }, [load, projectId, chatId, panel])

  useEffect(() => {
    if (!projectId) {
      return
    }
    let cancelled = false
    fetch(`/api/proposals?project=${encodeURIComponent(projectId)}`, { cache: 'no-store' })
      .then(async (res) => {
        const body: unknown = await res.json()
        if (cancelled || !body || typeof body !== 'object') {
          return
        }
        const list = (body as { proposals?: unknown }).proposals
        if (Array.isArray(list)) {
          setProposals(list as ProposalView[])
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [projectId, tick])

  if (load.kind === 'loading') {
    return <main className="setup" data-testid="loading">Загрузка пульта</main>
  }
  if (load.kind === 'network') {
    return (
      <main className="setup" data-testid="load-error">
        <h1>Пульт не ответил</h1>
        <button type="button" className="btn primary" onClick={() => setTick((n) => n + 1)}>Повторить</button>
      </main>
    )
  }
  if (load.kind === 'config') {
    const failure = load.failure
    return (
      <main className="setup" data-testid="config-error">
        <p className="k">Конфиг не открылся</p>
        <h1>Проверьте файл</h1>
        <p>Сервер работает. Исправьте конфиг и обновите страницу.</p>
        <dl className="error-list">
          <div>
            <dt>Файл</dt>
            <dd data-testid="config-error-file">{failure.file}</dd>
          </div>
          <div>
            <dt>Строка</dt>
            <dd data-testid="config-error-line">{failure.line}</dd>
          </div>
          <div>
            <dt>Причина</dt>
            <dd data-testid="config-error-reason">{failure.reason}</dd>
          </div>
        </dl>
      </main>
    )
  }

  const data = load.data
  const project = data.projects.find((item) => item.id === projectId) ?? null
  const chats = project ? data.chats.filter((chat) => chat.project_id === project.id) : []
  const chat = chats.find((item) => item.id === chatId) ?? null
  const team = project ? botsForProject(data, project) : []
  const tasks = project ? data.tasks.filter((task) => task.project_id === project.id) : []
  const selected = team.find((bot) => bot.id === botId) ?? null
  const notesMissing = data.bots.length > 0 && data.notes.length > 0 && data.notes.every((note) => note.status !== 'ok')
  const blank = data.projects.length === 0 ? 'projects' : data.bots.length === 0 ? 'bots' : null
  const requests = project ? data.merge_requests.filter((item) => item.project_id === project.id) : []
  const awaiting = requests.filter((item) => item.state === 'awaiting_owner')
  const openProposals = proposals.filter((item) => item.state === 'proposed' || item.state === 'applied' || item.state === 'conflict')
  const openProposal = proposals.find((item) => item.id === proposalId) ?? null
  const merged = requests.filter((item) => item.state === 'merged')
  const openMr = requests.find((item) => item.id === mergeId) ?? null

  async function actProposal(kind: 'apply' | 'reject' | 'revert', item: ProposalView) {
    if (!csrf) {
      setToast('Сессия пульта устарела. Обновите страницу.')
      return
    }
    setBusy(true)
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 200_000)
    try {
      const res = await fetch(`/api/proposals/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ id: item.id, patch_sha256: item.patch_sha256 }),
        signal: controller.signal,
      })
      const body: unknown = await res.json()
      const message = body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : ''
      if (!res.ok) {
        setToast(message || 'Предложение не изменилось.')
        return
      }
      setProposalId(null)
      setTick((n) => n + 1)
    } catch {
      setToast('Пульт не ответил за 200 с. Обновите страницу и проверьте предложение.')
    } finally {
      window.clearTimeout(timer)
      setBusy(false)
    }
  }

  async function synchronize() {
    if (csrf) {
      await fetch('/api/sync/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: '{}',
      })
    }
    setTick((n) => n + 1)
  }

  async function decide(input: DecideInput) {
    setBusy(true)
    try {
      const res = await fetch('/api/merge/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify(input),
      })
      const body = (await res.json()) as { ok?: boolean }
      setToast(body.ok
        ? 'Решение записано. Синхронизируйте, чтобы доставить его на бокс.'
        : 'Решение не записалось')
      setTick((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  async function confirmRevert() {
    const target = merged[0]
    if (!target) {
      return
    }
    await decide({
      id: target.id,
      action: 'revert',
      feedback: '',
      sent_to_chats: [],
      accept_risk: false,
    })
    setRevertOpen(false)
  }

  return (
    <div className="app" data-testid="shell">
      <nav className="rail" aria-label="Проекты">
        <div className="logo" title="Пульт" />
        {data.projects.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={item.id === project?.id ? 'pr on' : 'pr'}
            style={{ background: RAIL[index % RAIL.length] }}
            title={item.title}
            data-testid={`project-${item.id}`}
            onClick={() => {
              setProjectId(item.id)
              setBotId(null)
            }}
          >
            {item.letter}
          </button>
        ))}
        <a className="pr-add" href="/setup" aria-label="Добавить проект">+</a>
        <span className="sp" />
        <div className="me" title={data.owner.name}>{data.owner.initials}</div>
      </nav>

      <aside className="chats">
        <div className="proj-h">
          <div className="k">Проект</div>
          <h1 data-testid="project-title">{project ? project.title : 'Нет проекта'}</h1>
          <p className="sub" data-testid="owner-name">владелец {data.owner.name}</p>
          {project ? <p className="sub" data-testid="project-lead">главный {project.lead_name}</p> : null}
        </div>
        <div className="list">
          <div className="k">Чаты проекта</div>
          {chats.length === 0 ? <p className="sub pad-inline">Нет чатов</p> : null}
          {chats.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === chat?.id ? 'chat-item on' : 'chat-item'}
              data-testid={`chat-${item.id}`}
              onClick={() => setChatId(item.id)}
            >
              <b>{item.title}</b>
              <i>{item.lead_name}</i>
            </button>
          ))}
        </div>
      </aside>

      <div className="stage">
        <header className="top">
          <nav className="tabs" aria-label="Разделы">
            <button type="button" className={panel === 'orbit' ? 'tab on' : 'tab'} data-testid="tab-orbit" onClick={() => setPanel('orbit')}>Команда</button>
            <button type="button" className={panel === 'tasks' ? 'tab on' : 'tab'} data-testid="tab-tasks" onClick={() => setPanel('tasks')}>Задания</button>
            <button type="button" className={panel === 'kanban' ? 'tab on' : 'tab'} data-testid="tab-kanban" onClick={() => setPanel('kanban')}>Канбан</button>
            <button type="button" className={panel === 'files' ? 'tab on' : 'tab'} data-testid="tab-files" onClick={() => setPanel('files')}>Файлы</button>
            {project?.has_git ? (
              <button type="button" className={panel === 'git' ? 'tab on' : 'tab'} data-testid="tab-git" onClick={() => setPanel('git')}>Git</button>
            ) : null}
            <button type="button" className={panel === 'docs' ? 'tab on' : 'tab'} data-testid="tab-docs" onClick={() => setPanel('docs')}>Документация</button>
            <button type="button" className={panel === 'rules' ? 'tab on' : 'tab'} data-testid="tab-rules" onClick={() => setPanel('rules')}>Правила</button>
          </nav>
          <div className="acts">
            <button
              type="button"
              className="btn"
              data-testid="merge-requests"
              disabled={awaiting.length === 0}
              title={awaiting.length === 0 ? 'Нет запросов на мерж' : 'Открыть запросы'}
              onClick={() => setMergeId(awaiting[0]?.id ?? null)}
            >
              Запросы на мерж ({awaiting.length})
            </button>
            {awaiting.length === 0 ? <span data-testid="merge-requests-reason">Нет запросов на мерж</span> : null}
            <button
              type="button"
              className="btn"
              data-testid="proposals"
              disabled={openProposals.length === 0}
              title={openProposals.length === 0 ? 'Нет предложений' : 'Открыть предложения'}
              onClick={() => setProposalId(openProposals[0]?.id ?? null)}
            >
              Предложения ({openProposals.length})
            </button>
            {openProposals.length === 0 ? <span data-testid="proposals-reason">Нет предложений</span> : null}
            <button
              type="button"
              className="btn"
              data-testid="revert"
              disabled={merged.length === 0}
              title={merged.length === 0 ? 'Нет смерженного запроса, откатывать нечего' : 'Откатить смерженный запрос'}
              onClick={() => setRevertOpen(true)}
            >
              Откатить
            </button>
            {merged.length === 0 ? <span data-testid="revert-reason">Нет смерженного запроса, откатывать нечего</span> : null}
            <span data-testid="merge-status">{requests.length === 0 ? 'запросов нет' : requests.map((item) => `${item.id}:${item.state}`).join(' ')}</span>
            <span data-testid="sync-label">{data.synced_label ? `данные на ${data.synced_label}` : 'данные на —'}</span>
            <button type="button" className="btn" data-testid="sync" onClick={() => void synchronize()}>Синхронизировать</button>
          </div>
          {requests.filter((item) => item.error).map((item) => (
            <p key={item.id} className="merge-error" data-testid="merge-fault" data-mr={item.id}>{item.id}: {item.error}</p>
          ))}
        </header>
        <div className="stage-body">
          <main className="workspace">
            {blank ? <EmptyState kind={blank} /> : null}
            {!blank && notesMissing ? <EmptyState kind="notes" /> : null}
            {!blank && panel === 'orbit' ? (
              <section className={selected ? 'orbit-wrap card has-card' : 'orbit-wrap card'} data-testid="orbit">
                <div className="orbit-head">
                  <h2>Команда {project?.title}</h2>
                  <p className="sub">{project?.lead_name} — главный в проекте. Нажмите на бота — откроется карточка.</p>
                </div>
                <div className="orbit-box" data-testid="orbit-box">
                  {team.map((bot, index) => {
                    const note = noteOf(data, bot.id)
                    const chief = bot.id === project?.lead_id
                    const dim = bot.paused || !note || note.status !== 'ok' || note.stale
                    const angle = team.length <= 1 ? 0 : (Math.PI * 2 * index) / team.length - Math.PI / 2
                    const style = chief
                      ? { left: '50%', top: '46%' }
                      : {
                          left: `${50 + Math.cos(angle) * 34}%`,
                          top: `${46 + Math.sin(angle) * 30}%`,
                        }
                    return (
                      <button
                        key={bot.id}
                        type="button"
                        className={chief ? 'bot-node chief' : 'bot-node'}
                        style={style}
                        data-testid={`orbit-bot-${bot.id}`}
                        onClick={() => setBotId(bot.id)}
                      >
                        <Mark id={bot.id} name={bot.name} lead={bot.lead} dim={dim} />
                        <span className="nm">{bot.name}</span>
                        <span className="rl">{bot.paused ? 'пауза' : bot.role}</span>
                        <NoteBlock note={note} testId={`orbit-note-${bot.id}`} />
                      </button>
                    )
                  })}
                </div>
                {selected ? (
                  <aside className="bot-card card" data-testid="bot-card" data-bot={selected.id}>
                    <div className="card-h">
                      <Mark id={selected.id} name={selected.name} lead={selected.lead} dim={selected.paused} />
                      <div>
                        <h3>{selected.name}</h3>
                        <p className="sub">{selected.role}</p>
                      </div>
                      <button type="button" className="close-x" onClick={() => setBotId(null)} aria-label="Закрыть">×</button>
                    </div>
                    <h4>Записка</h4>
                    <NoteBlock note={noteOf(data, selected.id)} testId="card-note" />
                    {selected.transport === 'api' ? (
                      <p className="sub" data-testid="card-usage">{selected.usage_label ?? 'нет данных'}</p>
                    ) : null}
                    {noteOf(data, selected.id)?.question_to_owner ? (
                      <p className="question">{noteOf(data, selected.id)?.question_to_owner}</p>
                    ) : null}
                    <h4>Задачи</h4>
                    <ul className="plain">
                      {tasks.filter((task) => task.assignee_id === selected.id).map((task) => (
                        <li key={task.id}>{task.goal}</li>
                      ))}
                    </ul>
                    <h4>Чаты</h4>
                    <ul className="plain">
                      {chats.filter((item) => item.members.some((member) => member.id === selected.id) || item.lead_id === selected.id).map((item) => (
                        <li key={item.id}>{item.title}{item.lead_id === selected.id ? ' · главный' : ''}</li>
                      ))}
                    </ul>
                  </aside>
                ) : null}
              </section>
            ) : null}
            {!blank && panel === 'tasks' ? (
              <section data-testid="tasks-panel">
                <h2>Задания</h2>
                <ul className="task-list">
                  {tasks.map((task) => (
                    <li key={task.id} data-testid={`task-${task.id}`}>
                      <b>{task.goal}</b>
                      <span>{task.assignee_name}</span>
                      <span className="st">{STATUS_LABEL[task.status] ?? task.status}</span>
                    </li>
                  ))}
                </ul>
                {tasks.length === 0 ? <p className="sub">Задач в этом проекте нет.</p> : null}
              </section>
            ) : null}
            {!blank && panel === 'kanban' ? (
              <section className="board" data-testid="kanban">
                {COLUMNS.map((column) => {
                  const cards = tasks.filter((task) => column.statuses.includes(task.status))
                  return (
                    <div key={column.id} className="col" data-testid={`column-${column.id}`}>
                      <h3>{column.title} <b>{cards.length}</b></h3>
                      {cards.length === 0 ? <p className="hint">{column.hint}</p> : null}
                      {cards.map((task) => (
                        <article key={task.id} className="ticket" data-testid={`task-${task.id}`}>
                          <span className="tag">{task.chat_title}</span>
                          <h4>{task.goal}</h4>
                          <p>{task.assignee_name} · {STATUS_LABEL[task.status] ?? task.status}</p>
                        </article>
                      ))}
                    </div>
                  )
                })}
              </section>
            ) : null}
            {!blank && panel === 'files' && project ? <FilesPanel projectId={project.id} /> : null}
            {!blank && panel === 'git' && project?.has_git ? <GitPanel projectId={project.id} /> : null}
            {!blank && panel === 'docs' && project ? <DocsPanel projectId={project.id} /> : null}
            {!blank && panel === 'rules' ? (
              <section className="card pad rules" data-testid="rules-panel">
                <h2>Правила</h2>
                <p className="sub">
                  Базовые правила включены всегда. Ниже — то, что задано в конфиге.
                  Порог записки: {data.economy.stale_after_hours} ч. Ответ: {data.economy.reply_limit}. Пробуждений на задачу: {data.economy.max_wakes_per_task}.
                </p>
                {chats.map((item) => (
                  <div key={item.id} className="rule">
                    <h3>{item.title}</h3>
                    <p data-testid={`rules-do-${item.id}`}>Делают: {item.rules.do}</p>
                    <p>Не делают: {item.rules.dont}</p>
                    <p className="sub">Главный в чате: {item.lead_name}</p>
                  </div>
                ))}
              </section>
            ) : null}
          </main>
          <aside className="detail">
            {chat ? (
              <>
                <div className="k">Чат</div>
                <h2>{chat.title}</h2>
                <p className="sub">главный {chat.lead_name}</p>
                {project ? (
                  <BriefPanel
                    key={chat.id}
                    projectId={project.id}
                    chatId={chat.id}
                    delivery={data.delivery}
                    channel={data.bots.find((bot) => bot.id === chat.lead_id)?.transport === 'api' ? 'api' : 'grok'}
                    csrf={csrf}
                    onDone={() => setTick((n) => n + 1)}
                    tasks={tasks.filter((task) => task.chat_id === chat.id).map((task) => ({ id: task.id, goal: task.goal }))}
                  />
                ) : null}
                {project && data.bots.find((bot) => bot.id === chat.lead_id)?.transport === 'api' ? (
                  <ApiChat
                    key={`chat-${chat.lead_id}`}
                    botId={chat.lead_id}
                    botName={chat.lead_name}
                    csrf={csrf}
                    projectId={project.id}
                    chatId={chat.id}
                    onDone={() => setTick((n) => n + 1)}
                  />
                ) : null}
                <h3>Участники</h3>
                <ul className="plain">
                  {chat.members.map((member) => (
                    <li key={member.id}>{member.name}</li>
                  ))}
                </ul>
                <h3>Правила чата</h3>
                <p>{chat.rules.do}</p>
                <p className="sub">{chat.rules.dont}</p>
              </>
            ) : (
              <p className="sub">Чат не выбран</p>
            )}
          </aside>
        </div>
      </div>
      {toast ? <p className="toast" data-testid="toast" role="status">{toast}</p> : null}
      {openProposal ? (
        <ProposalModal
          item={openProposal}
          botName={data.bots.find((bot) => bot.id === openProposal.bot_id)?.name ?? openProposal.bot_id}
          projectTitle={project?.title ?? openProposal.project_id}
          busy={busy}
          waiting={busy}
          onClose={() => setProposalId(null)}
          onApply={() => void actProposal('apply', openProposal)}
          onReject={() => void actProposal('reject', openProposal)}
          onRevert={() => void actProposal('revert', openProposal)}
        />
      ) : null}
      {openMr ? (
        <MergeModal
          key={`${openMr.id}:${openMr.updated_at}:${openMr.iterations.length}:${openMr.state}`}
          mr={openMr}
          chats={chats.map((item) => ({ id: item.id, title: item.title }))}
          busy={busy}
          onClose={() => setMergeId(null)}
          onDecide={(input) => void decide(input)}
          onSync={() => void synchronize()}
        />
      ) : null}
      {revertOpen ? (
        <div className="modal-bg" data-testid="revert-dialog">
          <div className="merge-dialog" role="dialog" aria-modal="true" aria-labelledby="revert-title">
            <h2 id="revert-title">Откатить</h2>
            <p>Откат тоже требует да владельца.</p>
            <div className="merge-actions">
              <button type="button" className="btn" onClick={() => setRevertOpen(false)}>Закрыть</button>
              <button type="button" className="btn primary" data-testid="revert-yes" disabled={busy} onClick={() => void confirmRevert()}>
                Да, откатить
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

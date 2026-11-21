/**
 * FILE: apps/web/src/ui/proposal-modal.tsx
 * НАЗНАЧЕНИЕ: окно «Предложение #id», список и бейдж.
 * ВХОД: предложение с диффом. Уведомления лежат поверх диффа и высоту зон не меняют.
 * ВЫХОД: применить, отклонить, откатить. Само предложение проект не пишет.
 */

import { useEffect, useRef, useState } from 'react'

export type ProposalHistory = { state: string; at: string; by: string; why: string }

export type ProposalView = {
  id: string
  project_id: string
  bot_id: string
  task_id: string | null
  summary: string
  state: string
  why: string
  history?: ProposalHistory[]
  patch_sha256: string
  mode: 'files' | 'git'
  branch: string | null
  commit?: string | null
  files: Array<{ path: string; is_new: boolean }>
  diff: string
}

const EXEC_HINT = 'URL в .gitmodules и filter= в .gitattributes сработают при следующих командах git.'

const STATE_LABEL: Record<string, string> = {
  proposed: 'Новое',
  applying: 'Ждёт хода бота',
  applied: 'Применено',
  rejected: 'Отклонено',
  reverted: 'Откачено',
  reverting: 'Откат',
  conflict: 'Не применяется',
  revert_conflict: 'Не применяется',
}

const STATE_CLASS: Record<string, string> = {
  proposed: 's-new',
  applying: 's-wait',
  applied: 's-applied',
  rejected: 's-rejected',
  reverted: 's-reverted',
  reverting: 's-reverted',
  conflict: 's-conflict',
  revert_conflict: 's-conflict',
}

const WHY: Record<string, string> = {
  conflict: 'файл изменился после предложения',
  crash_recovered: 'файл изменился после предложения',
  dirty: 'есть несохранённые в git правки',
  detached_head: 'HEAD не на ветке',
  unsupported_entry: 'симлинк или подмодуль в git не правится',
  unsupported_filter: 'у файла git-фильтр или особый eol',
  branch_exists: 'ветка с таким именем уже есть',
  missing_git: 'git не найден или старше 2.45.1',
  owner: 'репозиторий принадлежит другому пользователю',
  partial: 'частичный клон не поддерживается',
  revert_conflict: 'ветку уже меняли, удалять её нельзя',
}

function executable(file: string): boolean {
  const name = file.split('/').pop() ?? file
  if (name === 'package.json' || name === 'Makefile' || name === 'Dockerfile' || name === '.npmrc' || name === '.gitmodules' || name === '.gitattributes' || name === '.gitignore') {
    return true
  }
  if (file.startsWith('.github/') || file.startsWith('.husky/') || file === '.vscode/tasks.json' || file === '.vscode/launch.json') {
    return true
  }
  return ['.sh', '.ps1', '.bat', '.cmd', '.gitconfig'].some((ext) => name.endsWith(ext))
}

type Row = { kind: 'hunk' | 'add' | 'del' | 'ctx'; oldNo: string; newNo: string; text: string }

function rowsOf(diff: string, file: string): Row[] {
  const lines = diff.split('\n')
  const rows: Row[] = []
  let on = false
  let oldNo = 0
  let newNo = 0
  for (const line of lines) {
    if (line.startsWith('+++ ')) {
      const name = line.slice(4).replace(/^b\//, '')
      on = name === file
      continue
    }
    if (line.startsWith('--- ') || line.startsWith('diff ')) {
      if (line.startsWith('diff ')) {
        on = false
      }
      continue
    }
    if (!on) {
      continue
    }
    if (line.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line)
      oldNo = match ? Number(match[1]) : 0
      newNo = match ? Number(match[2]) : 0
      rows.push({ kind: 'hunk', oldNo: '…', newNo: '…', text: line })
      continue
    }
    if (line.startsWith('+')) {
      rows.push({ kind: 'add', oldNo: '', newNo: String(newNo), text: line.slice(1) })
      newNo += 1
      continue
    }
    if (line.startsWith('-')) {
      rows.push({ kind: 'del', oldNo: String(oldNo), newNo: '', text: line.slice(1) })
      oldNo += 1
      continue
    }
    if (line.startsWith('\\')) {
      continue
    }
    const text = line.startsWith(' ') ? line.slice(1) : line
    rows.push({ kind: 'ctx', oldNo: String(oldNo), newNo: String(newNo), text })
    oldNo += 1
    newNo += 1
  }
  return rows
}

function counts(diff: string, file: string): { add: number; del: number } {
  return rowsOf(diff, file).reduce(
    (sum, row) => ({
      add: sum.add + (row.kind === 'add' ? 1 : 0),
      del: sum.del + (row.kind === 'del' ? 1 : 0),
    }),
    { add: 0, del: 0 },
  )
}

function chip(state: string) {
  return <span className={`chip ${STATE_CLASS[state] ?? 's-new'}`}>{STATE_LABEL[state] ?? state}</span>
}

function histClass(state: string): string {
  if (state === 'applied') return 'ok'
  if (state === 'rejected') return 'gr'
  if (state === 'reverted' || state === 'reverting') return 'bl'
  if (state === 'conflict' || state === 'revert_conflict') return 'rd'
  return ''
}

function when(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  return date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function useRise(): '0' | '1' {
  const [rise, setRise] = useState<'0' | '1'>('0')
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setRise('1'))
    return () => window.cancelAnimationFrame(frame)
  }, [])
  return rise
}

function Toast(props: { kind: 'ok' | 'gr' | 'bl'; title: string; text: string; onClose: () => void }) {
  const rise = useRise()
  const [paused, setPaused] = useState(false)
  const left = useRef(6000)
  const bar = useRef<HTMLSpanElement>(null)
  const closeRef = useRef(props.onClose)
  closeRef.current = props.onClose
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (paused) {
        return
      }
      left.current -= 200
      if (bar.current) {
        bar.current.style.transform = `scaleX(${Math.max(left.current, 0) / 6000})`
      }
      if (left.current <= 0) {
        closeRef.current()
      }
    }, 200)
    return () => window.clearInterval(timer)
  }, [paused])
  return (
    <div
      className={`mtoast ${props.kind}`}
      data-rise={rise}
      role="status"
      aria-live="polite"
      data-testid="proposal-toast"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div>
        <b>{props.title}</b>
        <span>{props.text}</span>
      </div>
      <button type="button" className="cl" aria-label="Скрыть уведомление" onClick={props.onClose}>×</button>
      <span className="bar" ref={bar} aria-hidden="true" />
    </div>
  )
}

function ErrorCard(props: { reason: string; files: string[]; onCollapse: () => void }) {
  const rise = useRise()
  return (
    <div className="merr" data-rise={rise} role="alert" aria-live="assertive" data-testid="proposal-error">
      <div>
        <b>Проект изменился после предложения — ничего не записано</b>
        <ul>
          {props.files.map((file) => (
            <li key={file}><span className="mono">{file}</span><span>{props.reason}</span></li>
          ))}
        </ul>
      </div>
      <button type="button" className="col" data-testid="proposal-error-collapse" onClick={props.onCollapse}>Свернуть</button>
    </div>
  )
}

export function ProposalModal(props: {
  item: ProposalView
  botName: string
  projectTitle: string
  busy: boolean
  waiting: boolean
  notice: 'applied' | 'rejected' | 'reverted' | null
  onClose: () => void
  onApply: () => void
  onReject: () => void
  onRevert: () => void
  onAsk: () => void
  canAsk: boolean
}) {
  const { item, busy, onClose } = props
  const dialogRef = useRef<HTMLDivElement>(null)
  const [confirmRevert, setConfirmRevert] = useState(false)
  const [toastOn, setToastOn] = useState(props.notice !== null)
  const [errorOpen, setErrorOpen] = useState(item.state === 'conflict' || item.state === 'revert_conflict')
  const [file, setFile] = useState(item.files[0]?.path ?? '')
  const proposed = item.state === 'proposed'
  const applied = item.state === 'applied'
  const rejected = item.state === 'rejected'
  const reverted = item.state === 'reverted'
  const conflict = item.state === 'conflict' || item.state === 'revert_conflict'
  const git = item.mode === 'git'
  const active = item.files.some((row) => row.path === file) ? file : (item.files[0]?.path ?? '')
  const rows = rowsOf(item.diff, active)
  const total = item.files.reduce(
    (sum, row) => {
      const part = counts(item.diff, row.path)
      return { add: sum.add + part.add, del: sum.del + part.del }
    },
    { add: 0, del: 0 },
  )
  const reason = WHY[item.why] ?? (conflict ? 'проект изменился после предложения' : '')

  useEffect(() => {
    setToastOn(props.notice !== null)
  }, [props.notice, item.id])

  useEffect(() => {
    setErrorOpen(conflict)
  }, [conflict, item.id])

  useEffect(() => {
    const node = dialogRef.current
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    const focusable = node?.querySelector<HTMLElement>('button:not([disabled])')
    focusable?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  let toast: { kind: 'ok' | 'gr' | 'bl'; title: string; text: string } | null = null
  if (toastOn && props.notice === 'applied') {
    toast = git
      ? { kind: 'ok', title: 'Применено · ветка создана', text: `${item.branch ?? 'ветка'}, 1 коммит. Файлы на диске не менялись.` }
      : { kind: 'ok', title: 'Применено · файлы заменены', text: 'Снимок до замены сохранён — его вернёт «Откатить».' }
  } else if (toastOn && props.notice === 'rejected') {
    toast = { kind: 'gr', title: 'Отклонено · проект не менялся', text: 'Предложение закрыто и останется в истории 30 дней.' }
  } else if (toastOn && props.notice === 'reverted') {
    toast = { kind: 'bl', title: git ? 'Ветка удалена' : 'Откачено · файлы как до применения', text: git ? 'Рабочее дерево не менялось.' : 'Файлы восстановлены из снимка.' }
  }

  return (
    <div className="modal-bg" data-testid="proposal-dialog-bg">
      <div className="pm" role="dialog" aria-modal="true" aria-labelledby="proposal-title" ref={dialogRef} data-testid="proposal-dialog" data-state={item.state}>
        <div className="pm-h">
          <div className="ttl">
            <h2 id="proposal-title" data-testid="proposal-title">Предложение #{item.id}</h2>
            {chip(item.state)}
            <span className="sub pm-ellipsis">{props.projectTitle}</span>
          </div>
          <button type="button" className="x" onClick={onClose} aria-label="Закрыть" data-testid="proposal-close">×</button>
          <div className="by">
            <b>{props.botName}</b>
            <span>свой бот по API</span>
            {item.task_id ? <span>задача {item.task_id}</span> : null}
            <span>{item.files.length} файла, <span className="plus">+{total.add}</span> <span className="minus">−{total.del}</span></span>
            <span className="mono">патч {item.patch_sha256.slice(0, 7)}</span>
          </div>
          <div className="hist">
            {(item.history ?? [{ state: item.state, at: '', by: props.botName, why: item.why }]).map((row, index) => (
              <span key={`${row.state}-${row.at}-${index}`} className={`st ${histClass(row.state)}`}>
                {index > 0 ? <span className="arr">→ </span> : null}
                <i />
                <b>{STATE_LABEL[row.state] ?? row.state}</b> {row.by}{row.at ? ` · ${when(row.at)}` : ''}
              </span>
            ))}
          </div>
        </div>
        <div className="pm-info">
          <div className="box">
            <div className="k">Что сделано · со слов бота</div>
            <p data-testid="proposal-summary">{item.summary}</p>
          </div>
          <div className="box mode">
            <div className="k">Режим применения</div>
            <div className="mode-row" data-testid="proposal-mode">
              {git ? `Git-ветка ${item.branch ?? ''}` : 'Замена файлов со снимком'}
            </div>
            <p>
              {git
                ? 'Создаст локальную ветку с 1 коммитом, без отправки. Рабочее дерево и текущая ветка не меняются — влейте ветку сами.'
                : 'Перед заменой сохраним снимок затронутых файлов. «Откатить» вернёт их байт в байт.'}
            </p>
          </div>
        </div>
        <div className="pm-b">
          <div className="files">
            <div className="k">Файлы · {item.files.length}</div>
            {item.files.map((row) => {
              const stat = counts(item.diff, row.path)
              return (
                <button key={row.path} type="button" className={row.path === active ? 'frow on' : 'frow'} onClick={() => setFile(row.path)}>
                  <span className="p">{row.path}</span>
                  <span className="n"><span className="plus">+{stat.add}</span> <span className="minus">−{stat.del}</span></span>
                  <span className="tags">
                    {row.is_new ? <span className="mini new">новый</span> : null}
                    {executable(row.path) ? <span className="mini exe" title={EXEC_HINT} data-testid={`exec-${row.path}`}>исполняемый/CI</span> : null}
                    {conflict ? <span className="mini cf">{reason}</span> : null}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="diff">
            <div className="dh">
              <span className="p">{active}</span>
              <span className="sp" />
              <span className="tg">{rows.filter((row) => row.kind === 'hunk').length} фрагмента</span>
            </div>
            <div className="code" data-testid="proposal-diff">
              {rows.map((row, index) => (
                <div key={`${row.kind}-${index}`} className={row.kind === 'ctx' ? 'ln' : `ln ${row.kind === 'hunk' ? 'hk' : row.kind}`}>
                  <span className="o">{row.oldNo}</span>
                  <span className="nn">{row.newNo}</span>
                  <span className="sg">{row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}</span>
                  <span className="c">{row.text}</span>
                </div>
              ))}
            </div>
          </div>
          {toast ? <Toast kind={toast.kind} title={toast.title} text={toast.text} onClose={() => setToastOn(false)} /> : null}
          {conflict && errorOpen ? (
            <ErrorCard reason={reason} files={item.files.map((row) => row.path)} onCollapse={() => setErrorOpen(false)} />
          ) : null}
        </div>
        <div className="pm-f">
          {proposed ? (
            <div className="guards">
              <span className="k">Проверено</span>
              <span className="g">без удаления и переименования</span>
              <span className="g">{item.files.length} из 20 файлов</span>
              {item.files.some((row) => executable(row.path)) ? <span className="g w">есть файл, который исполняется при сборке</span> : null}
            </div>
          ) : null}
          {applied ? (
            <div className="fnote" data-testid="proposal-foot">
              {git
                ? <span>Ветка <b className="mono">{item.branch}</b>{item.commit ? ` · коммит ${item.commit}` : ''} · откат удалит ветку, если её не влили и не сдвинули</span>
                : <span>Снимок сохранён. Откат вернёт файлы, пока их не меняли после применения.</span>}
            </div>
          ) : null}
          {rejected ? <div className="fnote">Отклонено. Проект не менялся.</div> : null}
          {reverted ? <div className="fnote">Откачено. Файлы восстановлены, копия правки остаётся в предложении.</div> : null}
          {conflict ? (
            <div className="fnote err">
              <b>Не применяется:</b> {reason}
              {!errorOpen ? <button type="button" className="lnk" data-testid="proposal-error-more" onClick={() => setErrorOpen(true)}>Подробнее</button> : null}
            </div>
          ) : null}
          <div className="btns">
            {proposed || conflict ? (
              <button type="button" className="btn" data-testid="proposal-reject" disabled={busy || props.waiting} onClick={props.onReject}>Отклонить</button>
            ) : null}
            {proposed ? (
              <button type="button" className="btn primary" data-testid="proposal-apply" disabled={busy || props.waiting} onClick={props.onApply}>Применить</button>
            ) : null}
            {conflict ? (
              <button type="button" className="btn primary" data-testid="proposal-ask" disabled={busy || !props.canAsk} onClick={props.onAsk}>Попросить бота обновить</button>
            ) : null}
            {applied ? (
              <button type="button" className="btn danger" data-testid="proposal-revert" disabled={busy} onClick={() => setConfirmRevert(true)}>
                {git ? 'Удалить ветку…' : 'Откатить…'}
              </button>
            ) : null}
            {!proposed && !conflict ? (
              <button type="button" className="btn primary" onClick={onClose}>Закрыть</button>
            ) : null}
          </div>
        </div>
      </div>
      {confirmRevert ? (
        <div className="modal-bg pm-confirm-bg">
          <div className="cm" role="alertdialog" aria-modal="true" data-testid="proposal-revert-confirm">
            <div className="k">{git ? 'Режим: git-ветка' : 'Режим: замена файлов со снимком'}</div>
            <h3>{git ? `Удалить ветку предложения #${item.id}?` : `Откатить предложение #${item.id}?`}</h3>
            <p>
              {git
                ? 'Удалим локальную ветку с одним коммитом. Рабочее дерево и текущая ветка не меняются.'
                : 'Вернём файлы к состоянию до применения из снимка. Созданный файл уберём с диска, копия останется в предложении.'}
            </p>
            <ul>
              {git ? <li><span className="mono">{item.branch}</span><small>ветка будет удалена, коммит останется в базе git</small></li> : null}
              {item.files.map((row) => (
                <li key={row.path}><span className="mono">{row.path}</span><small>{row.is_new && !git ? 'файл создан ботом — уберём с диска' : 'вернётся прежнее содержимое'}</small></li>
              ))}
            </ul>
            <div className="warnline">Если файлы или ветку уже меняли после применения — откат остановится и ничего не изменит.</div>
            <div className="acts">
              <button type="button" className="btn" onClick={() => setConfirmRevert(false)}>Отмена</button>
              <button type="button" className="btn danger" data-testid="proposal-revert-yes" disabled={busy} onClick={() => { setConfirmRevert(false); props.onRevert() }}>
                {git ? 'Удалить ветку' : 'Откатить'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const WAITING = new Set(['proposed', 'applying', 'conflict', 'revert_conflict'])

export function ProposalDrawer(props: {
  botName: string
  items: ProposalView[]
  onClose: () => void
  onOpen: (id: string) => void
}) {
  const [filter, setFilter] = useState('all')
  const waiting = props.items.filter((item) => WAITING.has(item.state))
  const closed = props.items.filter((item) => !WAITING.has(item.state))
  const shown = (list: ProposalView[]) => list.filter((item) => filter === 'all' || item.state === filter || (filter === 'conflict' && item.state === 'revert_conflict'))
  return (
    <div className="modal-bg pm-drawer-bg" data-testid="proposal-list">
      <aside className="drawer" role="dialog" aria-label="Предложения бота">
        <div className="dr-h">
          <div className="r">
            <h3>Предложения · {props.botName}</h3>
            <button type="button" className="x" onClick={props.onClose} aria-label="Закрыть список">×</button>
          </div>
          <p className="sub">Проект меняется только после «Применить».</p>
          <div className="filters">
            {[['all', 'Все', props.items.length], ['proposed', 'Новые', props.items.filter((item) => item.state === 'proposed').length], ['applied', 'Применено', props.items.filter((item) => item.state === 'applied').length], ['conflict', 'Не применяется', props.items.filter((item) => item.state === 'conflict' || item.state === 'revert_conflict').length], ['rejected', 'Отклонено', props.items.filter((item) => item.state === 'rejected').length], ['reverted', 'Откачено', props.items.filter((item) => item.state === 'reverted').length]].map(([id, label, count]) => (
              <button key={String(id)} type="button" className={filter === id ? 'fchip on' : 'fchip'} onClick={() => setFilter(String(id))}>{label} <em>{count}</em></button>
            ))}
          </div>
        </div>
        <div className="dr-b">
          <div className="grp">Ждут решения · {waiting.length}</div>
          {shown(waiting).map((item) => (
            <button key={item.id} type="button" className="pitem" data-testid="proposal-item" onClick={() => props.onOpen(item.id)}>
              <b>{item.summary}</b>
              {chip(item.state)}
              <span className="m">#{item.id} · {item.mode === 'git' ? 'git-ветка' : 'снимок'}</span>
            </button>
          ))}
          <div className="grp">Закрытые · {closed.length}</div>
          {shown(closed).map((item) => (
            <button key={item.id} type="button" className="pitem" data-testid="proposal-item" onClick={() => props.onOpen(item.id)}>
              <b>{item.summary}</b>
              {chip(item.state)}
              <span className="m">#{item.id} · {item.mode === 'git' ? 'git-ветка' : 'снимок'}</span>
            </button>
          ))}
        </div>
        <div className="dr-f">Закрытые предложения хранятся 30 дней. Снимки применённых правок сервер сам не удаляет.</div>
      </aside>
    </div>
  )
}

export function proposalBadgeCount(items: ProposalView[]): number {
  return items.filter((item) => item.state === 'proposed' || item.state === 'conflict' || item.state === 'revert_conflict').length
}

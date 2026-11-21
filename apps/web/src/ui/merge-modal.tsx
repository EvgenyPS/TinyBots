/**
 * FILE: apps/web/src/ui/merge-modal.tsx
 * НАЗНАЧЕНИЕ: модалка «Запрос на мерж».
 * ВХОД: запрос с итерациями, чаты проекта и колбэк решения.
 * ВЫХОД: отзыв, выбранные чаты и действие. Статус на сервере это само не меняет.
 * «На доработку» и «Отклонить» без текста закрыты. Красный CI закрывает «Смержить»,
 * пока не стоит «принимаю риск».
 */

import { useEffect, useRef, useState } from 'react'

export type MergeIteration = {
  n: number
  done: string[]
  broken: string[]
  postponed: string[]
  risks: string[]
  other: string
  addressed_feedback: { quote: string; fixed: string[]; remaining: string[] } | null
  decision: { by: string; action: string; feedback: string; sent_to_chats: string[] } | null
}

export type MergeView = {
  id: string
  project_id: string
  state: string
  checks: 'green' | 'red'
  summary: string
  mode: 'git' | 'files'
  pr_url: string
  head_sha: string
  author: string | null
  owner: string
  affected_chats: string[]
  links: { pr: string | null; ci: string | null; diff: string | null }
  iterations: MergeIteration[]
  error: string | null
  updated_at: string
}

export type DecideInput = {
  id: string
  action: 'approved' | 'rejected' | 'changes_requested' | 'revert'
  feedback: string
  sent_to_chats: string[]
  accept_risk: boolean
}

type Chat = { id: string; title: string }

function latest(mr: MergeView): MergeIteration | null {
  return mr.iterations.reduce<MergeIteration | null>((best, item) => {
    if (!best || item.n > best.n) {
      return item
    }
    return best
  }, null)
}

export function MergeModal(props: {
  mr: MergeView
  chats: Chat[]
  busy: boolean
  onClose: () => void
  onDecide: (input: DecideInput) => void
  onSync: () => void
}) {
  const { mr, chats, busy, onClose, onDecide, onSync } = props
  const dialogRef = useRef<HTMLDivElement>(null)
  const [feedback, setFeedback] = useState('')
  const [picked, setPicked] = useState<string[]>(mr.affected_chats)
  const [risk, setRisk] = useState(false)
  const current = latest(mr)
  const waiting = mr.state === 'awaiting_owner'
  const comment = feedback.trim()
  const needsRisk = mr.checks === 'red'
  const approveDisabled = busy || !waiting || (needsRisk && !risk)
  const commentDisabled = busy || !waiting || comment.length === 0
  const link = mr.links.pr ?? mr.pr_url

  useEffect(() => {
    const node = dialogRef.current
    const focusable = node?.querySelector<HTMLElement>('textarea, button, input, a[href]')
    focusable?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  function toggle(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
  }

  function send(action: DecideInput['action']) {
    onDecide({
      id: mr.id,
      action,
      feedback: comment,
      sent_to_chats: picked,
      accept_risk: risk,
    })
  }

  return (
    <div className="modal-bg" data-testid="merge-dialog-bg">
      <div
        className="merge-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-title"
        ref={dialogRef}
        data-testid="merge-dialog"
        data-state={mr.state}
      >
        <header className="merge-head">
          <div>
            <p className="k">Запрос на мерж</p>
            <h2 id="merge-title">{mr.summary}</h2>
            <p className="sub">
              {mr.author ?? 'исполнитель'} · <a href={link}>{mr.mode === 'files' ? 'папка' : 'PR'}</a> · {mr.head_sha.slice(0, 7)}
            </p>
          </div>
          <button type="button" className="close-x" onClick={onClose} aria-label="Закрыть запрос">×</button>
        </header>
        {mr.state === 'merged' || mr.state === 'reverted' ? (
          <p className="merge-mark" data-testid="merge-mark">✓ {mr.state === 'merged' ? 'Смержено' : 'Откат выполнен'}</p>
        ) : null}
        {mr.error ? <p className="merge-error" data-testid="merge-error">{mr.error}</p> : null}
        <section>
          <h3>Что сделано</h3>
          <ul>{(current?.done ?? []).map((line) => <li key={line}>{line}</li>)}</ul>
          {(current?.done ?? []).length === 0 ? <p className="sub">{mr.summary}</p> : null}
        </section>
        <section>
          <h3>Что не работает</h3>
          <ul>{(current?.broken ?? []).map((line) => <li key={line}>{line}</li>)}</ul>
        </section>
        <section>
          <h3>Отложено</h3>
          <ul>{(current?.postponed ?? []).map((line) => <li key={line}>{line}</li>)}</ul>
        </section>
        <section>
          <h3>Риски</h3>
          <ul>{(current?.risks ?? []).map((line) => <li key={line}>{line}</li>)}</ul>
        </section>
        <section>
          <h3>CI / проверки</h3>
          <p data-testid="merge-checks">{mr.checks === 'green' ? 'CI зелёный' : 'CI красный'}</p>
          {mr.links.ci ? <p className="sub">{mr.links.ci}</p> : null}
          {mr.links.diff ? <p className="sub">{mr.links.diff}</p> : null}
        </section>
        <section data-testid="iterations">
          <h3>Итерации</h3>
          {mr.iterations.map((item) => (
            <article key={item.n} data-testid={`iteration-${item.n}`}>
              <h4>Итерация {item.n}</h4>
              {item.addressed_feedback ? (
                <p>
                  <span data-testid={`quote-${item.n}`}>{item.addressed_feedback.quote}</span>
                  {' → '}
                  <span data-testid={`fixed-${item.n}`}>{item.addressed_feedback.fixed.join(', ')}</span>
                  {' → '}
                  <span data-testid={`remaining-${item.n}`}>{item.addressed_feedback.remaining.join(', ')}</span>
                </p>
              ) : (
                <p className="sub">Отзыва по этой итерации ещё нет</p>
              )}
            </article>
          ))}
        </section>
        <footer className="merge-foot">
          <label className="field">
            <span>Отзыв</span>
            <textarea
              data-testid="merge-feedback"
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
            />
          </label>
          <div className="chips" aria-label="Кому отправить отзыв">
            {chats.map((chat) => (
              <label key={chat.id} className="check">
                <input
                  type="checkbox"
                  data-testid={`chat-chip-${chat.id}`}
                  checked={picked.includes(chat.id)}
                  onChange={() => toggle(chat.id)}
                />
                {chat.title}
              </label>
            ))}
          </div>
          {needsRisk ? (
            <label className="check">
              <input
                type="checkbox"
                data-testid="accept-risk"
                checked={risk}
                onChange={(event) => setRisk(event.target.checked)}
              />
              принимаю риск
            </label>
          ) : null}
          <div className="merge-actions">
            <button type="button" className="btn ghost" data-testid="merge-reject" disabled={commentDisabled} onClick={() => send('rejected')}>
              Отклонить
            </button>
            <button type="button" className="btn" data-testid="merge-changes" disabled={commentDisabled} onClick={() => send('changes_requested')}>
              На доработку
            </button>
            <button
              type="button"
              className="btn primary"
              data-testid="merge-approve"
              disabled={approveDisabled}
              aria-describedby={approveDisabled ? 'merge-approve-reason' : undefined}
              onClick={() => send('approved')}
            >
              Смержить
            </button>
            <button type="button" className="btn" data-testid="merge-sync" disabled={busy} onClick={onSync}>
              Синхронизировать
            </button>
          </div>
          {approveDisabled ? (
            <p id="merge-approve-reason" className="sub" data-testid="merge-approve-reason">
              {needsRisk && !risk ? 'CI красный: отметьте «принимаю риск»' : 'Смержить сейчас нельзя'}
            </p>
          ) : null}
        </footer>
      </div>
    </div>
  )
}

export type ProposalView = {
  id: string
  project_id: string
  bot_id: string
  task_id: string | null
  summary: string
  state: string
  why: string
  patch_sha256: string
  mode: 'files' | 'git'
  branch: string | null
  files: Array<{ path: string; is_new: boolean }>
  diff: string
}

const EXEC_HINT = 'URL в .gitmodules и filter= в .gitattributes сработают при следующих командах git.'

function executable(file: string): boolean {
  const name = file.split('/').pop() ?? file
  if (name === 'package.json' || name === 'Makefile' || name === 'Dockerfile' || name === '.npmrc' || name === '.gitmodules' || name === '.gitattributes' || name === '.gitignore') {
    return true
  }
  if (file.startsWith('.github/') || file.startsWith('.husky/')) {
    return true
  }
  if (file === '.vscode/tasks.json' || file === '.vscode/launch.json') {
    return true
  }
  return ['.sh', '.ps1', '.bat', '.cmd', '.gitconfig'].some((ext) => name.endsWith(ext))
}

const WHY: Record<string, string> = {
  conflict: 'файл изменился после предложения, ничего не записано',
  crash_recovered: 'файл изменился после предложения, ничего не записано',
  dirty: 'в затронутых файлах есть незакоммиченные правки',
  detached_head: 'HEAD не на ветке',
  unsupported_entry: 'симлинк или подмодуль в git не правится',
  unsupported_filter: 'у файла git-фильтр или особый eol, правьте вручную',
  branch_exists: 'ветка с таким именем уже есть',
  missing_git: 'git не найден или старше 2.45.1',
  owner: 'репозиторий принадлежит другому пользователю',
  partial: 'частичный клон не поддерживается',
  revert_conflict: 'ветку уже меняли, удалять её нельзя',
}

export function ProposalModal(props: {
  item: ProposalView
  botName: string
  projectTitle: string
  busy: boolean
  waiting: boolean
  onClose: () => void
  onApply: () => void
  onReject: () => void
  onRevert: () => void
}) {
  const { item, busy, waiting, onClose } = props
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const [confirmRevert, setConfirmRevert] = useState(false)
  const proposed = item.state === 'proposed'
  const applied = item.state === 'applied'
  const banner = WHY[item.why] ?? ''

  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = dialogRef.current
    const focusable = () => Array.from(node?.querySelectorAll<HTMLElement>('button, [href], input, textarea') ?? [])
      .filter((el) => !el.hasAttribute('disabled'))
    focusable()[0]?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') {
        return
      }
      const items = focusable()
      if (items.length === 0) {
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      returnFocus.current?.focus()
    }
  }, [onClose])

  return (
    <div className="modal-bg" data-testid="proposal-dialog-bg">
      <div
        className="merge-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="proposal-title"
        ref={dialogRef}
        data-testid="proposal-dialog"
        data-state={item.state}
      >
        <header className="merge-head">
          <div>
            <p className="k">Запрос на мерж</p>
            <h2 id="proposal-title">{props.botName}</h2>
            <p className="sub">
              {props.projectTitle}
              {item.task_id ? ` · ${item.task_id}` : ''}
              {` · ${item.patch_sha256.slice(0, 7)}`}
            </p>
          </div>
          <button type="button" className="close-x" onClick={onClose} aria-label="Закрыть предложение">×</button>
        </header>
        {banner ? <p className="merge-error" data-testid="proposal-banner">{banner}</p> : null}
        {waiting ? <p className="sub" data-testid="proposal-wait">ждёт завершения хода бота</p> : null}
        <section>
          <h3>Что сделано</h3>
          <p data-testid="proposal-summary">{item.summary}</p>
          <p className="sub">со слов бота</p>
        </section>
        <section>
          <h3>Файлы</h3>
          <ul>
            {item.files.map((file) => (
              <li key={file.path}>
                {file.path}
                {file.is_new ? ' · новый' : ''}
                {executable(file.path) ? (
                  <span title={EXEC_HINT} data-testid={`exec-${file.path}`}> · исполняемый/CI</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Правка</h3>
          <pre data-testid="proposal-diff">{item.diff}</pre>
        </section>
        <p className="sub" data-testid="proposal-mode">
          {item.mode === 'git'
            ? `ветка ${item.branch ?? ''}. рабочее дерево и текущая ветка не меняются; влейте ветку сами`
            : 'перед заменой будет снимок'}
        </p>
        <footer className="merge-foot">
          <div className="merge-actions">
            <button type="button" className="btn ghost" data-testid="proposal-reject" disabled={busy || !proposed} onClick={props.onReject}>
              Отклонить
            </button>
            <button type="button" className="btn primary" data-testid="proposal-apply" disabled={busy || !proposed} onClick={props.onApply}>
              Применить
            </button>
            {applied ? (
              <button type="button" className="btn" data-testid="proposal-revert" disabled={busy} onClick={() => setConfirmRevert(true)}>
                {item.mode === 'git' ? 'Удалить ветку' : 'Откатить'}
              </button>
            ) : null}
          </div>
          {!proposed && !applied ? <p className="sub">Кнопка сейчас неактивна: предложение уже закрыто</p> : null}
          {confirmRevert ? (
            <div data-testid="proposal-revert-confirm">
              <p>Подтвердите откат. Проект изменится только после этого.</p>
              <button type="button" className="btn" onClick={() => setConfirmRevert(false)}>Не откатывать</button>
              <button type="button" className="btn primary" data-testid="proposal-revert-yes" disabled={busy} onClick={props.onRevert}>
                Подтвердить
              </button>
            </div>
          ) : null}
        </footer>
      </div>
    </div>
  )
}

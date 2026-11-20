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

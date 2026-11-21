/**
 * FILE: apps/web/src/ui/brief-panel.tsx
 * НАЗНАЧЕНИЕ: собрать бриф с экрана проекта.
 * ВХОД: id проекта и чата, задачи, способ доставки. Для своего бота — канал api и токен.
 * ВЫХОД: превью. Бот Grok — буфер и grokbot://. Свой бот — POST, ответ только текстом.
 * Копирование берёт textContent превью, чтобы в буфере было ровно то, что видно.
 */

import { useRef, useState } from 'react'

type Ready = {
  ok: true
  text: string
  recipient: string
  href: string | null
  fallback: string | null
  delivery: 'clipboard' | 'queue'
}

type Sent = {
  text: string
  recipient: string
  reply: string
  note: string
  usage_label: string
}

type Problem = {
  ok: false
  message: string
  hint: string
}

function isReady(value: unknown): value is Ready {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as { ok?: unknown; text?: unknown; recipient?: unknown }
  return row.ok === true && typeof row.text === 'string' && typeof row.recipient === 'string'
}

function isSent(value: unknown): value is Sent & { ok: true } {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as { ok?: unknown; text?: unknown; reply?: unknown; recipient?: unknown }
  return row.ok === true && typeof row.text === 'string' && typeof row.reply === 'string' && typeof row.recipient === 'string'
}

function isProblem(value: unknown): value is Problem {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as { ok?: unknown; message?: unknown; hint?: unknown }
  return row.ok === false && typeof row.message === 'string' && typeof row.hint === 'string'
}

export function BriefPanel(props: {
  projectId: string
  chatId: string
  tasks: Array<{ id: string; goal: string }>
  delivery: 'clipboard' | 'queue'
  channel?: 'grok' | 'api'
  csrf?: string
  onDone?: () => void
}) {
  const previewRef = useRef<HTMLPreElement>(null)
  const [ready, setReady] = useState<Ready | null>(null)
  const [sent, setSent] = useState<Sent | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const api = props.channel === 'api'

  async function assemble(taskId: string): Promise<void> {
    setCopied(false)
    setCopyFailed(false)
    try {
      if (api) {
        const res = await fetch('/api/brief/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': props.csrf ?? '',
          },
          body: JSON.stringify({ project: props.projectId, chat: props.chatId, task: taskId }),
        })
        const body: unknown = await res.json()
        if (isSent(body)) {
          setSent({
            text: body.text,
            recipient: body.recipient,
            reply: body.reply,
            note: body.note,
            usage_label: typeof body.usage_label === 'string' ? body.usage_label : 'нет данных',
          })
          setReady(null)
          setProblem(null)
          props.onDone?.()
          return
        }
        setSent(null)
        setReady(null)
        if (isProblem(body)) {
          setProblem(body)
          return
        }
        const message = body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
          ? (body as { message: string }).message
          : 'Бриф не ушёл'
        setProblem({ ok: false, message, hint: 'Повторите' })
        return
      }
      const params = new URLSearchParams({
        project: props.projectId,
        chat: props.chatId,
        task: taskId,
      })
      const res = await fetch(`/api/brief?${params.toString()}`, { cache: 'no-store' })
      const body: unknown = await res.json()
      if (isReady(body)) {
        setReady(body)
        setSent(null)
        setProblem(null)
        return
      }
      setReady(null)
      setSent(null)
      if (isProblem(body)) {
        setProblem(body)
        return
      }
      setProblem({ ok: false, message: 'Бриф не собрался', hint: 'Выберите главного' })
    } catch {
      setReady(null)
      setSent(null)
      setProblem({ ok: false, message: 'Пульт не ответил', hint: 'Повторите' })
    }
  }

  async function copy(): Promise<void> {
    const shown = previewRef.current?.textContent ?? ''
    try {
      await navigator.clipboard.writeText(shown)
      setCopied(true)
      setCopyFailed(false)
    } catch {
      setCopied(false)
      setCopyFailed(true)
    }
  }

  const queue = props.delivery === 'queue'
    ? 'Очередь включена. Запуск не чаще одного раза в сутки.'
    : 'Очередь выключена'
  const preview = sent?.text ?? ready?.text ?? ''
  const recipient = sent?.recipient ?? ready?.recipient ?? ''

  return (
    <section className="brief" data-testid="brief-panel">
      <h3>Бриф</h3>
      <p className="sub" data-testid="queue-state">{queue}</p>
      {props.tasks.length === 0 ? <p className="sub">В этом чате нет задач.</p> : null}
      <div className="brief-list">
        {props.tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            className="brief-task"
            data-testid={`brief-task-${task.id}`}
            onClick={() => {
              void assemble(task.id)
            }}
          >
            {task.goal}
          </button>
        ))}
      </div>
      {problem ? (
        <div className="brief-error" data-testid="brief-error" role="alert">
          <p>{problem.message}</p>
          <p>{problem.hint}</p>
        </div>
      ) : null}
      {preview ? (
        <>
          <p data-testid="brief-recipient">{recipient}</p>
          <pre className="brief-preview" data-testid="brief-preview" ref={previewRef}>{preview}</pre>
          {sent ? (
            <>
              <h3>Ответ</h3>
              <pre className="brief-preview" data-testid="brief-reply">{sent.reply}</pre>
              <p className="sub" data-testid="brief-usage">{sent.usage_label}</p>
              {sent.note === 'rejected' ? (
                <p className="brief-error" data-testid="brief-note-error">Записка не принята. Прежний файл не изменён.</p>
              ) : null}
            </>
          ) : null}
          <div className="brief-actions">
            <button type="button" className="btn primary" data-testid="copy-brief" onClick={() => { void copy() }}>
              Скопировать бриф
            </button>
            {ready?.href ? (
              <a className="btn" data-testid="open-lead-chat" href={ready.href}>Открыть чат главного</a>
            ) : null}
          </div>
          {copied ? <p className="sub">Бриф в буфере</p> : null}
          {copyFailed ? <p className="brief-error" data-testid="copy-error">Буфер недоступен</p> : null}
          {ready?.fallback ? <p data-testid="brief-fallback">{ready.fallback}</p> : null}
        </>
      ) : null}
    </section>
  )
}

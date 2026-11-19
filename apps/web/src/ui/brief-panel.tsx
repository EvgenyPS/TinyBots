/**
 * FILE: apps/web/src/ui/brief-panel.tsx
 * НАЗНАЧЕНИЕ: собрать бриф с экрана проекта и отдать его в буфер или в ссылку чата.
 * ВХОД: id проекта и чата, задачи этого чата, способ доставки из конфига.
 * ВЫХОД: превью текста с сервера. Если главный на паузе или не задан, превью нет: ошибка и «Выберите главного».
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
}) {
  const previewRef = useRef<HTMLPreElement>(null)
  const [ready, setReady] = useState<Ready | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  async function assemble(taskId: string): Promise<void> {
    setCopied(false)
    setCopyFailed(false)
    const params = new URLSearchParams({
      project: props.projectId,
      chat: props.chatId,
      task: taskId,
    })
    try {
      const res = await fetch(`/api/brief?${params.toString()}`, { cache: 'no-store' })
      const body: unknown = await res.json()
      if (isReady(body)) {
        setReady(body)
        setProblem(null)
        return
      }
      setReady(null)
      if (isProblem(body)) {
        setProblem(body)
        return
      }
      setProblem({ ok: false, message: 'Бриф не собрался', hint: 'Выберите главного' })
    } catch {
      setReady(null)
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
      {ready ? (
        <>
          <p data-testid="brief-recipient">{ready.recipient}</p>
          <pre className="brief-preview" data-testid="brief-preview" ref={previewRef}>{ready.text}</pre>
          <div className="brief-actions">
            <button type="button" className="btn primary" data-testid="copy-brief" onClick={() => { void copy() }}>
              Скопировать бриф
            </button>
            {ready.href ? (
              <a className="btn" data-testid="open-lead-chat" href={ready.href}>Открыть чат главного</a>
            ) : null}
          </div>
          {copied ? <p className="sub">Бриф в буфере</p> : null}
          {copyFailed ? <p className="brief-error" data-testid="copy-error">Буфер недоступен</p> : null}
          {!ready.href && ready.fallback ? <p data-testid="brief-fallback">{ready.fallback}</p> : null}
        </>
      ) : null}
    </section>
  )
}

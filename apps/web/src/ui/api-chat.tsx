/**
 * FILE: apps/web/src/ui/api-chat.tsx
 * НАЗНАЧЕНИЕ: переписка со своим ботом в пульте.
 * ВХОД: id бота, токен записи. История приходит с сервера.
 * ВЫХОД: сообщения текстом. HTML и javascript: из ответа не становятся разметкой.
 */

import { useEffect, useState } from 'react'

type Line = { role: 'user' | 'assistant'; text: string }

function linesOf(value: unknown): Line[] {
  if (!value || typeof value !== 'object') {
    return []
  }
  const messages = (value as { messages?: unknown }).messages
  if (!Array.isArray(messages)) {
    return []
  }
  const lines: Line[] = []
  for (const item of messages) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const row = item as { role?: unknown; text?: unknown }
    if ((row.role === 'user' || row.role === 'assistant') && typeof row.text === 'string') {
      lines.push({ role: row.role, text: row.text })
    }
  }
  return lines
}

export function ApiChat(props: {
  botId: string
  botName: string
  csrf: string
  projectId: string
  chatId: string
  onDone: () => void
}) {
  const [lines, setLines] = useState<Line[]>([])
  const [text, setText] = useState('')
  const [usage, setUsage] = useState('нет данных')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/chat?bot=${encodeURIComponent(props.botId)}`, { cache: 'no-store' })
      .then(async (res) => {
        const body: unknown = await res.json()
        if (cancelled) {
          return
        }
        setLines(linesOf(body))
        if (body && typeof body === 'object' && typeof (body as { usage_label?: unknown }).usage_label === 'string') {
          setUsage((body as { usage_label: string }).usage_label)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('История не открылась')
        }
      })
    return () => {
      cancelled = true
    }
  }, [props.botId])

  async function send(): Promise<void> {
    const message = text.trim()
    if (message.length === 0 || busy) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': props.csrf,
        },
        body: JSON.stringify({
          bot: props.botId,
          text: message,
          project: props.projectId,
          chat: props.chatId,
        }),
      })
      const body: unknown = await res.json()
      if (body && typeof body === 'object' && (body as { ok?: unknown }).ok === true) {
        setLines(linesOf(body))
        const label = (body as { usage_label?: unknown }).usage_label
        setUsage(typeof label === 'string' ? label : 'нет данных')
        setText('')
        props.onDone()
        return
      }
      const messageText = body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : 'Сообщение не ушло'
      setError(messageText)
    } catch {
      setError('Пульт не ответил')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="api-chat" data-testid="api-chat" data-bot={props.botId}>
      <h3>Чат {props.botName}</h3>
      <div className="api-log" data-testid="api-chat-log">
        {lines.length === 0 ? <p className="sub">Сообщений пока нет.</p> : null}
        {lines.map((line, index) => (
          <p key={`${line.role}-${index}`} className="api-line" data-role={line.role}>{line.text}</p>
        ))}
      </div>
      <p className="sub" data-testid="api-usage">{usage}</p>
      {error ? <p className="brief-error" data-testid="api-chat-error">{error}</p> : null}
      <form
        className="api-form"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <input
          data-testid="api-chat-input"
          value={text}
          autoComplete="off"
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" className="btn primary" data-testid="api-chat-send" disabled={busy}>Отправить</button>
      </form>
    </section>
  )
}

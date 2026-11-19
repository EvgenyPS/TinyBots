/**
 * FILE: apps/web/src/App.tsx
 * НАЗНАЧЕНИЕ: демо-экран каркаса, пока нет оболочки v6 (PR 4).
 * ВХОД: GET /api/bots — вымышленный список из demo/bots.json.
 * ВЫХОД: заголовок и имена ботов. Имена вставляет React, без innerHTML.
 */

import { useEffect, useState } from 'react'

type Bot = {
  id: string
  name: string
  role: string
}

export function App() {
  const [bots, setBots] = useState<Bot[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/bots')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        return res.json() as Promise<Bot[]>
      })
      .then((data) => {
        if (!cancelled) {
          setBots(data)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'ошибка загрузки')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main>
      <h1>Hello TinyBots</h1>
      {error ? <p>{error}</p> : null}
      <ul>
        {bots.map((bot) => (
          <li key={bot.id}>
            {bot.name} — {bot.role}
          </li>
        ))}
      </ul>
    </main>
  )
}

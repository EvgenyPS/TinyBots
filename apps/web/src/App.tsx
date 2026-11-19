/**
 * FILE: apps/web/src/App.tsx
 * НАЗНАЧЕНИЕ: корень страницы. /setup — мастер. Корень без своего конфига тоже открывает мастер.
 * ВХОД: адрес и GET /api/setup. Демо остаётся по ?demo=1, файл при этом не пишется.
 * ВЫХОД: мастер или пульт. Список каркаса /api/bots страница не рисует.
 */

import { useEffect, useState } from 'react'
import { SetupWizard } from './ui/setup-wizard'
import { Dashboard } from './ui/v6-shell'

type Gate = 'pending' | 'wizard' | 'dash'

function isRequired(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  return (value as { required?: unknown }).required === true
}

export function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  const demo = new URLSearchParams(window.location.search).get('demo') === '1'
  const [gate, setGate] = useState<Gate>(path === '/setup' ? 'wizard' : 'pending')

  useEffect(() => {
    if (path === '/setup' || demo) {
      setGate(path === '/setup' ? 'wizard' : 'dash')
      return
    }
    let cancelled = false
    fetch('/api/setup', { cache: 'no-store' })
      .then(async (res) => {
        const body: unknown = await res.json()
        if (cancelled) {
          return
        }
        setGate(isRequired(body) ? 'wizard' : 'dash')
      })
      .catch(() => {
        if (!cancelled) {
          setGate('dash')
        }
      })
    return () => {
      cancelled = true
    }
  }, [path, demo])

  if (gate === 'pending') {
    return <main className="setup" data-testid="loading">Загрузка</main>
  }
  if (gate === 'wizard') {
    return <SetupWizard />
  }
  return <Dashboard />
}

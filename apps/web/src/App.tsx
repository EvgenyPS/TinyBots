/**
 * FILE: apps/web/src/App.tsx
 * НАЗНАЧЕНИЕ: корень страницы. /setup — заглушка мастера, остальное — пульт.
 * ВХОД: адрес страницы и ответ /api/launcher внутри оболочки.
 * ВЫХОД: тёмный интерфейс. Список каркаса /api/bots страница больше не рисует.
 */

import { Dashboard, SetupStub } from './ui/v6-shell'

export function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/setup') {
    return <SetupStub />
  }
  return <Dashboard />
}

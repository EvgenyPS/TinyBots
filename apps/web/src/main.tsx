/**
 * FILE: apps/web/src/main.tsx
 * НАЗНАЧЕНИЕ: точка входа страницы каркаса.
 * ВХОД: элемент #root и ответ /api/bots.
 * ВЫХОД: заголовок Hello TinyBots и список демо-ботов.
 * Оболочка макета v6 сюда не входит — это PR 4.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './App.css'

const root = document.getElementById('root')
if (!root) {
  throw new Error('Нет элемента #root')
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

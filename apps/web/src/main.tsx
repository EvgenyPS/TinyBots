/**
 * FILE: apps/web/src/main.tsx
 * НАЗНАЧЕНИЕ: точка входа страницы пульта.
 * ВХОД: элемент #root. Данные оболочка берёт из /api/launcher.
 * ВЫХОД: тёмный пульт. До гидрации в HTML остаётся заголовок каркаса.
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

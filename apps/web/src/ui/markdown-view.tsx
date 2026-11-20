/**
 * FILE: apps/web/src/ui/markdown-view.tsx
 * НАЗНАЧЕНИЕ: показать блоки markdown как элементы React.
 * ВХОД: текст. Разбор — markdown.ts.
 * ВЫХОД: заголовки, таблица, код. Текст — дочерние узлы, не innerHTML.
 * Поэтому <script> из файла не становится узлом script.
 */

import type { ReactNode } from 'react'
import { parseMarkdown } from './markdown'

function inline(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`)/g)
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return <code key={index}>{part.slice(1, -1)}</code>
    }
    return <span key={index}>{part}</span>
  })
}

export function MarkdownView(props: { source: string }) {
  const blocks = parseMarkdown(props.source)
  return (
    <div className="md" data-testid="markdown">
      {blocks.map((block, index) => {
        if (block.kind === 'h') {
          const Tag = block.level === 1 ? 'h2' : 'h3'
          return <Tag key={index}>{inline(block.text)}</Tag>
        }
        if (block.kind === 'code') {
          return <pre key={index}><code>{block.text}</code></pre>
        }
        if (block.kind === 'ul') {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}
            </ul>
          )
        }
        if (block.kind === 'table') {
          return (
            <table key={index}>
              <thead>
                <tr>{block.header.map((cell, cellIndex) => <th key={cellIndex}>{inline(cell)}</th>)}</tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => <td key={cellIndex}>{inline(cell)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
        return <p key={index}>{inline(block.text)}</p>
      })}
    </div>
  )
}

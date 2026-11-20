/**
 * FILE: apps/web/src/ui/docs-panel.tsx
 * НАЗНАЧЕНИЕ: документация проекта из markdown в папке файлов.
 * ВХОД: id проекта. Список — из /api/files, текст — из /api/docs.
 * ВЫХОД: безопасный рендер. HTML из файла не исполняется.
 */

import { useEffect, useState } from 'react'
import { MarkdownView } from './markdown-view'

type DocFile = { path: string; name: string }

export function DocsPanel(props: { projectId: string }) {
  const [files, setFiles] = useState<DocFile[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(false)
    fetch(`/api/files?project=${encodeURIComponent(props.projectId)}`, { cache: 'no-store' })
      .then(async (res) => {
        const body: unknown = await res.json()
        if (cancelled) {
          return
        }
        const nodes = body && typeof body === 'object' && Array.isArray((body as { nodes?: unknown }).nodes)
          ? (body as { nodes: Array<{ path?: unknown; name?: unknown; kind?: unknown }> }).nodes
          : null
        if (!res.ok || !nodes) {
          setError(true)
          return
        }
        const docs = nodes.flatMap((node) => {
          if (node.kind !== 'file' || typeof node.path !== 'string' || !node.path.endsWith('.md')) {
            return []
          }
          const name = typeof node.name === 'string' ? node.name : node.path
          return [{ path: node.path, name }]
        })
        setFiles(docs)
        setCurrent((prev) => (prev && docs.some((doc) => doc.path === prev) ? prev : docs[0]?.path ?? null))
      })
      .catch(() => {
        if (!cancelled) {
          setError(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [props.projectId, tick])

  useEffect(() => {
    if (!current) {
      setMarkdown(null)
      return
    }
    let cancelled = false
    setMarkdown(null)
    const path = `/api/docs?project=${encodeURIComponent(props.projectId)}&path=${encodeURIComponent(current)}`
    fetch(path, { cache: 'no-store' })
      .then(async (res) => {
        const body: unknown = await res.json()
        if (cancelled) {
          return
        }
        const text = body && typeof body === 'object' ? (body as { markdown?: unknown }).markdown : null
        if (!res.ok || typeof text !== 'string') {
          setError(true)
          return
        }
        setMarkdown(text)
      })
      .catch(() => {
        if (!cancelled) {
          setError(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [props.projectId, current])

  if (error) {
    return (
      <section data-testid="docs-panel">
        <p>Документация не открылась.</p>
        <button type="button" className="btn" onClick={() => setTick((n) => n + 1)}>Повторить</button>
      </section>
    )
  }
  return (
    <section data-testid="docs-panel">
      <div className="doc-list">
        {files.map((file) => (
          <button
            key={file.path}
            type="button"
            className={file.path === current ? 'tab on' : 'tab'}
            data-testid={`doc-${file.path}`}
            onClick={() => setCurrent(file.path)}
          >
            {file.name}
          </button>
        ))}
      </div>
      {files.length === 0 ? <p className="sub">Markdown в папке проекта нет.</p> : null}
      {markdown !== null ? <MarkdownView source={markdown} /> : current ? <p>Загрузка документа</p> : null}
    </section>
  )
}

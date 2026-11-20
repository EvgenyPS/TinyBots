/**
 * FILE: apps/web/src/ui/git-panel.tsx
 * НАЗНАЧЕНИЕ: коммиты, diffstat, PR и CI. Токен на страницу не приходит.
 * ВХОД: id проекта, GET /api/git.
 * ВЫХОД: список, если вкладка стартовала. Иначе предупреждение сервера и пустые списки.
 */

import { useEffect, useState } from 'react'

type Commit = { sha: string; message: string; author: string; at: string }
type Row = { path: string; additions: number; deletions: number }
type Pull = { number: number; title: string; state: string; url: string }
type Check = { name: string; state: string }
type Git = {
  ok: true
  started: boolean
  hidden: boolean
  warning: string | null
  commits: Commit[]
  diffstat: { files: number; additions: number; deletions: number; rows: Row[] }
  pulls: Pull[]
  ci: Check[]
}

function isGit(value: unknown): value is Git {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as { ok?: unknown; started?: unknown; commits?: unknown }
  return row.ok === true && typeof row.started === 'boolean' && Array.isArray(row.commits)
}

export function GitPanel(props: { projectId: string }) {
  const [git, setGit] = useState<Git | null>(null)
  const [error, setError] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setGit(null)
    setError(false)
    fetch(`/api/git?project=${encodeURIComponent(props.projectId)}`, { cache: 'no-store' })
      .then(async (res) => {
        const body: unknown = await res.json()
        if (cancelled) {
          return
        }
        if (!res.ok || !isGit(body)) {
          setError(true)
          return
        }
        setGit(body)
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

  if (error) {
    return (
      <section data-testid="git-panel">
        <p>Git не открылся.</p>
        <button type="button" className="btn" onClick={() => setTick((n) => n + 1)}>Повторить</button>
      </section>
    )
  }
  if (!git) {
    return <section data-testid="git-panel">Загрузка Git</section>
  }
  if (!git.started) {
    return <section data-testid="git-panel"><p className="warn-box" data-testid="git-tab-warning">{git.warning ?? 'Вкладка Git не стартует.'}</p></section>
  }
  const stat = git.diffstat
  return (
    <section className="card pad" data-testid="git-panel">
      <h2>Git</h2>
      <p className="sub" data-testid="git-diffstat">+{stat.additions} / −{stat.deletions} · файлов {stat.files}</p>
      <ul className="commits" data-testid="git-commits">
        {git.commits.map((commit) => (
          <li key={commit.sha} data-testid={`commit-${commit.sha.slice(0, 7)}`}>
            <span className="sha">{commit.sha.slice(0, 7)}</span>
            <span>{commit.message}</span>
            <span className="sub">{commit.author}</span>
          </li>
        ))}
      </ul>
      <ul className="plain" data-testid="git-files">
        {stat.rows.map((row) => (
          <li key={row.path}>{row.path} +{row.additions} −{row.deletions}</li>
        ))}
      </ul>
      <ul className="plain" data-testid="git-pulls">
        {git.pulls.map((pull) => (
          <li key={pull.number}>PR #{pull.number} {pull.title}</li>
        ))}
      </ul>
      <ul className="plain" data-testid="git-ci">
        {git.ci.map((check) => (
          <li key={check.name}>{check.name}: {check.state}</li>
        ))}
      </ul>
    </section>
  )
}

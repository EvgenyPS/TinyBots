/**
 * FILE: apps/server/src/git/index.ts
 * НАЗНАЧЕНИЕ: вкладка Git для проекта из конфига.
 * ВХОД: корень репозитория, путь конфига и id проекта. Токен берётся из окружения.
 * ВЫХОД: агрегаты GitHub или предупреждение. Токена в теле нет.
 * Нет source.git.repo — вкладка скрыта (проект без git). Это не ошибка.
 */

import type { ConfigFailure } from '../config/load.js'
import { loadConfigAt, selectConfigRequest } from '../config/load.js'
import { emptyGit, loadGitSummary, type GitSummary } from './github.js'

export type { GitSummary } from './github.js'

export async function readGitSummary(
  root: string,
  configPath: string | undefined,
  projectId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ status: 200 | 422; body: GitSummary | ConfigFailure }> {
  const loaded = loadConfigAt(root, selectConfigRequest(root, configPath))
  if (!loaded.ok) {
    return { status: 422, body: loaded }
  }
  const project = loaded.config.projects.find((item) => item.id === projectId)
  if (!project) {
    return { status: 200, body: { ...emptyGit(null), hidden: true } }
  }
  const repo = project.source.git?.repo ?? null
  if (!repo) {
    return { status: 200, body: { ...emptyGit(null), hidden: true } }
  }
  const summary = await loadGitSummary({
    token: env.GITHUB_TOKEN ?? '',
    repo,
    apiBase: env.GITHUB_API_BASE?.trim() || 'https://api.github.com',
  })
  return { status: 200, body: summary }
}

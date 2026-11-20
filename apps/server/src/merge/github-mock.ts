/**
 * FILE: apps/server/src/merge/github-mock.ts
 * НАЗНАЧЕНИЕ: ответ «GitHub» для демо и тестов. Сети нет, токен не читается.
 * ВХОД: pr_url. Если в пути есть /mock-fail/, мерж падает — так e2e видит merge_failed.
 * ВЫХОД: sha коммита или текст ошибки. Настоящий API не вызываем.
 */

const MOCK_COMMIT = 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00'

export function mockGithubMerge(prUrl: string): { ok: true; commit: string } | { ok: false; error: string } {
  if (prUrl.includes('/mock-fail/')) {
    return { ok: false, error: 'мок GitHub: мерж не прошёл' }
  }
  return { ok: true, commit: MOCK_COMMIT }
}

export function mockGithubRevert(prUrl: string): { ok: true; pr: string } {
  return { ok: true, pr: `${prUrl}#revert` }
}

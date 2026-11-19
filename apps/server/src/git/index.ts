/**
 * FILE: apps/server/src/git/index.ts
 * НАЗНАЧЕНИЕ: локальный git и, при токене только для чтения, данные с хостинга.
 * ВХОД: путь репозитория и токен из .env (во фронт не попадает).
 * ВЫХОД: коммиты, diffstat, PR, CI. Без токена вкладка скрыта.
 * СТАТУС: заглушка. Реализация — PR 8.
 */

export function readGitSummary(): never {
  // TODO(PR 8): simple-git локально; удалённый API только если в .env есть токен чтения.
  throw new Error('git: не реализовано (PR 8)')
}

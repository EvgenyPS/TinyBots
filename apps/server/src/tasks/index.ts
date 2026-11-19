/**
 * FILE: apps/server/src/tasks/index.ts
 * НАЗНАЧЕНИЕ: очередь задач, статусы, пометка «устарело».
 * ВХОД: tasks/*.yaml и stale_after_hours.
 * ВЫХОД: карточки задач для пульта.
 * СТАТУС: заглушка. Реализация — PR 5.
 */

export function listTasks(): never {
  // TODO(PR 5): очередь, статусы и серая записка старше порога часов.
  throw new Error('tasks: не реализовано (PR 5)')
}

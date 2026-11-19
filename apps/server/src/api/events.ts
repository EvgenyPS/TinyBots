/**
 * FILE: apps/server/src/api/events.ts
 * НАЗНАЧЕНИЕ: поток SSE /api/events для инвалидации экрана.
 * ВХОД: события store.
 * ВЫХОД: text/event-stream на 127.0.0.1.
 * СТАТУС: заглушка. Реализация — PR 3.
 */

export function eventStream(): never {
  // TODO(PR 3): SSE /api/events. Подписчик только с разрешённым Host/Origin.
  throw new Error('api/events: не реализовано (PR 3)')
}

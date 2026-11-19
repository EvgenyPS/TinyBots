/**
 * FILE: apps/server/src/merge/index.ts
 * НАЗНАЧЕНИЕ: конечный автомат мержа и outbox решений.
 * ВХОД: запрос и действие владельца.
 * ВЫХОД: новый state и запись в outbox/decisions.
 * СТАТУС: заглушка. Реализация — PR 6.
 * Граф состояний — docs/CONTRACT.md (состояние delivered).
 */

export function transitionMerge(): never {
  // TODO(PR 6): автомат мержа и запись решения. Исполнитель стартует только из delivered.
  throw new Error('merge: не реализовано (PR 6)')
}

/**
 * FILE: apps/server/src/merge/index.ts
 * НАЗНАЧЕНИЕ: конечный автомат мержа и outbox решений.
 * ВХОД: запрос и действие владельца.
 * ВЫХОД: новый state после доставки и запись в outbox/decisions до неё.
 * Исполнитель стартует только из delivered. До синхронизации статус запроса не меняется.
 */

export { buildMergeBrief, buildRevertBrief } from './authorize.js'
export { deliverOutbox } from './deliver.js'
export { postDecision, postSync } from './http.js'
export { applyTransition } from './transition.js'

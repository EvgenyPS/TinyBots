/**
 * FILE: apps/server/src/store/index.ts
 * НАЗНАЧЕНИЕ: чтение data_dir, атомарная запись, один писатель, события для SSE.
 * ВХОД: каталог data_dir.
 * ВЫХОД: файлы задач, записок и снимков расхода.
 * СТАТУС: заглушка. Реализация — PR 3.
 */

export function readStore(): never {
  // TODO(PR 3): tmp+rename, запрет второго писателя, chokidar и отдача изменений в SSE.
  throw new Error('store: не реализовано (PR 3)')
}

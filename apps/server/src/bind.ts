/**
 * FILE: apps/server/src/bind.ts
 * НАЗНАЧЕНИЕ: единственный адрес, на котором имеет право слушать каркас.
 * Почему константа: вызов listen без хоста в Node открывает все интерфейсы.
 */

/** Loopback IPv4. Не заменять на все интерфейсы и не читать из конфига. */
export const BIND_HOST = '127.0.0.1'

/** Порт десктопа. Host пускает только эту пару с 127.0.0.1 и localhost. */
export const DESKTOP_PORT = 8787

const DEFAULT_PORT = DESKTOP_PORT

/**
 * Порт из окружения. Значение в текст ошибки не подставляем:
 * в переменную могли по ошибке положить секрет.
 */
export function resolvePort(value: string | undefined, fallback = DEFAULT_PORT): number {
  if (value === undefined || value.trim() === '') {
    return fallback
  }
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT должен быть целым числом от 0 до 65535')
  }
  return port
}

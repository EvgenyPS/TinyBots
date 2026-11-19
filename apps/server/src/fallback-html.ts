/**
 * FILE: apps/server/src/fallback-html.ts
 * НАЗНАЧЕНИЕ: страница, если сборка apps/web/dist ещё не лежит рядом.
 * Без встроенного скрипта: список ботов на /api/bots, а в браузере его рисует React после сборки.
 */

export const FALLBACK_HTML = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>TinyBots</title>
</head>
<body>
  <main>
    <h1>Hello TinyBots</h1>
    <p>Сборка страницы не найдена. Список ботов: <a href="/api/bots">/api/bots</a>.</p>
  </main>
</body>
</html>
`

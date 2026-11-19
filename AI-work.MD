# AI-work

## Проект

TinyBots — локальный пульт над ботами. Репозиторий публичный: имена, пути и id чатов задаются конфигом, в git лежат только вымышленные демо-данные. Сервер слушает `127.0.0.1`. Лицензия Apache-2.0.

## Что в этом дереве

- npm workspaces: `packages/schema`, `apps/server` (Hono), `apps/web` (Vite + React).
- `npm start` собирает страницу и открывает демо: «Hello TinyBots» и список из `demo/bots.json`.
- Слушаем только loopback. Чужой `Host` или `Origin` получает 403. Запись отвечает 405, CSRF-токен сюда не входит.
- `LICENSE`, `NOTICE`, `.gitignore` (в том числе `data/`, `data_dir/` и исключение `demo/data/`), `.env.example`, `config.example.yaml`.
- CI на push в `main` и на pull request: Node 20 и 24, `ubuntu-latest` и `windows-latest`. Шаги: `npm ci`, `tsc -b`, свежесть JSON Schema, eslint, vitest, gitleaks, лицензия, стоп-лист.
- Схемы zod на файлы контракта и `canTransition`. JSON Schema пишется в `packages/schema/json/`.
- `demo/data/` — по три валидных примера на схему. Битые примеры только в тесте.
- Скилл `skill/team-token-economy.md` — протокол, сдача, ревью и `rules.base`.
- Стоп-лист читает всё дерево, включая `docs/`. В git только общие шаблоны (`scripts/forbidden.txt`). Личные строки — в неотслеживаемом `scripts/forbidden.local.txt` и в секрете CI `FORBIDDEN_EXTRA`. Нет файла или переменной — предупреждение, проверка не падает. Журнал пишет файл, строку и номер правила.

## Не в этом дереве

config/store/SSE, оболочка v6, брифы, исполнитель мержа, синк, git/файлы, мастер настройки.

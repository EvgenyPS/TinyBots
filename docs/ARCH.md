# TinyBots — архитектура и стек (19.11.2026)

Стек из LAUNCHER_PLAN §2 подтверждаю: Node 20 LTS + TypeScript strict, Hono, Vite + React, zod, yaml, chokidar + SSE, simple-git. Ниже — что добавить/уточнить.

## 1. Раскладка (npm workspaces, один `package.json` в корне)
```
packages/schema/   # zod-схемы: config, task, status, merge_request, outbox, sync_manifest
                   # → генерация JSON Schema в schema/ (один источник правды, типы общие для server и web)
server/            # Hono на 127.0.0.1
  config/          # загрузка и валидация config.yaml + .env, мастер настройки пишет файл
  store/           # data_dir: чтение, атомарная запись (tmp+rename), один писатель, chokidar → SSE
                   #   usage/<YYYY-Www>.json — недельный снимок расхода пишет главный бот (статистика Grok Bot ≤30 дней), лаунчер только читает и строит график за 7 недель
  tasks/           # очередь задач, статусы, «устарело» по stale_after_hours
  merge/           # конечный автомат мержа (ниже)
  briefs/          # шаблоны брифов (≤ 8 строк) из задачи + конфиг чата; «Скопировать» / grokbot://
  sync/            # манифест и бандлы для главного бота (ниже)
  git/             # simple-git локально; Octokit только если в .env есть токен
  files/           # дерево и граф файлов проекта (только чтение, по allowlist путей из конфига)
  api/             # роуты /api/*, SSE /api/events
web/               # перенос v6 в компоненты; состояние — TanStack Query + SSE-инвалидация
demo/              # вымышленные данные, на них же e2e-тесты
```
БД нет: всё — файлы в `data_dir` (их же синхронизирует главный бот). SQLite — только если появится история/статистика больше одного экрана.

## 2. Форматы в data_dir (машиночитаемые, для экономии токенов)
- `tasks/<task_id>.yaml` — одна задача = один файл: `id, project, chat, assignee, brief(≤8 строк), files[], done_when, reply_limit, status, pr, updated_at`. Боты ссылаются на id, а не пересказывают.
- `status/<bot_id>.json` — записка бота: `task_id, state(working|blocked|done), result(≤6 строк), links[], updated_at`. Один писатель — сам бот.
- `merge_requests/<project>-<pr>.json` — от исполнителя.
- `outbox/` — только лаунчер: `decisions/`, `queue/`, `feedback/`.
Все файлы валидируются zod при чтении; невалидный файл показывается как ошибка карточки, а не роняет сервер.

## 3. Конечный автомат мержа
Единый вариант — см. docs/CONTRACT.md «Автомат мержа» (§4.5 плана + состояние `delivered`).

## 4. Синхронизация бокс ↔ ПК (меньше одобрений и токенов)
- Вместо пофайлового копирования — **по одному бандлу в каждую сторону**: `sync/box-to-pc.tgz` (status, merge_requests, tasks) и `sync/pc-to-box.tgz` (outbox). Итого 2 операции с ПК на синхронизацию, а не N.
- В бандле `sync_manifest.json` (путь, sha256, updated_at); распаковка пропускает неизменённые файлы и не перезаписывает файлы другой стороны (правило «один писатель»).
- Лаунчер сам собирает `pc-to-box.tgz` и сам распаковывает входящий — главному боту остаются ровно две команды копирования и одна строка в ответе.

## 5. Безопасность локального сервера
- Слушать только `127.0.0.1`; проверка заголовков `Host`/`Origin` (защита от DNS rebinding) и CSRF-токен на все записывающие роуты.
- Доступ к файлам — только внутри путей из конфига (нормализация, запрет `..` и симлинков наружу).
- Секреты только из `.env`, в API и логи не попадают; gitleaks в pre-commit и CI.

## 6. Качество и CI
`tsc --strict`, eslint, vitest (схемы, автомат мержа, атомарная запись, синк-манифест), Playwright на demo-данных (основные экраны v6, мастер, флоу мержа), проверка LICENSE/NOTICE, gitleaks. Кросс-ОС матрица: windows-latest + ubuntu-latest.

## 7. Порядок PR (каждый — одна задача)
1. Каркас workspaces, CI, LICENSE/NOTICE, demo/.
2. `packages/schema` + генерация JSON Schema + тесты.
3. server: config + store + SSE.
4. web: оболочка v6 на demo-данных (только чтение).
5. tasks + briefs (копирование брифа, ссылка grokbot://).
6. merge-автомат + outbox.
7. sync-бандлы.
8. git/files (дерево, граф).
9. Мастер настройки и пустые состояния.
10. Скилл `team-token-economy` в skill/ + доки.

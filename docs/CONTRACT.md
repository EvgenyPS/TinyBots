# Контракт — модули, репо, стек, контракт файлов (к §2, §3.2, §1)
Полная версия: ../ARCH.md. Стек, который уже в дереве: Node 20 LTS + TS strict, Hono, Vite+React, zod, yaml. Git-вкладка читает GitHub через `fetch` и `GITHUB_TOKEN`, без Octokit. chokidar и SSE, подмешивание секретов из `.env` в конфиг и блокировка одного писателя — позже, сейчас этого нет.

## Структура репо (уточнение §3.2, npm workspaces)
- `packages/schema/` — zod-схемы config/task/status/merge_request/outbox/sync_manifest; из них генерится `schema/*.json`. Один источник типов для server и web.
- `server/`: `config` (yaml; мастер и подмешивание `.env` — позже) · `store` (data_dir, атомарная запись tmp+rename с повтором rename при EPERM/EBUSY; блокировка одного писателя и chokidar→SSE — позже) · `tasks` · `merge` (автомат) · `briefs` (шаблоны ≤8 строк, grokbot://) · `sync` (бандлы) · `git` · `files` (дерево/граф, только allowlist путей) · `api` (`/api/*`, в том числе `/api/brief`; SSE `/api/events` — позже).
- `web/` — v6 в компонентах. TanStack Query и инвалидация по SSE — позже. `demo/`, `docs/`, `skill/` — как в §3.2.
- БД нет, только файлы data_dir.

## Контракт файлов (data_dir)
`tasks/<task_id>.yaml` — пишет главный бот:
`id, project, chat, assignee, goal, inputs[] (пути/SHA/PR), output, done_when, out_of_scope, reply_limit, due, status(new|working|review|done|blocked), updated_at` — поля = формат задачи ревизора (≤ 8 строк).
`status/<bot_id>.json` — пишет только бот-исполнитель (отчёт по протоколу тимлида):
`task_id, state(working|blocked|done), links[], verified, not_done, risks? (необяз., идёт в окно мержа), question_to_owner, updated_at` — поля = формат сдачи ревизора (≤ 6 строк).
`merge_requests/<project>-<pr>.json` — пишет главный: `project, pr_url, head_sha, tasks[], checks(green|red), summary(≤3 строки), state, history[{state,at,by,why}]` (модель §4.4 + head_sha).
`outbox/` — пишет только лаунчер:
- `decisions/<project>-<pr>.json`: `action(approved|rejected|revert), head_sha, by(owner), at`. Решение привязано к head_sha: новый пуш делает его недействительным.
- `queue/<task_id>.yaml`: черновик задачи от владельца.
- `feedback/<id>.json`: отзыв по результату.
Все файлы: `schema_version`, `updated_at` (ISO с зоной). Невалидный файл — ошибка на карточке, сервер не падает.

## Автомат мержа (сведён с §4.5, единый вариант)
`draft → awaiting_owner → (changes_requested → awaiting_owner …) → approved → delivered → merging → merged`.
Другие исходы: `→ rejected` · `merging → merge_failed → awaiting_owner` · `merged → reverted`.
Отличие от §4.5 одно — состояние `delivered` («решение доставлено на бокс», §1 «отправлено, не доставлено»): лаунчер ставит `approved`, `delivered` ставит только главный после синка, `merge_executor` стартует только из `delivered`. Если `head_sha` изменился после `approved` → обратно в `awaiting_owner`. Каждый переход в `history[{state,at,by,why}]`. В срезе этапа 2 живого главного нет: `POST /api/sync/apply` на демо проводит доставку и исполнителя подряд. Бандл `box-to-pc.tgz` по-прежнему не собирается.

## Синк бокс ↔ ПК (меньше одобрений)
По одному бандлу в каждую сторону: `box-to-pc.tgz` (tasks, status, merge_requests) и `pc-to-box.tgz` (outbox) с `sync_manifest.json` (path, sha256, updated_at). Это 2 операции на ПК вместо N. Распаковку делает лаунчер/скрипт, не перезаписывая файлы чужого писателя.

## Закрытый канал ключей (0.3.0)
Метаданные лежат в `data_dir/secrets/keys/<NAME>.json`. Значения в файле нет: оно только в хранилище ОС, сервис `tinybots`, учётная запись — `NAME`. Журнал вызовов — `data_dir/secrets/journal.jsonl` (имя, хост, метод, статус; значения нет).

`NAME` — `^[A-Z][A-Z0-9_]{0,63}$`.

```json
{
  "schema_version": 1,
  "updated_at": "2026-11-26T12:00:00.000Z",
  "name": "PARTNER",
  "description": "ключ партнёра",
  "header": "Authorization: Bearer",
  "body": false,
  "allow": [{ "host": "example.com", "methods": ["GET"] }],
  "bots": ["nora"]
}
```

`header` — имя заголовка или `Имя: префикс`. `body` по умолчанию `false`. `allow[].host` — точный хост в punycode, без `*.`. `methods` — GET, HEAD, POST, PUT, PATCH, DELETE. `bots` — id ботов, которым видна ссылка `{{secret:NAME}}`. GET `/api/secrets` добавляет поле `set` (boolean) и не добавляет значение. Удаления файла и связки в API нет.

Маска не собирает ключ, разрезанный разделителями. Не ловятся `w-J-a-…`, JSON-массив из отдельных символов и куски короче 8 символов через `|`. Это ограничение маски, код его не обходит.

## Безопасность
Только 127.0.0.1; проверка Host/Origin (DNS rebinding) и CSRF-токен на запись. `data_dir` и файл конфига — внутри репозитория, без `..` и внешней ссылки. Папка проекта (`source.files.path`) может быть вне лаунчера. Секреты только из .env или хранилища ОС, в API и логи не попадают; gitleaks в pre-commit и CI. Карточка закрытого ключа не читается из `config.yaml`.

## CI
tsc strict, eslint, vitest (схемы, автомат, атомарная запись, манифест), Playwright на demo, LICENSE/NOTICE, gitleaks; матрица windows-latest + ubuntu-latest.

## Порядок PR
1 каркас+CI+LICENSE/NOTICE+demo · 2 schema · 3 config/store (SSE — позже) · 4 web v6 только чтение · 5 tasks+briefs · 6 merge+outbox · 7 sync · 8 git/files · 9 мастер и пустые состояния · 10 skill + docs.

## Вопросы владельцу
Нет.

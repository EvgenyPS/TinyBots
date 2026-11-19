# schema

JSON Schema генерируется из `packages/schema` и лежит рядом с пакетом: `packages/schema/json/`.
Второй копии в этом каталоге нет: один источник, его свежесть проверяет CI (`git diff` после `emit`).

Файлы: config, task, status, merge-request, decision, queue, feedback, usage, sync-manifest.
Команда: `npm run schema:json`.

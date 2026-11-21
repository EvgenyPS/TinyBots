/**
 * FILE: apps/server/src/tools/limits.ts
 * НАЗНАЧЕНИЕ: числовые границы хода, чтения и хранения предложений.
 * ВХОД: нет. Это константы, их читают инструменты и тесты.
 * ВЫХОД: те же числа, что в критериях. Менять их без решения владельца нельзя.
 * Ретраи 429 внутри одного запроса к модели в счётчик запросов не входят.
 */

export const TOOL_CALL_LIMIT = 16
export const MODEL_REQUEST_LIMIT = 6
export const TOOL_OUTPUT_LIMIT = 256 * 1024
export const TOOL_TIMEOUT_MS = 10_000
export const TURN_DEADLINE_MS = 180_000

export const READ_FILE_MAX = 256 * 1024
export const READ_CALL_MAX = 64 * 1024
export const READ_LINES_MAX = 2000
export const BINARY_PROBE = 8 * 1024

export const LIST_DIR_MAX = 500
export const LIST_DEPTH_MAX = 12

export const SEARCH_QUERY_MIN = 2
export const SEARCH_QUERY_MAX = 200
export const SEARCH_FILES_MAX = 2000
export const SEARCH_DIRS_MAX = 5000
export const SEARCH_BYTES_MAX = 8 * 1024 * 1024
export const SEARCH_MATCH_MAX = 100
export const SEARCH_LINE_MAX = 300

export const DIFF_MAX = 256 * 1024
export const DIFF_FILES_MAX = 20
export const DIFF_FILE_MAX = 1024 * 1024
/**
 * Доля строк, которые дифф имеет право снять с уже существующего файла.
 * Считается от числа строк исходника. 0.5 — половина. Строго больше — отказ.
 * Ровно половина ещё проходит. Опустошение файла отвергается отдельно, даже если строк мало.
 */
export const DELETE_LINE_RATIO_MAX = 0.5

export const OPEN_PROPOSALS_MAX = 20
export const PROPOSALS_BYTES_MAX = 256 * 1024 * 1024
export const CLOSED_KEEP_MAX = 100
export const CLOSED_KEEP_MS = 30 * 24 * 60 * 60 * 1000

export const GIT_TIMEOUT_MS = 10_000
export const GIT_MAX_BUFFER = 2 * 1024 * 1024
export const GIT_MIN = [2, 45, 1] as const

export const PATH_MAX = 300

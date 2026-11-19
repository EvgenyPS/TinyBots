/**
 * После npm install направляет git на .githooks (там pre-commit с gitleaks).
 * Ошибка git не роняет установку: в CI gitleaks всё равно отдельным шагом.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

if (!existsSync('.git')) {
  process.exit(0)
}

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' })
} catch {
  // Репозитория нет или git запретил config — хук просто не включится.
}

/**
 * FILE: packages/schema/src/usage.ts
 * НАЗНАЧЕНИЕ: недельный снимок usage/<YYYY-Www>.json.
 * ВХОД: цифры, которые главный бот записал по статистике.
 * ВЫХОД: доли и оценка экономии. Процент — оценка, не цель.
 */

import { z } from 'zod'
import { versionFields } from './common.js'

const share = z.number().min(0).max(1)

export const usageSchema = z.strictObject({
  ...versionFields,
  week: z.string().regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/, 'неделя ISO'),
  wakes_per_task: z.number().nonnegative(),
  replies_over_limit_share: share,
  blocked_share: share,
  savings_estimate_percent: z.number().nullable(),
  baseline: z.boolean(),
})

export type UsageSnapshot = z.infer<typeof usageSchema>

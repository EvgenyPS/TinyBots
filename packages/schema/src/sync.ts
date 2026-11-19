/**
 * FILE: packages/schema/src/sync.ts
 * НАЗНАЧЕНИЕ: sync_manifest.json внутри бандла синка.
 * ВХОД: список путей и sha256.
 * ВЫХОД: манифест. Пустой список допустим: бандл без изменений всё равно имеет файл.
 */

import { z } from 'zod'
import { isoSchema, versionFields } from './common.js'

export const syncManifestSchema = z.strictObject({
  ...versionFields,
  entries: z.array(z.strictObject({
    path: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256'),
    updated_at: isoSchema,
  })),
})

export type SyncManifest = z.infer<typeof syncManifestSchema>

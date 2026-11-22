/**
 * FILE: apps/server/src/tools/roots.test.ts
 * НАЗНАЧЕНИЕ: опасные корни папки проекта. Корень ФС и дом инструменты не открывают.
 */

import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { dangerousRootReason } from './roots.js'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

test('корень ФС и дом не годятся, обычная папка годится', async () => {
  const home = realpathSync(os.homedir())
  const launcher = await mkdtemp(path.join(os.tmpdir(), 'tinybots-root-'))
  dirs.push(launcher)
  const data = path.join(launcher, 'data')
  const project = path.join(launcher, 'proj')
  await mkdir(data)
  await mkdir(project)
  expect(dangerousRootReason(path.parse(home).root, launcher, data)).not.toBeNull()
  expect(dangerousRootReason(home, launcher, data)).not.toBeNull()
  expect(dangerousRootReason(await import('node:fs/promises').then((fs) => fs.realpath(project)), launcher, data)).toBeNull()
})

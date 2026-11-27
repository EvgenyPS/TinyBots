/**
 * FILE: apps/server/src/sea-keyring.test.ts
 * НАЗНАЧЕНИЕ: .node keyring открывается из Node SEA, не из node_modules.
 * ВХОД: бинарник текущего node и пакетный .node этой ОС.
 * ВЫХОД: в stdout есть SEA_KEYRING_LOADED. Значение ключа туда не пишется.
 */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { chmodSync, copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { findKeyringAddon, keyringAddonNames, loadSeaKeyring } from './llm/keyring-native.js'

const require = createRequire(import.meta.url)
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

function packageAddon(): { dir: string; filename: string } | null {
  const filename = keyringAddonNames()[0]
  if (!filename) {
    return null
  }
  const pkg = filename.replace(/^keyring\./, '@napi-rs/keyring-').replace(/\.node$/, '')
  try {
    const dir = path.dirname(require.resolve(`${pkg}/package.json`))
    return { dir, filename }
  } catch {
    return null
  }
}

test('модуль рядом с путём exe находится и открывается', () => {
  const addon = packageAddon()
  expect(addon, 'нет пакета @napi-rs/keyring для этой ОС').not.toBeNull()
  if (!addon) {
    return
  }
  const execPath = path.join(addon.dir, 'tinybots-server')
  const found = findKeyringAddon(execPath)
  expect(found).toBe(path.join(addon.dir, addon.filename))
  const loaded = loadSeaKeyring(execPath)
  expect(typeof loaded?.AsyncEntry).toBe('function')
})

test('SEA открывает тот же .node рядом с собой', () => {
  const addon = packageAddon()
  expect(addon).not.toBeNull()
  if (!addon) {
    return
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'tinybots-sea-'))
  const exe = path.join(dir, process.platform === 'win32' ? 'tinybots-server.exe' : 'tinybots-server')
  try {
    copyFileSync(process.execPath, exe)
    chmodSync(exe, 0o755)
    copyFileSync(path.join(addon.dir, addon.filename), path.join(dir, addon.filename))
    writeFileSync(path.join(dir, 'probe.cjs'), `
const path = require('path')
const addon = path.join(path.dirname(process.execPath), ${JSON.stringify(addon.filename)})
const mod = { exports: {} }
try {
  process.dlopen(mod, addon)
} catch (error) {
  process.stdout.write('SEA_KEYRING_LOAD_FAIL\\n')
  process.exit(1)
}
if (typeof mod.exports.AsyncEntry !== 'function') {
  process.stdout.write('SEA_KEYRING_NO_ENTRY\\n')
  process.exit(1)
}
process.stdout.write('SEA_KEYRING_LOADED\\n')
`)
    writeFileSync(path.join(dir, 'sea-config.json'), `${JSON.stringify({
      main: 'probe.cjs',
      output: 'sea-prep.blob',
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    })}\n`)
    const sea = spawnSync(process.execPath, ['--experimental-sea-config', 'sea-config.json'], {
      cwd: dir,
      encoding: 'utf8',
    })
    expect(sea.status, sea.stderr).toBe(0)
    const postject = path.join(path.dirname(require.resolve('postject/package.json')), 'dist', 'cli.js')
    const injected = spawnSync(process.execPath, [
      postject,
      exe,
      'NODE_SEA_BLOB',
      path.join(dir, 'sea-prep.blob'),
      '--sentinel-fuse',
      FUSE,
    ], { encoding: 'utf8' })
    expect(injected.status, injected.stderr).toBe(0)
    const ran = spawnSync(exe, [], { encoding: 'utf8' })
    expect(ran.status, ran.stderr).toBe(0)
    expect(ran.stdout).toContain('SEA_KEYRING_LOADED')
    expect(ran.stdout.includes('canary')).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 120_000)

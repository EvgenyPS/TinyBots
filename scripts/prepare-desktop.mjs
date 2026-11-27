/**
 * FILE: scripts/prepare-desktop.mjs
 * НАЗНАЧЕНИЕ: собрать страницу, сервер и sidecar Node SEA перед tauri build.
 * ВХОД: исходники apps/server и apps/web, пакет @napi-rs/keyring для этой ОС.
 * ВЫХОД: apps/desktop/src-tauri/binaries/tinybots-server-<triple> и .node рядом.
 * Токен сессии здесь не создаётся.
 */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'package.json'))
const desktop = path.join(root, 'apps', 'desktop', 'src-tauri')
const seaDir = path.join(desktop, 'sea')
const binaries = path.join(desktop, 'binaries')
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function hostTriple() {
  const result = spawnSync('rustc', ['-vV'], { encoding: 'utf8' })
  const match = result.stdout.match(/host:\s+(\S+)/)
  if (!match) {
    console.error('rustc не сообщил host triple')
    process.exit(1)
  }
  return match[1]
}

function addon() {
  const platform = process.platform
  const arch = process.arch
  const table = {
    'win32:x64': ['@napi-rs/keyring-win32-x64-msvc', 'keyring.win32-x64-msvc.node'],
    'win32:arm64': ['@napi-rs/keyring-win32-arm64-msvc', 'keyring.win32-arm64-msvc.node'],
    'linux:x64': ['@napi-rs/keyring-linux-x64-gnu', 'keyring.linux-x64-gnu.node'],
    'linux:arm64': ['@napi-rs/keyring-linux-arm64-gnu', 'keyring.linux-arm64-gnu.node'],
    'darwin:x64': ['@napi-rs/keyring-darwin-x64', 'keyring.darwin-x64.node'],
    'darwin:arm64': ['@napi-rs/keyring-darwin-arm64', 'keyring.darwin-arm64.node'],
  }
  const row = table[`${platform}:${arch}`]
  if (!row) {
    console.error(`нет сборки keyring для ${platform} ${arch}`)
    process.exit(1)
  }
  if (platform === 'linux' && existsMusl()) {
    return ['@napi-rs/keyring-linux-x64-musl', 'keyring.linux-x64-musl.node']
  }
  return row
}

function existsMusl() {
  try {
    const { existsSync, readFileSync } = require('node:fs')
    if (existsSync('/lib/ld-musl-x86_64.so.1')) {
      return true
    }
    return readFileSync('/usr/bin/ldd', 'utf8').includes('musl')
  } catch {
    return false
  }
}

run(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-b'], root)
const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')
run(process.execPath, [vite, 'build'], path.join(root, 'apps', 'web'))

mkdirSync(seaDir, { recursive: true })
mkdirSync(binaries, { recursive: true })

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [path.join(root, 'apps', 'server', 'dist', 'main.js')],
  outfile: path.join(seaDir, 'server.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  legalComments: 'none',
  logLevel: 'info',
})

const seaConfig = {
  main: 'server.cjs',
  output: 'sea-prep.blob',
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
}
writeFileSync(path.join(seaDir, 'sea-config.json'), `${JSON.stringify(seaConfig, null, 2)}\n`)
run(process.execPath, ['--experimental-sea-config', 'sea-config.json'], seaDir)

const triple = hostTriple()
const exeName = `tinybots-server-${triple}${process.platform === 'win32' ? '.exe' : ''}`
const exePath = path.join(binaries, exeName)
copyFileSync(process.execPath, exePath)
chmodSync(exePath, 0o755)
const postject = path.join(path.dirname(require.resolve('postject/package.json')), 'dist', 'cli.js')
run(process.execPath, [
  postject,
  exePath,
  'NODE_SEA_BLOB',
  path.join(seaDir, 'sea-prep.blob'),
  '--sentinel-fuse',
  FUSE,
  '--overwrite',
], root)

const [pkg, filename] = addon()
const addonFile = path.join(path.dirname(require.resolve(`${pkg}/package.json`)), filename)
copyFileSync(addonFile, path.join(binaries, filename))
console.log(`sidecar ${exeName}`)
console.log(`keyring ${filename}`)

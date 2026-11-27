/**
 * FILE: scripts/start.mjs
 * НАЗНАЧЕНИЕ: npm start на Windows, macOS и Linux без shell.
 * Сначала типы и сервер (tsc -b), затем страница (vite build), затем процесс на 127.0.0.1.
 */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'package.json'))

const major = Number(process.versions.node.split('.')[0])
if (!Number.isFinite(major) || major < 20) {
  console.error(`Нужен Node.js 20 или новее, сейчас ${process.versions.node}`)
  process.exit(1)
}

function run(script, args, cwd) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    stdio: 'inherit',
  })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function binFromPackage(name, relativeBin) {
  const pkgJson = require.resolve(`${name}/package.json`)
  return path.join(path.dirname(pkgJson), relativeBin)
}

// У vite exports не отдают bin напрямую, поэтому идём от package.json.
const tsc = binFromPackage('typescript', 'bin/tsc')
const vite = binFromPackage('vite', 'bin/vite.js')

run(tsc, ['-b'], root)
run(vite, ['build'], path.join(root, 'apps', 'web'))
// --browser только аргументом: переменную окружения sidecar мог бы унаследовать.
run(path.join(root, 'apps', 'server', 'dist', 'main.js'), ['--browser'], root)

/**
 * FILE: scripts/run-gitleaks.mjs
 * НАЗНАЧЕНИЕ: скачать официальный бинарник gitleaks и прогнать репозиторий.
 * --staged (хук pre-commit) смотрит индекс, иначе — всё дерево и историю.
 * docs/ не исключается.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const VERSION = '8.30.1'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function assetName() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (process.platform === 'win32') {
    return `gitleaks_${VERSION}_windows_${arch}.zip`
  }
  if (process.platform === 'darwin') {
    return `gitleaks_${VERSION}_darwin_${arch}.tar.gz`
  }
  return `gitleaks_${VERSION}_linux_${arch}.tar.gz`
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error(`слишком много редиректов: ${url}`))
      return
    }
    const lib = url.startsWith('https:') ? 'node:https' : 'node:http'
    import(lib)
      .then(({ get }) => {
        const req = get(url, { headers: { 'User-Agent': 'tinybots-gitleaks' } }, (res) => {
          const code = res.statusCode ?? 0
          if (code >= 300 && code < 400 && res.headers.location) {
            res.resume()
            const next = new URL(res.headers.location, url).href
            download(next, dest, redirects + 1).then(resolve, reject)
            return
          }
          if (code !== 200) {
            res.resume()
            reject(new Error(`HTTP ${code} для ${url}`))
            return
          }
          const file = createWriteStream(dest)
          pipeline(res, file).then(resolve, reject)
        })
        req.on('error', reject)
      })
      .catch(reject)
  })
}

async function ensureBinary() {
  const dir = path.join(root, 'node_modules', '.cache', 'gitleaks', VERSION)
  mkdirSync(dir, { recursive: true })
  const binName = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks'
  const bin = path.join(dir, binName)
  if (existsSync(bin)) {
    return bin
  }
  const name = assetName()
  const archive = path.join(tmpdir(), name)
  const base = `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}`
  await download(`${base}/${name}`, archive)
  const checksumFile = path.join(dir, 'checksums.txt')
  await download(`${base}/gitleaks_${VERSION}_checksums.txt`, checksumFile)
  const expectedLine = readFileSync(checksumFile, 'utf8')
    .split(/\r?\n/)
    .find((line) => line.includes(name))
  const expected = expectedLine?.split(/\s+/)[0]
  const actual = createHash('sha256').update(readFileSync(archive)).digest('hex')
  if (!expected || expected.toLowerCase() !== actual) {
    throw new Error(`контрольная сумма ${name} не сошлась`)
  }
  const extracted = spawnSync('tar', ['-xf', archive, '-C', dir], { stdio: 'inherit' })
  if (extracted.status !== 0) {
    throw new Error('не удалось распаковать gitleaks (нужен tar)')
  }
  if (!existsSync(bin)) {
    throw new Error(`после распаковки нет ${binName}`)
  }
  if (process.platform !== 'win32') {
    chmodSync(bin, 0o755)
  }
  return bin
}

function run(bin, args) {
  const result = spawnSync(bin, args, { cwd: root, stdio: 'inherit' })
  if (result.error) {
    console.error(result.error.message)
    return 1
  }
  return result.status ?? 1
}

const bin = await ensureBinary()
const staged = process.argv.includes('--staged')
if (staged) {
  process.exit(run(bin, ['protect', '--staged', '--redact', '--no-banner']))
}

// История коммитов и текущие файлы. docs/ не исключаем.
const history = run(bin, ['detect', '--source', root, '--redact', '--no-banner'])
const files = run(bin, ['detect', '--no-git', '--source', root, '--redact', '--no-banner'])
process.exit(history !== 0 ? history : files)

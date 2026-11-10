// Restore omitted vendor captures from an installed matching Node runtime.
// This script does not fetch code, invoke a witness, commit, or push.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
const manifest = JSON.parse(fs.readFileSync(new URL('./EXPORT-OMISSIONS.json', import.meta.url), 'utf8'))
const root = path.resolve(process.argv[2] ?? process.cwd())
const checkOnly = process.argv.includes('--check-only')
const source = process.binding('natives')['internal/deps/undici/undici']
const hash = crypto.createHash('sha256').update(source).digest('hex')
if (hash !== manifest.sha256) throw new Error(`Node ${process.version} vendor hash does not match the frozen source. Use the matching runtime. Do not change recorded hashes.`)
let restored = 0
for (const relative of manifest.paths) {
  const target = path.resolve(root, relative)
  if (!target.startsWith(root + path.sep)) throw new Error('Manifest path escapes repository')
  if (fs.existsSync(target)) {
    const existing = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')
    if (existing !== hash) throw new Error(`Existing capture differs: ${relative}`)
  } else if (!checkOnly) {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, source, { flag: 'wx' })
    restored++
  }
}
console.log(JSON.stringify({ node: process.version, hash, expectedCopies: manifest.paths.length, restored, checkOnly }))

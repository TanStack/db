import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
const app = resolve(import.meta.dirname, '../../integrated-todo')
const require = createRequire(await realpath(join(app, 'node_modules/vite/package.json')))
const { build } = require('esbuild')
const dir = await mkdtemp(join(tmpdir(), 'endpoint-authority-ground-'))
try {
  const bundle = join(dir, 'ground.mjs')
  await build({ entryPoints: [join(import.meta.dirname, 'ground.ts')], bundle: true,
    platform: 'node', format: 'esm', tsconfig: join(app, 'tsconfig.json'),
    outfile: bundle, logLevel: 'silent' })
  process.stdout.write(execFileSync(process.execPath, [bundle], { encoding: 'utf8' }))
} finally { await rm(dir, { recursive: true, force: true }) }

import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const dir = fileURLToPath(new URL('.', import.meta.url))
const app = resolve(dir, '../../../../integrated-todo')
const require = createRequire(realpathSync(join(app, 'node_modules/vite/package.json')))
const { build } = require('esbuild')
const temporary = mkdtempSync(join(tmpdir(), 'endpoint-hostile-assay-'))
function run(args) {
  const output = execFileSync(process.execPath, args, { encoding: 'utf8' })
  process.stdout.write(output)
  return output
}
try {
  run([join(dir, 'compiler-cases.mjs')])
  run([join(dir, 'pg-order.mjs')])
  run(['--experimental-strip-types', join(dir, 'pg-postcommit.mjs')])
  const bundle = join(temporary, 'runtime-cases.mjs')
  await build({ entryPoints: [join(dir, 'runtime-cases.ts')], bundle: true, platform: 'node', format: 'esm',
    tsconfig: join(app, 'tsconfig.json'), outfile: bundle, logLevel: 'silent' })
  run([bundle, join(dir, 'runtime-report.json')])
  writeFileSync(join(dir, 'contracts.tap'), run(['--experimental-strip-types', '--test',
    join(app, 'tests/server-order.test.mjs'), join(app, 'tests/refresh.test.mjs')]))
} finally { rmSync(temporary, { recursive: true, force: true }) }

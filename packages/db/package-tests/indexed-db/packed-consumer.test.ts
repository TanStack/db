// @vitest-environment node
/** Published runtime smoke tests supplement portable-declarations.test.ts.
 * Actual tarballs and Node's ESM/CJS loaders judge export paths; a persisted
 * row survives cleanup and a new descriptor. This fixed integration lane does
 * not model Collection histories or claim every package-manager configuration.
 * e2e/indexed-db/packed-consumer.spec.ts runs the same consumer through a browser bundler.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, expect, it } from 'vitest'
import { consumerSource, createPackedConsumer } from './packed-consumer'

let consumer: ReturnType<typeof createPackedConsumer>
beforeAll(() => {
  consumer = createPackedConsumer()
  return consumer.cleanup
}, 120_000)
for (const format of ['esm', 'cjs']) {
  it(`persists and reopens rows through packed ${format} exports`, () => {
    const common = consumerSource
      .replace(
        "import * as adapter from '@tanstack/db'",
        "const adapter = require('@tanstack/db')",
      )
      .replace('export async function', 'async function')
    const source =
      format === 'esm'
        ? `import { IDBFactory } from 'fake-indexeddb'; import { run } from './consumer.mjs'; console.log(JSON.stringify(await run(new IDBFactory())))`
        : `const { IDBFactory } = require('fake-indexeddb'); ${common}; run(new IDBFactory()).then(result => console.log(JSON.stringify(result)))`
    const input = join(consumer.root, format === 'esm' ? 'run.mjs' : 'run.cjs')
    writeFileSync(input, source)
    const output = execFileSync(process.execPath, [input], {
      cwd: consumer.root,
      encoding: 'utf8',
    })
    expect(JSON.parse(output)).toEqual({
      rows: [{ id: 1, name: 'updated' }],
      exports: Array(4).fill('function'),
    })
  })
}

// A missing packed entry must fail through the consumer's actual resolver.
// This control would survive if workspace aliases silently rescued the import.
for (const format of ['import', 'require'] as const) {
  it(`rejects a missing packed ${format} entry`, () => {
    const path = join(consumer.root, 'node_modules/@tanstack/db/package.json')
    const original = readFileSync(path, 'utf8')
    const manifest = JSON.parse(original) as {
      exports: { '.': Record<typeof format, { default: string }> }
    }
    try {
      manifest.exports['.'][format].default = './dist/missing-entry.js'
      writeFileSync(path, JSON.stringify(manifest))
      const code =
        format === 'import'
          ? "await import('@tanstack/db')"
          : "require('@tanstack/db')"
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=' + (format === 'import' ? 'module' : 'commonjs'),
          '-e',
          code,
        ],
        { cwd: consumer.root, encoding: 'utf8' },
      )
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('missing-entry.js')
      expect(result.stderr).toContain('MODULE_NOT_FOUND')
    } finally {
      writeFileSync(path, original)
    }
  })
}

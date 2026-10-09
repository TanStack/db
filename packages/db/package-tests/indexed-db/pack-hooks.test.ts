// @vitest-environment node
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { packPackage } from './packed-consumer'

// The fixture consumes completed builds. Hooks must not rewrite either the
// installed source or the tarball's input. A real opt-in control proves each
// authored hook runs under this package manager when suppression is absent.
for (const hook of ['prepack', 'prepare', 'postpack']) {
  it(`packs built artifacts without running ${hook}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'pack-hook-contract-'))
    const directory = join(root, 'package')
    const archives = join(root, 'archives')
    mkdirSync(directory)
    mkdirSync(archives)
    const built = join(directory, 'built.js')
    const marker = join(directory, 'hook-ran')
    try {
      writeFileSync(built, 'export const value = 42')
      writeFileSync(
        join(directory, 'hook.cjs'),
        `
        const fs = require('node:fs')
        fs.writeFileSync('hook-ran', 'ran')
        fs.writeFileSync('built.js', 'rewritten by lifecycle hook')
      `,
      )
      writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify({
          name: 'pack-hook-contract',
          version: '1.0.0',
          files: ['built.js'],
          scripts: { [hook]: 'node hook.cjs' },
        }),
      )
      packPackage(directory, archives)
      expect(existsSync(marker), 'packing must not run lifecycle scripts').toBe(
        false,
      )
      expect(readFileSync(built, 'utf8')).toBe('export const value = 42')
      expect(existsSync(join(archives, 'pack-hook-contract-1.0.0.tgz'))).toBe(
        true,
      )
      execFileSync(
        'pnpm',
        [
          'pack',
          '--pack-destination',
          archives,
          '--config.ignore-scripts=false',
        ],
        { cwd: directory, stdio: 'pipe' },
      )
      expect(
        readFileSync(marker, 'utf8'),
        'enabled control reaches the hook',
      ).toBe('ran')
      expect(readFileSync(built, 'utf8')).toBe('rewritten by lifecycle hook')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}

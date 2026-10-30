// Ordinary package-command invocation controls with controlled recipients.
// These establish wiring, not real bundle erasure or Typedoc correctness.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import {
  withErrorDocsFixture,
  writeErrorDocsExample,
} from './generate-error-docs-fixture'
import type { ErrorDocsFixture } from './generate-error-docs-fixture'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), `../../..`)
const { scripts }: { scripts: Record<string, string> } = JSON.parse(
  readFileSync(join(repository, `package.json`), `utf8`),
)

function runPackageCommand(fixture: ErrorDocsFixture, name: string) {
  return spawnSync(`/bin/sh`, [`-c`, scripts[name]!], {
    cwd: fixture.root,
    encoding: `utf8`,
    timeout: 10_000,
    env: { ...process.env, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` },
  })
}

it(`runs the erasure recipient while the committed errors page is stale`, () => {
  withErrorDocsFixture((fixture) => {
    writeErrorDocsExample(fixture)
    writeFileSync(fixture.pagePath, `stale sentinel`)
    writeFileSync(
      join(fixture.root, `scripts/test-production-errors.mjs`),
      `import { writeFileSync } from 'node:fs'; writeFileSync('erasure-entered', 'yes')\n`,
    )
    const result = runPackageCommand(fixture, `test:production-errors`)
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(join(fixture.root, `erasure-entered`))).toBe(true)
    expect(readFileSync(fixture.pagePath, `utf8`)).toBe(`stale sentinel`)
  })
})

it(`generates the error page before the Typedoc recipient`, () => {
  withErrorDocsFixture((fixture) => {
    writeErrorDocsExample(fixture)
    writeFileSync(fixture.pagePath, `stale sentinel`)
    writeFileSync(
      join(fixture.root, `scripts/generate-docs.ts`),
      `
      import assert from 'node:assert/strict'
      import { readFileSync, writeFileSync } from 'node:fs'
      writeFileSync('typedoc-entered', 'yes')
      assert(readFileSync('docs/errors.md', 'utf8').includes('fixture class message'))
    `,
    )
    const result = runPackageCommand(fixture, `generate-docs`)
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(join(fixture.root, `typedoc-entered`))).toBe(true)
    const check = fixture.run(`--check`)
    expect(check.error).toBeUndefined()
    expect(check.status, check.stderr).toBe(0)
  })
})

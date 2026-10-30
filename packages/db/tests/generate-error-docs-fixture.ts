// Copies the actual generator and catalog into a disposable repository. This
// driver records CLI behavior; it supplies no catalog/rendering judgment.
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SpawnSyncReturns } from 'node:child_process'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), `../../..`)
const fixtureNames = [
  `error-codes.json`,
  `error-messages.json`,
  `error-site-messages.json`,
] as const

export interface ErrorDocsFixture {
  root: string
  pagePath: string
  fixturesDirectory: string
  run: (...args: Array<string>) => SpawnSyncReturns<string>
}

export function withErrorDocsFixture<T>(
  body: (fixture: ErrorDocsFixture) => T,
): T {
  const root = mkdtempSync(join(tmpdir(), `tanstack-error-docs-`))
  let outcome: { ok: true; value: T } | { ok: false; error: unknown }
  try {
    const script = join(root, `scripts/generate-error-docs.mjs`)
    const fixturesDirectory = join(root, `packages/db/tests/fixtures`)
    mkdirSync(dirname(script), { recursive: true })
    mkdirSync(fixturesDirectory, { recursive: true })
    mkdirSync(join(root, `docs`))
    copyFileSync(join(repository, `scripts/generate-error-docs.mjs`), script)
    for (const name of fixtureNames)
      copyFileSync(
        join(repository, `packages/db/tests/fixtures`, name),
        join(fixturesDirectory, name),
      )
    const value = body({
      root,
      pagePath: join(root, `docs/errors.md`),
      fixturesDirectory,
      run: (...args) =>
        spawnSync(process.execPath, [script, ...args], {
          cwd: root,
          encoding: `utf8`,
          timeout: 10_000,
          maxBuffer: 4 * 1024 * 1024,
        }),
    })
    outcome = { ok: true, value }
  } catch (error) {
    outcome = { ok: false, error }
  }
  try {
    rmSync(root, { recursive: true, force: true })
  } catch (cleanup) {
    throw outcome.ok
      ? cleanup
      : new AggregateError(
          [outcome.error, cleanup],
          `Error docs control and cleanup failed`,
          { cause: outcome.error },
        )
  }
  if (!outcome.ok) throw outcome.error
  return outcome.value
}

// Small ordinary-control inputs. The source oracle keeps the copied full
// frozen catalog and does not call this example-fixture writer.
export function writeErrorDocsExample(
  fixture: ErrorDocsFixture,
  message = `fixture class message`,
): void {
  for (const [name, value] of Object.entries({
    'error-codes.json': { FixtureError: 7 },
    'error-messages.json': { FixtureError: [message] },
    'error-site-messages.json': {
      8: { file: `fixture.ts`, template: `fixture failure \${id}` },
      9: { file: `warning.ts`, template: `fixture warning`, kind: `warning` },
    },
  }))
    writeFileSync(join(fixture.fixturesDirectory, name), JSON.stringify(value))
}

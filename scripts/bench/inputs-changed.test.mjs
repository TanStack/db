import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeBenchmarkInput } from './inputs-changed.mjs'

test('package version bumps preserve benchmark inputs', () => {
  const manifest = {
    name: '@tanstack/db',
    version: '1.0.0-rc.1.3',
    dependencies: { helper: '1.0.0' },
  }
  assert.equal(
    normalizeBenchmarkInput(
      'packages/db/package.json',
      JSON.stringify(manifest),
    ),
    normalizeBenchmarkInput(
      'packages/db/package.json',
      JSON.stringify({ ...manifest, version: '1.0.0-rc.1.4' }),
    ),
  )
  assert.notEqual(
    normalizeBenchmarkInput(
      'packages/db/package.json',
      JSON.stringify(manifest),
    ),
    normalizeBenchmarkInput(
      'packages/db/package.json',
      JSON.stringify({ ...manifest, dependencies: { helper: '2.0.0' } }),
    ),
  )
})

test('only linked workspace specifiers are ignored in the lockfile', () => {
  const lock = (specifier, version) =>
    `      '@tanstack/db':\n        specifier: ${specifier}\n        version: ${version}\n`
  const normalize = (text) => normalizeBenchmarkInput('pnpm-lock.yaml', text)
  assert.equal(
    normalize(lock('^1.0.0-rc.1.3', 'link:../../db')),
    normalize(lock('^1.0.0-rc.1.4', 'link:../../db')),
  )
  assert.notEqual(
    normalize(lock('^1.0.0', '1.0.0')),
    normalize(lock('^2.0.0', '1.0.0')),
  )
  assert.notEqual(
    normalize(lock('^1.0.0', '1.0.0')),
    normalize(lock('^1.0.0', '1.0.1')),
  )
  assert.notEqual(
    normalize(lock('*', 'link:../../db')),
    normalize(lock('*', 'link:../../other')),
  )
  assert.notEqual(
    normalize(lock('*', 'link:../../db')),
    normalize(lock('*', '1.0.0')),
  )
})

test('changelog edits are ignored while code, harness and missing inputs differ', () => {
  assert.equal(
    normalizeBenchmarkInput('packages/db/CHANGELOG.md', 'old'),
    normalizeBenchmarkInput('packages/db/CHANGELOG.md', 'new'),
  )
  for (const path of [
    'packages/db/src/index.ts',
    'scripts/bench/incremental-update.ts',
    'pnpm-workspace.yaml',
    '.github/workflows/benchmark.yml',
  ]) {
    assert.notEqual(
      normalizeBenchmarkInput(path, 'old'),
      normalizeBenchmarkInput(path, 'new'),
    )
    assert.notEqual(
      normalizeBenchmarkInput(path, null),
      normalizeBenchmarkInput(path, ''),
    )
  }
})

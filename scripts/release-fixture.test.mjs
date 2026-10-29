// Ordinary harness calibration: malformed commands cannot escape the registry
// fixture or be recorded under a misleading first-occurring option value.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  preparePublishReceiver,
  withReleaseWorkspace,
} from './release-fixture.js'
import { withFiniteComparison } from './finite-comparison.js'

for (const [label, tool, args] of [
  [
    'duplicate tag',
    'pnpm',
    [
      'publish',
      '--json',
      '--access',
      'public',
      '--tag',
      'rc',
      '--no-git-checks',
      '--tag',
      'latest',
    ],
  ],
  [
    'foreign publish registry',
    'pnpm',
    [
      'publish',
      '--json',
      '--access',
      'public',
      '--tag',
      'rc',
      '--no-git-checks',
      '--registry=https://example.invalid',
    ],
  ],
  [
    'foreign info registry',
    'npm',
    ['info', '@tanstack/db', '--registry=https://example.invalid', '--json'],
  ],
  ['unknown command', 'pnpm', ['install']],
])
  test(`release command fixture rejects ${label}`, async () => {
    await withReleaseWorkspace(async ({ root }) => {
      const receiver = preparePublishReceiver(root, {
        candidate: '1.0.0-rc.1.1',
        registry: 'stable-history',
        failure: 'none',
      })
      const before = receiver.readRegistry()
      const result = receiver.invokeCommand(tool, args)
      assert.equal(result.error, undefined)
      assert.equal(result.status, 91)
      assert.match(result.stderr, /unrecognized/)
      assert.deepEqual(receiver.readRegistry(), before)
      assert.deepEqual(receiver.readRequests(), [])
      assert.equal(existsSync(join(root, 'registry.json.lock')), false)
    })
  })

for (const stage of [
  'setup',
  'success',
  'mismatch',
  'cleanup',
  'witness',
  'undefined',
  'undefined-witness',
])
  test(`finite comparison preserves ${stage} outcome`, async () => {
    const primary = stage.startsWith('undefined') ? undefined : new Error(stage)
    const writerError = new Error('writer')
    const records = []
    const result = withFiniteComparison(
      async (comparison) => {
        if (stage === 'setup') throw primary
        comparison()
        if (stage === 'cleanup') {
          try {
            return 'compared'
          } finally {
            throw primary
          }
        }
        if (stage !== 'success') throw primary
      },
      (record) => {
        records.push(record)
        if (stage === 'witness' || stage === 'undefined-witness')
          throw writerError
      },
    )
    if (stage === 'success') await result
    else
      await assert.rejects(result, (error) => {
        if (stage === 'witness' || stage === 'undefined-witness') {
          assert.equal(error.cause, primary)
          assert.deepEqual(error.errors, [primary, writerError])
        } else assert.equal(error, primary)
        return true
      })
    assert.deepEqual(
      records,
      stage === 'setup' ? [] : [{ failed: stage !== 'success' }],
    )
  })

for (const stage of ['success', 'mismatch', 'undefined'])
  test(`workspace cleanup preserves ${stage} outcome`, async () => {
    const primary = stage === 'undefined' ? undefined : new Error(stage)
    const cleanup = new Error('cleanup')
    let root
    await assert.rejects(
      withReleaseWorkspace(
        async (fixture) => {
          root = fixture.root
          if (stage !== 'success') throw primary
        },
        false,
        (path, options) => {
          rmSync(path, options)
          throw cleanup
        },
      ),
      (error) => {
        if (stage === 'success') assert.equal(error, cleanup)
        else {
          assert.equal(error.cause, primary)
          assert.deepEqual(error.errors, [primary, cleanup])
        }
        return true
      },
    )
    assert.equal(existsSync(root), false)
  })

for (const tag of ['rc', 'latest'])
  test(`release command fixture forwards explicit ${tag} tag`, async () => {
    await withReleaseWorkspace(async ({ root }) => {
      const receiver = preparePublishReceiver(root, {
        candidate: '1.0.0-rc.1.1',
        registry: 'stable-history',
        failure: 'none',
      })
      // Changesets forbids an explicit tag while pre mode is visible. A future
      // wrapper can legitimately hide pre mode and supply the phase's tag.
      unlinkSync(join(root, '.changeset', 'pre.json'))
      const result = receiver.invokeCommand(
        'pnpm',
        ['exec', 'changeset', 'publish', '--tag', tag],
        'root',
      )
      assert.equal(result.error, undefined)
      assert.equal(result.status, 0, result.stderr)
      const publishes = receiver
        .readRequests()
        .filter((entry) => entry.type === 'publish')
      assert.equal(publishes.length, 4)
      assert(publishes.every((entry) => entry.success && entry.tag === tag))
    })
  })

for (const [property, path] of [
  ['scripts.release-version', '1:2'],
  ['scripts.release-version', '72'],
  ['scripts.release-seed-failure', '14'],
])
  test(`finite release replay rejects invalid selector ${property}/${path}`, () => {
    const root = fileURLToPath(new URL('../', import.meta.url))
    const result = spawnSync(
      process.execPath,
      [
        join(root, 'node_modules', 'vitest', 'vitest.mjs'),
        'run',
        '--config',
        'scripts/oracle-scripts.vitest.config.mjs',
        'scripts/release-history-oracle.property.test.js',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          TANSTACK_DB_ORACLE_PROPERTY: property,
          TANSTACK_DB_ORACLE_SEED: '1',
          TANSTACK_DB_ORACLE_PATH: path,
        },
      },
    )
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.match(
      result.stdout + result.stderr,
      /Finite release replay PATH must be one existing case index/,
    )
  })

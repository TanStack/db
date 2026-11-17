// Campaign runner calibration, shrinking and replay support. These tests keep
// their original raw fast-check controls; product histories register separately
// with the cross-tab oracle and continue to use its independent model/checker.
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fc } from '@fast-check/vitest'
import { expect, it, vi } from 'vitest'
import {
  oracleFixedSeed,
  oracleRoute,
  oracleRouteOf,
} from '../oracle-config.js'
import { runCampaign } from './campaign'
import { assertReplay, assertSnapshot } from './cross-tab-oracle'

it('replays a generated intentional mismatch at its original law and checkpoint', () => {
  oracleRoute(`calibration`)
  const property = fc.property(fc.integer({ min: 1, max: 20 }), (value) =>
    assertSnapshot(
      [{ id: value, name: 'wrong' }],
      [{ id: value, name: 'right' }],
      'replay calibration',
    ),
  )
  const original = fc.check(property, { seed: 1179 })
  expect(original.failed).toBe(true)
  const replay = fc.check(property, {
    seed: original.seed,
    path: original.counterexamplePath ?? undefined,
    endOnFailure: true,
  })
  assertReplay({
    inputReconstructed:
      JSON.stringify(original.counterexample) ===
      JSON.stringify(replay.counterexample),
    premiseReached: replay.numRuns > 0,
    sameFailure:
      replay.failed &&
      String(String(replay.errorInstance)).includes(
        'public rows at replay calibration',
      ),
  })
})

it('replays only the selected history after the original failure is repaired', async () => {
  // This shrink path has a later sibling. fast-check check() continues into
  // that sibling when the selected counterexample passes, despite numRuns: 1.
  const arbitrary = fc.integer({ min: 0, max: 100 })
  const parameters = oracleFixedSeed(11792027, { numRuns: 30 })
  oracleRoute(oracleRouteOf(parameters))
  const original = fc.check(
    fc.property(arbitrary, (value) => value < 10),
    parameters,
  )
  expect(original.counterexample).toEqual([10])
  expect(original.counterexamplePath).toBe('0:1:0:0:1')
  const observed: Array<number> = []
  await runCampaign(
    'repaired-replay-control',
    arbitrary,
    (value) => {
      observed.push(value)
      return Promise.resolve()
    },
    { runs: 30, seed: original.seed, path: original.counterexamplePath! },
  )
  expect(observed).toEqual([10])
})

it('preserves campaign outcomes and reports without revision metadata', async () => {
  oracleRoute(`fixed seed`)
  // Revision lookup is diagnostic. It cannot turn passing histories red or
  // replace the original failed law. Both results must retain their reports.
  const directory = await mkdtemp(join(tmpdir(), 'indexeddb-no-git-'))
  vi.stubEnv('GIT_DIR', directory)
  try {
    for (const fails of [false, true]) {
      const name = `revision-control-${crypto.randomUUID()}`
      const outcome = runCampaign(
        name,
        fc.constant(0),
        () => {
          if (fails)
            assertSnapshot(
              [{ id: 0, name: 'wrong' }],
              [],
              'revision calibration',
            )
          return Promise.resolve()
        },
        { runs: 1, seed: 1179 },
      )
      if (fails)
        await expect(outcome).rejects.toThrow(
          'public rows at revision calibration',
        )
      else await outcome
      const reports = (await readdir('test-results/oracles')).filter((file) =>
        file.startsWith(name),
      )
      expect(reports).toHaveLength(1)
      const report: unknown = JSON.parse(
        await readFile(join('test-results/oracles', reports[0]!), 'utf8'),
      )
      expect(report).toMatchObject({
        head: 'unknown',
        headError: expect.any(String),
        failed: fails,
      })
      if (fails)
        expect(report).toMatchObject({
          original: { law: 'public rows', checkpoint: 'revision calibration' },
          reproduction: {
            inputReconstructed: true,
            premiseReached: true,
            sameFailure: true,
          },
        })
    }
  } finally {
    vi.unstubAllEnvs()
    await rm(directory, { recursive: true, force: true })
  }
})

// Preserve the metadata corruption shrinking and direct-replay control.
import { fc } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { oracleRoute } from './oracle-config.js'
import {
  mutateDriverMetadata,
  runPublicationHistory,
} from './collection-metadata-publication-oracle.js'
import type { PublicationRound } from './collection-metadata-publication-oracle.js'

it(`shrinks and replays a driver-only metadata corruption`, async () => {
  oracleRoute(`calibration`)
  const roundsFor = (nested: number): Array<PublicationRound> => [
    {
      key: 1,
      delta: 1,
      metadata: [{ key: 1, type: `set`, value: { nested } }],
      outcome: `commit`,
    },
  ]
  const property = fc.asyncProperty(fc.integer(), (nested) =>
    runPublicationHistory(roundsFor(nested), mutateDriverMetadata),
  )
  const failure = await fc.check(property, { seed: 505101, numRuns: 10 })
  expect(failure.failed).toBe(true)
  expect(failure.errorInstance).toMatchObject({ name: `AssertionError` })
  if (failure.counterexample === null) {
    throw new Error(`Missing metadata corruption replay`)
  }
  const replay = await fc.check(property, {
    seed: failure.seed,
    path: failure.counterexamplePath,
    endOnFailure: true,
  })
  expect(replay.failed).toBe(true)
  expect(replay.counterexample).toEqual(failure.counterexample)
  expect(replay.errorInstance).toMatchObject({ name: `AssertionError` })
  await runPublicationHistory(roundsFor(failure.counterexample[0]))
})

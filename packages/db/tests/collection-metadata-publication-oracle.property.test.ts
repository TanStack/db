import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { oracleProperty, oracleRoute } from './oracle-config.js'
import { declareOracle } from './oracle-declaration.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from './oracle-assertion-adapter.js'
import {
  applyRound,
  expectMetadataCancellationOwnership,
  metadataCancellationArbitrary,
  mutateDriverMetadata,
  publicationRoundArbitrary,
  runPublicationHistory,
  unchangedMetadata,
} from './collection-metadata-publication-oracle.js'
import type {
  MetadataDriver,
  MetadataEntryState,
  MetadataOperation,
  PublicationRound,
} from './collection-metadata-publication-oracle.js'

// The named companion states the metadata publication law, independent row
// and metadata models, bounded grammar, production path and comparison cuts.
const metadataOnlyProperty = `collection-publication.metadata-only`
const metadataCancellationProperty = `collection-publication.metadata-cancellation`

it(`detects driver mutation of committed metadata without rewriting its authority`, async () => {
  oracleRoute(`calibration`)
  const rounds: Array<PublicationRound> = [
    {
      key: 1,
      delta: 1,
      metadata: [{ key: 1, type: `set`, value: { nested: 1 } }],
      outcome: `commit`,
    },
  ]
  const original = structuredClone(rounds)
  await expect(
    runPublicationHistory(rounds, mutateDriverMetadata),
  ).rejects.toMatchObject({ name: `AssertionError` })
  expect(rounds).toEqual(original)
  await runPublicationHistory(rounds)
  await runPublicationHistory(
    rounds.map((round) => ({ ...round, outcome: `abort` })),
    mutateDriverMetadata,
  )
})

it(`rejects a torn callback-time metadata cut even when settled metadata is correct`, async () => {
  oracleRoute(`calibration`)
  const rounds: Array<PublicationRound> = [
    {
      key: 1,
      delta: 1,
      metadata: [{ key: 1, type: `set`, value: false }],
      outcome: `commit`,
    },
  ]
  await expect(
    runPublicationHistory(rounds, unchangedMetadata, (cuts) => {
      cuts[1]!.metadata.set(1, undefined)
    }),
  ).rejects.toMatchObject({ name: `AssertionError` })
  await runPublicationHistory(rounds)
})

it.each(
  ([`initial`, `retained`] as const).flatMap((placement) =>
    [true, false].map((canceledFirst) => ({ placement, canceledFirst })),
  ),
)(
  `detects $placement metadata mutation with canceledFirst=$canceledFirst`,
  async ({ placement, canceledFirst }) => {
    oracleRoute(`calibration`)
    const initial: Array<MetadataEntryState> =
      placement === `initial`
        ? [
            { present: true, value: { nested: 1 } },
            { present: false },
            { present: false },
          ]
        : [{ present: false }, { present: false }, { present: false }]
    const retained: MetadataOperation = {
      type: `set`,
      value: placement === `retained` ? { nested: 2 } : false,
    }
    const original = structuredClone({ initial, retained })
    const run = (driver: MetadataDriver) =>
      expectMetadataCancellationOwnership(
        [1],
        [2],
        { type: `delete` },
        retained,
        canceledFirst,
        initial,
        driver,
      )
    await expect(run(mutateDriverMetadata)).rejects.toMatchObject({
      name: `AssertionError`,
    })
    expect({ initial, retained }).toEqual(original)
    await run(unchangedMetadata)
  },
)

it(`publishes one event per key when metadata-only sync retires optimistic work`, async () => {
  oracleRoute(`fixed history`)
  await runPublicationHistory([
    {
      key: 1,
      delta: 1,
      metadata: [{ key: 1, type: `set`, value: false }],
      outcome: `commit`,
    },
    {
      key: 1,
      delta: 1,
      metadata: [{ key: 1, type: `delete` }],
      outcome: `commit`,
    },
  ])
})

it(`applies the last committed metadata write and discards aborted writes`, async () => {
  oracleRoute(`fixed history`)
  await runPublicationHistory([
    {
      key: 1,
      delta: 2,
      metadata: [
        { key: 1, type: `set`, value: `superseded` },
        { key: 0, type: `set`, value: Number.NaN },
        { key: 1, type: `set`, value: false },
      ],
      outcome: `commit`,
    },
    {
      key: 1,
      delta: -1,
      metadata: [
        { key: 1, type: `delete` },
        { key: 2, type: `set`, value: `canceled` },
      ],
      outcome: `abort`,
    },
  ])
})

it(`releases only canceled metadata keys while another sync remains pending`, async () => {
  oracleRoute(`fixed history`)
  await expectMetadataCancellationOwnership(
    [0, 1],
    [1, 2],
    { type: `delete` },
    { type: `set`, value: false },
    true,
    [
      { present: true, value: undefined },
      { present: true, value: false },
      { present: true, value: null },
    ],
  )
})

it(`does not apply canceled metadata to an absent base key`, async () => {
  oracleRoute(`fixed history`)
  await expectMetadataCancellationOwnership(
    [0, 1],
    [1, 2],
    { type: `set`, value: `canceled` },
    { type: `set`, value: `retained` },
    true,
    [{ present: false }, { present: false }, { present: false }],
  )
})

it(`settles an older metadata owner after canceling the newer owner`, async () => {
  oracleRoute(`fixed history`)
  await expectMetadataCancellationOwnership(
    [0, 1],
    [1, 2],
    { type: `delete` },
    { type: `set`, value: `retained` },
    false,
    [
      { present: true, value: undefined },
      { present: false },
      { present: true, value: false },
    ],
  )
})

const publicationHistoryArbitrary = fc.array(publicationRoundArbitrary, {
  minLength: 1,
  maxLength: 8,
})

type MetadataCancellationHistory =
  typeof metadataCancellationArbitrary extends fc.Arbitrary<infer THistory>
    ? THistory
    : never

const runCancellationHistory = ({
  canceledKeys,
  retainedKeys,
  canceledOperation,
  retainedOperation,
  canceledFirst,
  initialMetadata,
}: MetadataCancellationHistory) =>
  expectMetadataCancellationOwnership(
    canceledKeys,
    retainedKeys,
    canceledOperation,
    retainedOperation,
    canceledFirst,
    initialMetadata,
  )

// What this oracle owns: the gap report judges the metadata-only sync
// transaction and its metadata writes in sync.ts, and the publication of
// row and metadata changes to subscribers in state.ts, by this file's tests.
declareOracle({
  owns: [`src/collection/sync.ts`, `src/collection/state.ts`],
  check: [applyRound, expectMetadataCancellationOwnership],
})

describe(`generated metadata publication histories`, () => {
  oracleProperty({
    id: metadataOnlyProperty,
    law: {
      statement: `Metadata-only optimistic settlement publishes one coherent keyed row and metadata world.`,
      authority: `The established Collection sync metadata and change subscription contracts stated above`,
      limits: `Three existing numeric row keys, one to eight rounds and the existing structured metadata grammar; absent source rows, Collection metadata and other provider hosts remain outside this driver.`,
    },
    histories: {
      arbitrary: publicationHistoryArbitrary,
      runs: 50,
      fixedSeeds: [1_805_001],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(metadataOnlyProperty, plan, observe, () =>
        runPublicationHistory(plan.history),
      ),
    check: forwardAssertionJudgment,
  })
  oracleProperty({
    id: metadataCancellationProperty,
    law: {
      statement: `Canceling a pending metadata transaction releases only its keys and preserves the other pending transaction's metadata.`,
      authority: `The established Collection sync metadata and change subscription contracts stated above`,
      limits: `Three numeric row keys and two queued metadata owners with the existing structured metadata grammar; absent source rows, Collection metadata and other provider hosts remain outside this driver.`,
    },
    histories: {
      arbitrary: metadataCancellationArbitrary,
      runs: 50,
      fixedSeeds: [1_805_002],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(metadataCancellationProperty, plan, observe, () =>
        runCancellationHistory(plan.history),
      ),
    check: forwardAssertionJudgment,
  })
})

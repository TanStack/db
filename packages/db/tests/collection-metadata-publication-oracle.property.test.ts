import { fc } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { oracleProperty } from './oracle-config.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
  rejectAt,
} from './oracle-assertion-adapter.js'
import {
  expectMetadataCancellationOwnership,
  metadataCancellationArbitrary,
  mutateDriverMetadata,
  publicationRoundArbitrary,
  runPublicationHistory,
  unchangedMetadata,
} from './collection-metadata-publication-oracle.js'
import type { PublicationRound } from './collection-metadata-publication-oracle.js'

// The named companion states the metadata publication law, independent row
// and metadata models, bounded grammar, production path and comparison cuts.
const metadataOnlyProperty = `collection-publication.metadata-only`
const metadataCancellationProperty = `collection-publication.metadata-cancellation`

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

// A calibration's own precondition, such as an input the mutant must not
// rewrite, is not the check rejecting the wrong answer. A failure here loses
// any comparison marking, so it fails the calibration instead of passing it.
async function calibrationPrecondition(
  name: string,
  run: () => void | Promise<void>,
): Promise<void> {
  try {
    await run()
  } catch (error) {
    throw new Error(
      `${name}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
  }
}

// Exactly the original calibrations' matcher: only an AssertionError counts
// as the check rejecting the wrong answer. A run that resolves records a
// pass, so the calibration finds no rejecting history and fails.
async function rejectsWithAssertion(
  checkpoint: string,
  run: () => Promise<void>,
  afterRejection: () => void | Promise<void>,
): Promise<void> {
  try {
    await run()
  } catch (error) {
    if (error instanceof Error && error.name === `AssertionError`) {
      await calibrationPrecondition(checkpoint, afterRejection)
      rejectAt(checkpoint, error)
    }
    throw new Error(
      `${checkpoint}: expected an AssertionError, got ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
  }
}

// The metadata-only rounds below are named regressions and the histories of
// the two driver calibrations. publicationRoundArbitrary builds its rounds
// with `.map`, so it cannot take them back as fixed histories; they run as one
// enumerated property through the same driver and comparison.
const metadataOnlyFixedProperty = `collection-publication.metadata-only-fixed`
const driverMutationRounds = `one committed nested metadata write`
const tornCutRounds = `one committed false metadata write`
const metadataOnlyFixedHistories: Array<{
  name: string
  rounds: Array<PublicationRound>
}> = [
  {
    name: driverMutationRounds,
    rounds: [
      {
        key: 1,
        delta: 1,
        metadata: [{ key: 1, type: `set`, value: { nested: 1 } }],
        outcome: `commit`,
      },
    ],
  },
  {
    name: tornCutRounds,
    rounds: [
      {
        key: 1,
        delta: 1,
        metadata: [{ key: 1, type: `set`, value: false }],
        outcome: `commit`,
      },
    ],
  },
  {
    name: `publishes one event per key when metadata-only sync retires optimistic work`,
    rounds: [
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
    ],
  },
  {
    name: `applies the last committed metadata write and discards aborted writes`,
    rounds: [
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
    ],
  },
]
type MetadataOnlyFixedPlan = {
  history: (typeof metadataOnlyFixedHistories)[number]
}
const runMetadataOnlyFixed = (
  plan: MetadataOnlyFixedPlan,
  observe: (checkpoint: string, value: unknown) => void,
) =>
  recordAssertionJudgment(metadataOnlyFixedProperty, plan, observe, () =>
    runPublicationHistory(plan.history.rounds),
  )
// A calibration applies its wrong answer only to the history that its
// original test named; every other candidate runs the unchanged comparison,
// passes, and is passed over.
const metadataOnlyCalibration = (
  name: string,
  target: string,
  mutant: (rounds: Array<PublicationRound>) => Promise<void>,
) => ({
  name,
  law: metadataOnlyFixedProperty,
  driver: (
    plan: MetadataOnlyFixedPlan,
    observe: (checkpoint: string, value: unknown) => void,
  ) =>
    plan.history.name === target
      ? recordAssertionJudgment(metadataOnlyFixedProperty, plan, observe, () =>
          mutant(plan.history.rounds),
        )
      : runMetadataOnlyFixed(plan, observe),
})

// The cancellation histories: named regressions and the histories of the
// four placement calibrations, in the generated cancellation grammar's shape.
const metadataCancellationFixedProperty = `collection-publication.metadata-cancellation-fixed`
const placementHistoryName = (
  placement: `initial` | `retained`,
  canceledFirst: boolean,
) => `${placement} metadata with canceledFirst=${canceledFirst}`
const placementHistories = ([`initial`, `retained`] as const).flatMap(
  (placement) =>
    [true, false].map((canceledFirst): MetadataCancellationFixedHistory => ({
      name: placementHistoryName(placement, canceledFirst),
      canceledKeys: [1],
      retainedKeys: [2],
      canceledOperation: { type: `delete` },
      retainedOperation: {
        type: `set`,
        value: placement === `retained` ? { nested: 2 } : false,
      },
      canceledFirst,
      initialMetadata:
        placement === `initial`
          ? [
              { present: true, value: { nested: 1 } },
              { present: false },
              { present: false },
            ]
          : [{ present: false }, { present: false }, { present: false }],
    })),
)
type MetadataCancellationFixedHistory = MetadataCancellationHistory & {
  name: string
}
const metadataCancellationFixedHistories: Array<MetadataCancellationFixedHistory> =
  [
    ...placementHistories,
    {
      name: `releases only canceled metadata keys while another sync remains pending`,
      canceledKeys: [0, 1],
      retainedKeys: [1, 2],
      canceledOperation: { type: `delete` },
      retainedOperation: { type: `set`, value: false },
      canceledFirst: true,
      initialMetadata: [
        { present: true, value: undefined },
        { present: true, value: false },
        { present: true, value: null },
      ],
    },
    {
      name: `does not apply canceled metadata to an absent base key`,
      canceledKeys: [0, 1],
      retainedKeys: [1, 2],
      canceledOperation: { type: `set`, value: `canceled` },
      retainedOperation: { type: `set`, value: `retained` },
      canceledFirst: true,
      initialMetadata: [
        { present: false },
        { present: false },
        { present: false },
      ],
    },
    {
      name: `settles an older metadata owner after canceling the newer owner`,
      canceledKeys: [0, 1],
      retainedKeys: [1, 2],
      canceledOperation: { type: `delete` },
      retainedOperation: { type: `set`, value: `retained` },
      canceledFirst: false,
      initialMetadata: [
        { present: true, value: undefined },
        { present: false },
        { present: true, value: false },
      ],
    },
  ]
type MetadataCancellationFixedPlan = {
  history: MetadataCancellationFixedHistory
}
const runCancellationFixed = (
  plan: MetadataCancellationFixedPlan,
  observe: (checkpoint: string, value: unknown) => void,
) =>
  recordAssertionJudgment(
    metadataCancellationFixedProperty,
    plan,
    observe,
    () => runCancellationHistory(plan.history),
  )

describe(`generated metadata publication histories`, () => {
  oracleProperty({
    id: metadataOnlyProperty,
    law: {
      statement: `Metadata-only optimistic settlement publishes one coherent keyed row and metadata world.`,
      authority: `The established Collection sync metadata and change subscription contracts stated above`,
      limits: `Three existing numeric row keys, one to eight rounds and the existing structured metadata grammar; absent source rows, Collection metadata and other provider hosts remain outside this driver.`,
    },
    // What this oracle owns: the gap report judges the metadata-only sync
    // transaction and its metadata writes in sync.ts, and the publication of
    // row and metadata changes to subscribers in state.ts, by this file's tests.
    owns: [`src/collection/sync.ts`, `src/collection/state.ts`],
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
    owns: [`src/collection/sync.ts`, `src/collection/state.ts`],
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
  oracleProperty({
    id: metadataOnlyFixedProperty,
    law: {
      statement: `Metadata-only optimistic settlement publishes one coherent keyed row and metadata world.`,
      authority: `The established Collection sync metadata and change subscription contracts stated above`,
      limits: `Named metadata-only histories that the generated round grammar cannot take back; each is replayed through the same driver and comparison.`,
    },
    owns: [`src/collection/sync.ts`, `src/collection/state.ts`],
    histories: metadataOnlyFixedHistories,
    label: ({ name }) => name,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: runMetadataOnlyFixed,
    check: forwardAssertionJudgment,
    calibrations: [
      metadataOnlyCalibration(
        `detects driver mutation of committed metadata without rewriting its authority`,
        driverMutationRounds,
        async (rounds) => {
          const original = structuredClone(rounds)
          await rejectsWithAssertion(
            `driver metadata mutation`,
            () => runPublicationHistory(rounds, mutateDriverMetadata),
            async () => {
              expect(rounds).toEqual(original)
              await runPublicationHistory(
                rounds.map((round) => ({ ...round, outcome: `abort` })),
                mutateDriverMetadata,
              )
            },
          )
        },
      ),
      metadataOnlyCalibration(
        `rejects a torn callback-time metadata cut even when settled metadata is correct`,
        tornCutRounds,
        (rounds) =>
          rejectsWithAssertion(
            `torn callback-time metadata cut`,
            () =>
              runPublicationHistory(rounds, unchangedMetadata, (cuts) => {
                cuts[1]!.metadata.set(1, undefined)
              }),
            () => {},
          ),
      ),
    ],
  })
  oracleProperty({
    id: metadataCancellationFixedProperty,
    law: {
      statement: `Canceling a pending metadata transaction releases only its keys and preserves the other pending transaction's metadata.`,
      authority: `The established Collection sync metadata and change subscription contracts stated above`,
      limits: `Named cancellation histories that the generated cancellation grammar cannot take back; each is replayed through the same driver and comparison.`,
    },
    owns: [`src/collection/sync.ts`, `src/collection/state.ts`],
    histories: metadataCancellationFixedHistories,
    label: ({ name }) => name,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: runCancellationFixed,
    check: forwardAssertionJudgment,
    calibrations: ([`initial`, `retained`] as const).flatMap((placement) =>
      [true, false].map((canceledFirst) => {
        const target = placementHistoryName(placement, canceledFirst)
        return {
          name: `detects ${placement} metadata mutation with canceledFirst=${canceledFirst}`,
          law: metadataCancellationFixedProperty,
          driver: (
            plan: MetadataCancellationFixedPlan,
            observe: (checkpoint: string, value: unknown) => void,
          ) =>
            plan.history.name === target
              ? recordAssertionJudgment(
                  metadataCancellationFixedProperty,
                  plan,
                  observe,
                  async () => {
                    const {
                      canceledKeys,
                      retainedKeys,
                      canceledOperation,
                      retainedOperation,
                      initialMetadata,
                    } = plan.history
                    const original = structuredClone({
                      initial: initialMetadata,
                      retained: retainedOperation,
                    })
                    await rejectsWithAssertion(
                      `${placement} metadata mutation`,
                      () =>
                        expectMetadataCancellationOwnership(
                          canceledKeys,
                          retainedKeys,
                          canceledOperation,
                          retainedOperation,
                          canceledFirst,
                          initialMetadata,
                          mutateDriverMetadata,
                        ),
                      () => {
                        expect({
                          initial: initialMetadata,
                          retained: retainedOperation,
                        }).toEqual(original)
                      },
                    )
                  },
                )
              : runCancellationFixed(plan, observe),
        }
      }),
    ),
  })
})

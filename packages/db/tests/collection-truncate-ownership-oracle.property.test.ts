import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import {
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
} from './oracle-config.js'
import { stripVirtualProps } from './utils.js'
import type { SyncConfig } from '../src/types.js'

/**
 * A truncate captures the optimistic ownership layers that exist when the
 * source replacement starts. If a later same-key owner fails before the
 * replacement publishes, the accepted owner captured beneath it must remain.
 * This refines the accepted-snapshot contract in the Collection state-retention
 * owner; it does not define source acknowledgement or multi-key ordering.
 *
 * The independent model is the single expected accepted row. The grammar
 * varies its key, two distinguishable values, and rollback versus handler
 * rejection. The production driver uses a real Collection, holds the later
 * update, captures a real truncate, fails that update, then commits the source
 * replacement. The refinement check compares the public row, key set, and
 * Collection status after publication. Grammar controls reconstruct and ablate
 * every axis, reject out-of-range/foreign histories, and the named wrong-answer
 * control proves the comparison rejects restoration of the failed owner.
 */
type TruncateCaptureHistory = {
  key: number
  acceptedValue: number
  failedValue: number
  failure: `rollback` | `reject`
}

type TruncateCaptureObservation = {
  finalRow: { id: number; value: number } | undefined
  publicKeys: Array<number>
  status: string
}

const property = `collection-state.truncate-capture-ownership`
const requestedReplayProperty = readOracleRunConfig().replayProperty

const historyArbitrary: fc.Arbitrary<TruncateCaptureHistory> = fc
  .record({
    key: fc.integer({ min: 1, max: 4 }),
    acceptedValue: fc.integer({ min: -10, max: 10 }),
    failedValue: fc.integer({ min: -10, max: 10 }),
    failure: fc.constantFrom(`rollback` as const, `reject` as const),
  })
  .filter(({ acceptedValue, failedValue }) => acceptedValue !== failedValue)

function reconstructHistory(value: unknown): TruncateCaptureHistory {
  if (typeof value !== `object` || value === null) {
    throw new Error(`truncate-capture history must be an object`)
  }
  const history = value as Partial<TruncateCaptureHistory>
  if (!Number.isInteger(history.key) || history.key! < 1 || history.key! > 4) {
    throw new Error(`truncate-capture key is outside the grammar`)
  }
  for (const field of [`acceptedValue`, `failedValue`] as const) {
    const fieldValue = history[field]
    if (
      !Number.isInteger(fieldValue) ||
      fieldValue! < -10 ||
      fieldValue! > 10
    ) {
      throw new Error(`${field} is outside the truncate-capture grammar`)
    }
  }
  if (history.acceptedValue === history.failedValue) {
    throw new Error(`truncate-capture values must identify distinct owners`)
  }
  if (history.failure !== `rollback` && history.failure !== `reject`) {
    throw new Error(`truncate-capture failure is outside the grammar`)
  }
  return history as TruncateCaptureHistory
}

function expectObservation(
  actual: TruncateCaptureObservation,
  history: TruncateCaptureHistory,
): void {
  expect(actual).toEqual({
    finalRow: { id: history.key, value: history.acceptedValue },
    publicKeys: [history.key],
    status: `ready`,
  })
}

async function runHistory(history: TruncateCaptureHistory): Promise<void> {
  let sync!: Parameters<
    SyncConfig<{ id: number; value: number }, number>[`sync`]
  >[0]
  let releaseUpdate!: () => void
  const updateGate = new Promise<void>((resolve) => {
    releaseUpdate = resolve
  })
  const updateFailure = new Error(`generated truncate owner rejected`)
  const collection = createCollection<{ id: number; value: number }, number>({
    id: `generated-truncate-owner-${history.key}`,
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: (actions) => {
        sync = actions
        actions.markReady()
      },
    },
    onInsert: () => Promise.resolve(),
    onUpdate: async () => {
      await updateGate
      if (history.failure === `reject`) throw updateFailure
    },
  })

  let primaryFailure: unknown
  try {
    await collection.stateWhenReady()
    const accepted = collection.insert({
      id: history.key,
      value: history.acceptedValue,
    })
    await accepted.isPersisted.promise

    const failed = collection.update(history.key, (draft) => {
      draft.value = history.failedValue
    })
    const failedOutcome = failed.isPersisted.promise.catch((error) => error)
    expect(stripVirtualProps(collection.get(history.key))).toEqual({
      id: history.key,
      value: history.failedValue,
    })

    sync.begin()
    sync.truncate()
    if (history.failure === `rollback`) failed.rollback()
    releaseUpdate()
    await failedOutcome
    expect(sync.commit()).toBe(true)

    expectObservation(
      {
        finalRow: stripVirtualProps(collection.get(history.key)),
        publicKeys: [...collection.state.keys()],
        status: collection.status,
      },
      history,
    )
  } catch (error) {
    primaryFailure = error
  } finally {
    releaseUpdate()
  }

  let cleanupFailure: unknown
  try {
    await collection.cleanup()
  } catch (error) {
    cleanupFailure = error
  }
  if (primaryFailure !== undefined && cleanupFailure !== undefined) {
    throw new AggregateError(
      [primaryFailure, cleanupFailure],
      `Truncate capture history and cleanup failed`,
      { cause: primaryFailure },
    )
  }
  if (primaryFailure !== undefined) throw primaryFailure
  if (cleanupFailure !== undefined) throw cleanupFailure
}

describe(`generated truncate capture ownership oracle`, () => {
  if (requestedReplayProperty === undefined) {
    it(`reconstructs the grammar and rejects ablated, out-of-range, and foreign histories`, () => {
      const histories = fc.sample(historyArbitrary, {
        seed: 18_530_501,
        numRuns: 40,
      })
      for (const history of histories) {
        expect(reconstructHistory(history)).toEqual(history)
      }

      const witness = histories[0]!
      for (const omitted of Object.keys(witness)) {
        const ablated = { ...witness } as Record<string, unknown>
        delete ablated[omitted]
        expect(() => reconstructHistory(ablated)).toThrow()
      }
      expect(() => reconstructHistory({ ...witness, key: 0 })).toThrow()
      expect(() =>
        reconstructHistory({
          ...witness,
          failedValue: witness.acceptedValue,
        }),
      ).toThrow()
      expect(() =>
        reconstructHistory({ ...witness, failure: `timeout` }),
      ).toThrow()
    })

    it(`rejects named wrong answer: rolled-back winner is restored`, () => {
      const witness: TruncateCaptureHistory = {
        key: 1,
        acceptedValue: 1,
        failedValue: 2,
        failure: `rollback`,
      }
      expect(() =>
        expectObservation(
          {
            finalRow: { id: 1, value: 2 },
            publicKeys: [1],
            status: `ready`,
          },
          witness,
        ),
      ).toThrow()
    })

    fcTest.prop([historyArbitrary], {
      seed: 18_530_501,
      numRuns: oracleRuns(20),
    })(`preserves the captured accepted owner (fixed)`, runHistory)

    fcTest.prop([historyArbitrary], oraclePropertyOptions(20, property))(
      `preserves the captured accepted owner (random)`,
      runHistory,
    )
  } else if (requestedReplayProperty === property) {
    fcTest.prop([historyArbitrary], oraclePropertyOptions(20, property))(
      `preserves the captured accepted owner (replay)`,
      runHistory,
    )
  } else {
    it.skip(`runs only when its replay property is selected`, () => {})
  }
})

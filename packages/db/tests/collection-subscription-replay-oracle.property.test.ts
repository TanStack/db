import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { oracleRandomParameters, readOracleRunConfig } from './oracle-config.js'
import { flushPromises } from './utils.js'
import type { Collection } from '../src/collection/index.js'
import type { ChangeMessageOrDeleteKeyMessage } from '../src/types.js'

type ReplayRow = {
  id: `one` | `two`
  value: number
}

type ReplayLoad = {
  rows: ReadonlyArray<ReplayRow>
  outcome: `resolve` | `reject`
}

type ReplayAttempt = {
  loads: ReadonlyArray<ReplayLoad>
}

type SourceAction =
  | { type: `put`; row: ReplayRow }
  | { type: `delete`; id: ReplayRow[`id`] }

type ReplayScenario = {
  initialRows: ReadonlyArray<ReplayRow>
  demandCount: number
  attempts: ReadonlyArray<ReplayAttempt>
  settlementOrder: ReadonlyArray<number>
  afterSettlement: ReadonlyArray<SourceAction>
}

type PendingReplay = {
  attemptIndex: number
  load: ReplayLoad
  deferred: ReturnType<typeof createDeferred<void>>
  error: Error
  settled: boolean
}

const rowArbitrary: fc.Arbitrary<ReplayRow> = fc.record({
  id: fc.constantFrom(`one` as const, `two` as const),
  value: fc.integer({ min: -2, max: 2 }),
})

const rowsArbitrary = fc.uniqueArray(rowArbitrary, {
  minLength: 0,
  maxLength: 2,
  selector: ({ id }) => id,
})

const replayLoadArbitrary: fc.Arbitrary<ReplayLoad> = fc.record({
  rows: rowsArbitrary,
  outcome: fc.constantFrom(`resolve` as const, `reject` as const),
})

const sourceActionArbitrary: fc.Arbitrary<SourceAction> = fc.oneof(
  rowArbitrary.map((row) => ({ type: `put` as const, row })),
  fc
    .constantFrom<ReplayRow[`id`]>(`one`, `two`)
    .map((id) => ({ type: `delete` as const, id })),
)

const replayScenarioArbitrary: fc.Arbitrary<ReplayScenario> = fc
  .integer({ min: 1, max: 2 })
  .chain((demandCount) =>
    fc
      .record({
        initialRows: rowsArbitrary,
        attempts: fc.array(
          fc.record({
            loads: fc.array(replayLoadArbitrary, {
              minLength: demandCount,
              maxLength: demandCount,
            }),
          }),
          { minLength: 1, maxLength: 3 },
        ),
        afterSettlement: fc.array(sourceActionArbitrary, {
          minLength: 0,
          maxLength: 3,
        }),
      })
      .chain(({ initialRows, attempts, afterSettlement }) => {
        const replayCount = attempts.length * demandCount
        return fc
          .shuffledSubarray(
            Array.from({ length: replayCount }, (_, index) => index),
            { minLength: replayCount, maxLength: replayCount },
          )
          .map((settlementOrder) => ({
            initialRows,
            demandCount,
            attempts,
            settlementOrder,
            afterSettlement,
          }))
      }),
  )

function rowsById(
  rows: ReadonlyArray<ReplayRow>,
): Map<string | number, ReplayRow> {
  return new Map(rows.map((row) => [row.id, { ...row }]))
}

function sortedRows(
  rows: ReadonlyMap<string | number, ReplayRow>,
): Array<ReplayRow> {
  return [...rows.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )
}

async function runReplayScenario(scenario: ReplayScenario): Promise<void> {
  let begin!: () => void
  let write!: (
    message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
  ) => void
  let commit!: () => void
  let truncate!: () => void
  let loadCount = 0
  let unloadCount = 0
  const queuedLoads: Array<{ attemptIndex: number; load: ReplayLoad }> = []
  const pendingReplays: Array<PendingReplay> = []

  const applyRows = (rows: ReadonlyArray<ReplayRow>) => {
    if (rows.length === 0) return
    begin()
    for (const row of rows) {
      write({
        type: collection.get(row.id) === undefined ? `insert` : `update`,
        value: { ...row },
      })
    }
    commit()
  }

  const collection: Collection<ReplayRow, string | number> =
    createCollection<ReplayRow>({
      id: `subscription-replay-oracle`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: () => {
              loadCount++
              if (loadCount <= scenario.demandCount) {
                if (loadCount === 1) applyRows(scenario.initialRows)
                return true
              }

              const queued = queuedLoads.shift()
              if (!queued) throw new Error(`Replay load was not queued`)
              const pending: PendingReplay = {
                attemptIndex: queued.attemptIndex,
                load: queued.load,
                deferred: createDeferred<void>(),
                error: new Error(`Replay rejected`),
                settled: false,
              }
              pendingReplays.push(pending)
              return pending.deferred.promise
            },
            unloadSubset: () => {
              unloadCount++
            },
          }
        },
      },
    })

  const visible = new Map<string | number, ReplayRow>()
  let publicationCount = 0
  const subscription = collection.subscribeChanges((changes) => {
    publicationCount++
    for (const change of changes) {
      if (change.type === `delete`) visible.delete(change.key)
      else {
        visible.set(change.key, {
          id: change.value.id,
          value: change.value.value,
        })
      }
    }
  })
  let unsubscribed = false

  const assertPublished = (
    expected: ReadonlyMap<string | number, ReplayRow>,
  ) => {
    expect(sortedRows(visible)).toEqual(sortedRows(expected))
  }

  const applySourceAction = (action: SourceAction): boolean => {
    if (action.type === `delete`) {
      const previous = collection.get(action.id)
      if (!previous) return false
      begin()
      write({ type: `delete`, key: action.id })
      commit()
      return true
    }

    const previous = collection.get(action.row.id)
    if (previous?.value === action.row.value) return false
    applyRows([action.row])
    return true
  }

  try {
    for (let demand = 0; demand < scenario.demandCount; demand++) {
      subscription.requestSnapshot({ optimizedOnly: false })
    }
    const expectedPublished = rowsById(scenario.initialRows)
    const expectedSource = rowsById(scenario.initialRows)
    assertPublished(expectedPublished)
    const publicationCountBeforeReplay = publicationCount

    for (const [attemptIndex, attempt] of scenario.attempts.entries()) {
      for (const load of attempt.loads) {
        queuedLoads.push({ attemptIndex, load })
      }
      begin()
      truncate()
      commit()
      expectedSource.clear()
      await flushPromises()
      assertPublished(expectedPublished)
      expect(publicationCount).toBe(publicationCountBeforeReplay)
    }

    const replayBaseline = new Map(expectedPublished)
    const currentAttemptIndex = scenario.attempts.length - 1
    const currentAttempt = scenario.attempts[currentAttemptIndex]!
    const currentAttemptSucceeds = currentAttempt.loads.every(
      ({ outcome }) => outcome === `resolve`,
    )
    let lastReportedError: Error | undefined
    for (const replayIndex of scenario.settlementOrder) {
      const pending = pendingReplays[replayIndex]!
      const load = pending.load
      pending.settled = true
      if (load.outcome === `resolve`) {
        applyRows(load.rows)
        for (const row of load.rows) {
          expectedSource.set(row.id, { ...row })
        }
        pending.deferred.resolve()
      } else {
        if (pending.attemptIndex === currentAttemptIndex) {
          lastReportedError = pending.error
        }
        pending.deferred.reject(pending.error)
      }
      await flushPromises()

      const allSettled = pendingReplays.every((replay) => replay.settled)
      if (allSettled && currentAttemptSucceeds) {
        expectedPublished.clear()
        for (const [id, row] of expectedSource) {
          expectedPublished.set(id, { ...row })
        }
      } else if (allSettled) {
        expectedPublished.clear()
        for (const [id, row] of replayBaseline) {
          expectedPublished.set(id, { ...row })
        }
      }
      assertPublished(expectedPublished)
      if (!allSettled || !currentAttemptSucceeds) {
        expect(publicationCount).toBe(publicationCountBeforeReplay)
      } else {
        expect(
          publicationCount - publicationCountBeforeReplay,
        ).toBeLessThanOrEqual(1)
      }
      expect(subscription.lastError).toBe(lastReportedError)
    }

    for (const action of scenario.afterSettlement) {
      const countBeforeAction = publicationCount
      const applied = applySourceAction(action)
      if (applied && action.type === `delete`) {
        expectedSource.delete(action.id)
        expectedPublished.delete(action.id)
      } else if (applied && action.type === `put`) {
        expectedSource.set(action.row.id, { ...action.row })
        expectedPublished.set(action.row.id, { ...action.row })
      }
      assertPublished(expectedPublished)
      expect(publicationCount).toBe(countBeforeAction + Number(applied))
    }

    subscription.unsubscribe()
    unsubscribed = true
    expect(unloadCount).toBe(loadCount)
  } finally {
    for (const replay of pendingReplays) {
      if (!replay.settled) replay.deferred.resolve()
    }
    await flushPromises()
    if (!unsubscribed) subscription.unsubscribe()
    await collection.cleanup()
  }
}

const { multiplier, replaySeed } = readOracleRunConfig()
const generatedRuns = 30 * multiplier

describe(`CollectionSubscription replay oracle`, () => {
  it(`publishes a same-key replacement after a failed replay`, async () => {
    await runReplayScenario({
      initialRows: [{ id: `one`, value: 1 }],
      demandCount: 1,
      attempts: [{ loads: [{ rows: [], outcome: `reject` }] }],
      settlementOrder: [0],
      afterSettlement: [{ type: `put`, row: { id: `one`, value: 2 } }],
    })
  })

  it(`lets the newest successful replay replace an older failed replay`, async () => {
    await runReplayScenario({
      initialRows: [{ id: `one`, value: 1 }],
      demandCount: 1,
      attempts: [
        { loads: [{ rows: [], outcome: `reject` }] },
        {
          loads: [{ rows: [{ id: `one`, value: 2 }], outcome: `resolve` }],
        },
      ],
      settlementOrder: [1, 0],
      afterSettlement: [],
    })
  })

  it(`releases every successful overlapping replay acquisition`, async () => {
    await runReplayScenario({
      initialRows: [],
      demandCount: 1,
      attempts: [
        { loads: [{ rows: [], outcome: `resolve` }] },
        { loads: [{ rows: [], outcome: `resolve` }] },
      ],
      settlementOrder: [1, 0],
      afterSettlement: [],
    })
  })

  it(`uses the newest complete multi-demand replay`, async () => {
    await runReplayScenario({
      initialRows: [{ id: `one`, value: 1 }],
      demandCount: 2,
      attempts: [
        {
          loads: [
            { rows: [{ id: `one`, value: 2 }], outcome: `resolve` },
            { rows: [], outcome: `reject` },
          ],
        },
        {
          loads: [
            { rows: [{ id: `one`, value: 3 }], outcome: `resolve` },
            { rows: [{ id: `two`, value: 4 }], outcome: `resolve` },
          ],
        },
      ],
      settlementOrder: [2, 3, 0, 1],
      afterSettlement: [],
    })
  })

  fcTest.prop([replayScenarioArbitrary], {
    numRuns: generatedRuns,
    seed: 1756,
  })(`matches replay and ownership laws for a fixed seed`, runReplayScenario)

  fcTest.prop(
    [replayScenarioArbitrary],
    oracleRandomParameters(generatedRuns, replaySeed),
  )(
    `matches replay and ownership laws for a random or replayed seed`,
    runReplayScenario,
  )
})

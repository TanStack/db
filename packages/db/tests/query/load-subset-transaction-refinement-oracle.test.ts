import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { createTransaction } from '../../src/transactions.js'

/**
 * # When can an abort cancel a load?
 *
 * The applied-receipt contract in
 * `packages/db/src/query/live/ARCHITECTURE.md` owns this boundary. An
 * on-demand load has two stages:
 *
 * 1. The source writes a row to a pending batch.
 * 2. The collection publishes the row to readers.
 *
 * Another transaction can delay the second stage. Commit accepts the batch,
 * and an accepted batch always applies. An abort before acceptance must reject
 * the load and discard the row. A later abort, while the batch waits or after
 * publication starts, must resolve the load and keep the row.
 *
 * `expectedOutcome` states this rule from public facts. It does not copy the
 * production queue. The test creates each timing phase in production. It then
 * compares the result with the model. This fixed grammar uses one row, one
 * parked optimistic transaction, and three abort phases. It checks the direct
 * source Collection boundary, not a live-query graph or other schedules.
 */

type Row = { id: string; group: string }

type AbortPhase = `at-commit` | `while-parked` | `after-publication-starts`

type ExpectedOutcome = {
  load: `rejects` | `resolves`
  rowIsVisible: boolean
  publishedBatches: Array<Array<string>>
  callbackReads: Array<Array<string>>
}

// Acceptance is the boundary. An abort at commit, before acceptance, rejects
// the load and discards the row. An accepted transaction always applies, so a
// later abort resolves the load and the row publishes when the parked
// optimistic transaction settles.
function expectedOutcome(
  abortPhase: AbortPhase,
  remoteKey: string,
): ExpectedOutcome {
  const accepted = abortPhase !== `at-commit`
  return {
    load: accepted ? `resolves` : `rejects`,
    rowIsVisible: accepted,
    publishedBatches: accepted ? [[remoteKey]] : [],
    callbackReads: accepted ? [[remoteKey]] : [],
  }
}

describe(`loadSubset transaction refinement`, () => {
  // These three phases cover the contract:
  // - The caller aborts during commit.
  // - The caller aborts after commit while publication waits.
  // - The caller aborts when the first listener runs.
  // This oracle does not vary the schedule within each phase.
  it.each<AbortPhase>([
    `at-commit`,
    `while-parked`,
    `after-publication-starts`,
  ])(
    `matches the independent receipt and publication model when aborting %s`,
    async (abortPhase) => {
      const sourceId = `transaction-refinement-${abortPhase}`
      const remoteRow: Row = { id: `remote`, group: `requested` }
      const expected = expectedOutcome(abortPhase, remoteRow.id)
      const controller = new AbortController()
      const persistence = createDeferred<void>()
      const publishedBatches: Array<Array<string>> = []
      const callbackReads: Array<Array<string>> = []
      let loadSubsetCalls = 0
      let abortObservedAtCommit = false
      let receiptWasDeferred = false
      let abortRaisedByPublication = false

      // Keep the local mutation unresolved. This delays publication of the
      // remote row and creates the second abort phase.
      const source = createCollection<Row>({
        id: sourceId,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: ({ signal }) => {
                loadSubsetCalls++
                begin()
                write({ type: `insert`, value: remoteRow })
                if (abortPhase === `at-commit`) controller.abort()
                abortObservedAtCommit = signal?.aborted ?? false
                const receipt = commit(signal)
                receiptWasDeferred = receipt instanceof Promise
                return receipt
              },
            }
          },
        },
      })
      source.startSyncImmediate()
      const blocker = createTransaction({
        mutationFn: () => persistence.promise,
      })
      blocker.mutate(() =>
        source.insert({ id: `local`, group: `outside-request` }),
      )

      // Record the change and the collection snapshot at the same publication.
      const subscription = source.subscribeChanges(
        (changes) => {
          const remoteKeys = changes
            .filter((change) => change.key === remoteRow.id)
            .map((change) => String(change.key))
          if (remoteKeys.length === 0) return
          publishedBatches.push(remoteKeys)
          callbackReads.push(source.has(remoteRow.id) ? [remoteRow.id] : [])
          if (abortPhase === `after-publication-starts`) {
            controller.abort()
            abortRaisedByPublication = controller.signal.aborted
          }
        },
        { includeInitialState: false },
      )
      let primaryFailure: unknown
      let failed = false
      const cleanupFailures: Array<unknown> = []
      try {
        const load = source._sync.loadSubset({ signal: controller.signal })
        // Keep a rejection observed if an earlier reach assertion fails.
        if (load instanceof Promise) void load.catch(() => undefined)
        expect(load).toBeInstanceOf(Promise)

        // The adapter and applied-receipt boundary must be reached in every
        // phase. The held mutation keeps the remote sync transaction parked.
        expect(loadSubsetCalls).toBe(1)
        expect(receiptWasDeferred).toBe(true)
        expect(abortObservedAtCommit).toBe(abortPhase === `at-commit`)
        expect(source.has(remoteRow.id)).toBe(false)

        if (abortPhase === `while-parked`) {
          controller.abort()
        }

        persistence.resolve()
        await blocker.isPersisted.promise

        if (expected.load === `rejects`) {
          await expect(load).rejects.toMatchObject({ name: `AbortError` })
        } else {
          await expect(load).resolves.toBeUndefined()
        }

        // The load promise, change event, and collection snapshot must agree.
        // A mismatch would expose a partial publication to callers.
        expect(source.has(remoteRow.id)).toBe(expected.rowIsVisible)
        expect(publishedBatches).toEqual(expected.publishedBatches)
        expect(callbackReads).toEqual(expected.callbackReads)
        expect(abortRaisedByPublication).toBe(
          abortPhase === `after-publication-starts`,
        )
      } catch (error) {
        primaryFailure = error
        failed = true
      } finally {
        persistence.resolve()
        try {
          await blocker.isPersisted.promise
        } catch (error) {
          cleanupFailures.push(error)
        }
        try {
          subscription.unsubscribe()
        } catch (error) {
          cleanupFailures.push(error)
        }
        try {
          await source.cleanup()
        } catch (error) {
          cleanupFailures.push(error)
        }
      }
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          cleanupFailures,
          `loadSubset transaction refinement cleanup failed`,
          { cause: failed ? primaryFailure : cleanupFailures[0] },
        )
      }
      if (failed) throw primaryFailure
    },
  )
})

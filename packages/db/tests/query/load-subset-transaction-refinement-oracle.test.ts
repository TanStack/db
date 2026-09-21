import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { createTransaction } from '../../src/transactions.js'

/**
 * # When can an abort cancel a load?
 *
 * An on-demand load has two stages:
 *
 * 1. The source writes a row to a pending batch.
 * 2. The collection publishes the row to readers.
 *
 * Another transaction can delay the second stage. During this delay, the
 * source can finish the first stage. An abort before publication must reject
 * the load and discard the row. An abort after publication starts must resolve
 * the load and keep the row.
 *
 * `expectedOutcome` states this rule from public facts. It does not copy the
 * production queue. The test creates each timing phase in production. It then
 * compares the result with the model.
 */

type Row = { id: string; group: string }

type AbortPhase = `at-commit` | `while-parked` | `after-publication-starts`

type ExpectedOutcome = {
  load: `rejects` | `resolves`
  rowIsVisible: boolean
}

// Publication is the boundary. An abort before publication rejects the load
// and discards the row. An abort after publication starts resolves the load
// and keeps the row visible.
function expectedOutcome(abortPhase: AbortPhase): ExpectedOutcome {
  const publicationStarted = abortPhase === `after-publication-starts`
  return {
    load: publicationStarted ? `resolves` : `rejects`,
    rowIsVisible: publicationStarted,
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
      const expected = expectedOutcome(abortPhase)
      const sourceId = `transaction-refinement-${abortPhase}`
      const remoteRow: Row = { id: `remote`, group: `requested` }
      const controller = new AbortController()
      const persistence = createDeferred<void>()
      const publishedBatches: Array<Array<string>> = []
      const callbackReads: Array<Array<string>> = []

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
                begin()
                write({ type: `insert`, value: remoteRow })
                if (abortPhase === `at-commit`) controller.abort()
                return commit(signal)
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
          }
        },
        { includeInitialState: false },
      )
      const load = source._sync.loadSubset({ signal: controller.signal })
      expect(load).toBeInstanceOf(Promise)

      try {
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
        expect(publishedBatches).toEqual(
          expected.rowIsVisible ? [[remoteRow.id]] : [],
        )
        expect(callbackReads).toEqual(
          expected.rowIsVisible ? [[remoteRow.id]] : [],
        )
      } finally {
        persistence.resolve()
        await blocker.isPersisted.promise.catch(() => undefined)
        subscription.unsubscribe()
        await source.cleanup()
      }
    },
  )
})

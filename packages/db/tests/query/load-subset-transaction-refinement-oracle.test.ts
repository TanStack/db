import { describe, expect } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { createTransaction } from '../../src/transactions.js'
import { LoadSubsetOperationAbortedError } from '../../src/errors.js'
import { oracleProperty } from '../oracle-config.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter.js'

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
 * and an accepted batch always applies. An abort before acceptance discards
 * the row. A later abort, while the batch waits or after publication starts,
 * keeps the row. In every phase the aborted load rejects with `AbortError`;
 * a source that wants to discard a stale page checks the signal before
 * `commit()`. Adapters extend the same law to every cut of their own loads
 * (before the fetch, a fetch rejected by the abort, after the fetch but before
 * the commit, and between pages); their test suites own those drivers.
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

// Acceptance is the row boundary. An abort at commit, before acceptance,
// discards the row. An accepted transaction always applies, so a later abort
// keeps the row, which publishes when the parked optimistic transaction
// settles. Every aborted caller sees its load reject.
function expectedOutcome(
  abortPhase: AbortPhase,
  remoteKey: string,
): ExpectedOutcome {
  const accepted = abortPhase !== `at-commit`
  return {
    load: `rejects`,
    rowIsVisible: accepted,
    publishedBatches: accepted ? [[remoteKey]] : [],
    callbackReads: accepted ? [[remoteKey]] : [],
  }
}

// The production driver: it creates one abort phase in production and
// compares the load, change event, and collection snapshot with
// `expectedOutcome`.
async function runAbortPhase(abortPhase: AbortPhase): Promise<void> {
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
            // Source contract: a caller that aborted sees `AbortError`,
            // even though its accepted rows apply.
            return Promise.resolve(receipt).then(() => {
              if (signal?.aborted) throw new LoadSubsetOperationAbortedError()
            })
          },
        }
      },
    },
  })
  source.startSyncImmediate()
  const blocker = createTransaction({
    mutationFn: () => persistence.promise,
  })
  blocker.mutate(() => source.insert({ id: `local`, group: `outside-request` }))

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
    await blocker.when(`settled`)

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
      await blocker.when(`settled`)
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
}

// These three phases cover the contract:
// - The caller aborts during commit.
// - The caller aborts after commit while publication waits.
// - The caller aborts when the first listener runs.
// This oracle does not vary the schedule within each phase.
const abortPhases: Array<AbortPhase> = [
  `at-commit`,
  `while-parked`,
  `after-publication-starts`,
]

const transactionRefinementLaw = `loadSubset transaction refinement`

describe(`loadSubset transaction refinement`, () => {
  oracleProperty({
    id: `load-subset.transaction-refinement`,
    law: {
      statement: `Commit accepts an on-demand batch and an accepted batch always applies: an abort before acceptance discards the row, a later abort keeps it, and every aborted load rejects with AbortError.`,
      authority: `The applied-receipt contract in packages/db/src/query/live/ARCHITECTURE.md.`,
      limits: `One row, one parked optimistic transaction, and three abort phases at the direct source Collection boundary; no live-query graph and no other schedules.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/transactions.ts#createTransaction',
    ],
    histories: abortPhases,
    label: (abortPhase) =>
      `matches the independent receipt and publication model when aborting ${abortPhase}`,
    resolve: (abortPhase) => ({ abortPhase }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(transactionRefinementLaw, plan, observe, () =>
        runAbortPhase(plan.abortPhase),
      ),
    check: forwardAssertionJudgment,
  })
})

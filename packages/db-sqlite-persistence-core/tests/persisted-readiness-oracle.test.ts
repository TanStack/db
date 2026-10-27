import {
  PERSISTED_READINESS,
  createCollection,
  createLiveQueryCollection,
  createLiveQueryObserver,
  eq,
  waitForPersistedInitialRender,
} from '@tanstack/db'
import { describe, expect, it, vi } from 'vitest'
import { declareOracle } from '../../db/tests/oracle-declaration.js'
import {
  checkWithCleanup,
  deferred,
  recordingAdapter,
  source,
} from './persisted-readiness-support.js'
import type { Row } from './persisted-readiness-support.js'

type ModelOutcome = `loading` | `ready` | `error`
type ModelSource = {
  optedIn: boolean
  outcome: ModelOutcome
  error: unknown
}

function expectedPersistedSnapshot(sources: ReadonlyArray<ModelSource>) {
  if (sources.some((entry) => !entry.optedIn)) {
    return { status: `unavailable`, error: undefined }
  }
  const failed = sources.find((entry) => entry.outcome === `error`)
  if (failed) return { status: `error`, error: failed.error }
  return {
    status: sources.some((entry) => entry.outcome === `loading`)
      ? `loading`
      : `ready`,
    error: undefined,
  }
}

/**
 * # When may a query render its restored data?
 *
 * The independent status rule is an all-source conjunction: a query is persisted-ready
 * only after every eager persisted source opted in and successfully completed
 * its restore in the current sync run. A source that opts out makes the
 * query unavailable for this signal. A failed restore reports that exact
 * failure. Neither an empty persisted database nor a pending network source
 * changes the rule. Initial rendering prefers upstream-signaled Collection
 * readiness until the longest opted-in source deadline, then permits only
 * completed restoration.
 * Network failure permits earlier fallback without stopping sync. A failed
 * client query stream is a network failure; a derived-query failure is not.
 * If the stream failure precedes restore, the fallback must include the
 * restored query rows. An empty restore is complete data, not missing data.
 * The production driver holds each adapter's persisted read and
 * observes the real persisted wrapper, Collection, live query, and observer.
 *
 * Checkpoints are before persisted reads settle and after each controlled
 * settlement. The row assertion prevents a status-only false green; the empty
 * case prevents inferring readiness from row count. The SSR handoff and
 * framework scheduling paths have separate focused witnesses below and in
 * their packages. This owner does not claim native SQLite, replacement client
 * records during the wait, or arbitrary provider/network histories.
 *
 * Audit: ORC-001/002 use the approved all-source rule and the independent
 * expectedPersistedSnapshot model. ORC-003/005 are the finite outcome grammar,
 * controlled persistence driver, and public snapshot checks. ORC-004/007/008
 * do not apply: the 36-case product is enumerated, not generated or stateful.
 * ORC-006: the pre-implementation observer lacked persistedStatus and
 * preloadForInitialRender; the deadline test also failed against the immediate
 * persisted-ready race. Before the early-error repair, the held-read witness
 * resolved initial rendering with an empty live query despite a durable row.
 * Before the client-stream repair, the four stream-failure cases rejected the
 * initial-render wait instead of exposing the completed persisted result.
 * A preexisting failed stream also left a fresh observer waiting for the
 * deadline after restore. The observer-start witness rejects that design.
 * An any-one-ready answer fails the joined half-ready checkpoint. A
 * nonempty-rows answer fails the empty-restore checkpoint. The combined
 * derived-query/client-stream failure rejects false local fallback. ORC-009 maps model
 * outcome `ready` to completed persisted restore; it is not Collection status.
 * ORC-010 preserves a primary mismatch and distinct cleanup failures through
 * checkWithCleanup. ORC-011 has no named shared-fault hypothesis requiring
 * another model formulation. ORC-012 records the bounded contract, driver,
 * wrong-answer checks, and uncovered histories here and in the coverage map.
 * It does not claim all network histories.
 * ORC-013: the joined half-ready snapshot rejects any-one-ready; the empty
 * restore rejects row-count readiness; the 99/100-ms deadline and 50/100-ms
 * joined deadlines reject early fallback; the restart witness rejects stale
 * public rows while the replacement read is held. ORC-014 does not apply to a
 * real-provider claim: this oracle explicitly ends at its controlled adapter.
 */
declareOracle({ model: [expectedPersistedSnapshot] })

describe(`persisted-readiness oracle`, () => {
  it(`refines the finite two-source readiness model`, async () => {
    const outcomes: ReadonlyArray<ModelOutcome> = [`loading`, `ready`, `error`]
    let caseId = 0
    // Grammar: each source independently opts in or out and has one of the
    // three local outcomes. No network transition is needed to judge this
    // observer-level projection; real persistence histories are below.
    for (const leftOptedIn of [false, true]) {
      for (const rightOptedIn of [false, true]) {
        for (const leftOutcome of outcomes) {
          for (const rightOutcome of outcomes) {
            const id = caseId++
            const leftError = new Error(`left-${id}`)
            const rightError = new Error(`right-${id}`)
            const left = createCollection<Row>({
              id: `local-model-left-${id}`,
              getKey: (row) => row.id,
              sync: { sync: () => ({}) },
            })
            const right = createCollection<Row>({
              id: `local-model-right-${id}`,
              getKey: (row) => row.id,
              sync: { sync: () => ({}) },
            })
            if (leftOptedIn) {
              Object.defineProperty(left.config, PERSISTED_READINESS, {
                value: {
                  networkTimeoutMs: 0,
                  getOrStartNetworkDeadline: () => Date.now(),
                  getSnapshot: () =>
                    leftOutcome === `error`
                      ? { status: `error`, error: leftError }
                      : { status: leftOutcome },
                  subscribe: () => () => {},
                  waitForInitialRender: waitForPersistedInitialRender,
                },
              })
            }
            if (rightOptedIn) {
              Object.defineProperty(right.config, PERSISTED_READINESS, {
                value: {
                  networkTimeoutMs: 0,
                  getOrStartNetworkDeadline: () => Date.now(),
                  getSnapshot: () =>
                    rightOutcome === `error`
                      ? { status: `error`, error: rightError }
                      : { status: rightOutcome },
                  subscribe: () => () => {},
                  waitForInitialRender: waitForPersistedInitialRender,
                },
              })
            }
            const query = createLiveQueryCollection({
              query: (q) =>
                q
                  .from({ left })
                  .join({ right }, ({ left: a, right: b }) => eq(a.id, b.id)),
            })
            const observer = createLiveQueryObserver(query)
            await checkWithCleanup(() => {
              const expected = expectedPersistedSnapshot([
                {
                  optedIn: leftOptedIn,
                  outcome: leftOutcome,
                  error: leftError,
                },
                {
                  optedIn: rightOptedIn,
                  outcome: rightOutcome,
                  error: rightError,
                },
              ])
              expect(observer.getSnapshot(), `case ${id}`).toMatchObject({
                persistedStatus: expected.status,
                isPersistedReady: expected.status === `ready`,
                persistedError: expected.error,
              })
            }, [
              () => observer.dispose(),
              () => query.cleanup(),
              () => left.cleanup(),
              () => right.cleanup(),
            ])
          }
        }
      }
    }
    expect(caseId).toBe(36)
  })

  // The finite conjunction above has no transitions. This legal history gives
  // source A two sync runs while source B completes once. A's old restore cannot
  // satisfy the current-run conjunct after cleanup. The model needs only each
  // source's current restore outcome; it does not copy the wrapper's generations.
  // A fresh live query is created after restart because cleanup terminates the
  // old query. Its public snapshot and initial-render wait are the checkpoints.
  it(`waits for a restarted source after the other joined source restores`, async () => {
    const left = recordingAdapter([{ id: `one`, value: `left` }])
    const right = recordingAdapter([{ id: `one`, value: `right` }])
    left.load.resolve()
    const secondLeftRead = deferred<void>()
    const loadResumeSnapshot = left.adapter.loadResumeSnapshot
    let leftReads = 0
    left.adapter.loadResumeSnapshot = async (id, options) => {
      if (options?.includeRows !== false && ++leftReads === 2) {
        await secondLeftRead.promise
      }
      return loadResumeSnapshot(id, options)
    }
    const sourceA = source(`joined-restart-left`, left.adapter, true)
    const sourceB = source(`joined-restart-right`, right.adapter, true)
    let query: ReturnType<typeof createLiveQueryCollection> | undefined
    let observer: ReturnType<typeof createLiveQueryObserver> | undefined
    let unsubscribe: (() => void) | undefined
    await checkWithCleanup(async () => {
      sourceA.startSyncImmediate()
      sourceB.startSyncImmediate()
      await vi.waitFor(() => expect(leftReads).toBe(1))
      await vi.waitFor(() => expect(sourceA.has(`one`)).toBe(true))

      await sourceA.cleanup()
      sourceA.startSyncImmediate()
      await vi.waitFor(() => expect(leftReads).toBe(2))
      right.load.resolve()
      await vi.waitFor(() => expect(sourceB.has(`one`)).toBe(true))

      query = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ a: sourceA })
            .join({ b: sourceB }, ({ a, b }) => eq(a.id, b.id)),
      })
      observer = createLiveQueryObserver(query)
      unsubscribe = observer.subscribe(() => {})
      const model = [
        { optedIn: true, outcome: `loading` as ModelOutcome, error: undefined },
        { optedIn: true, outcome: `ready` as ModelOutcome, error: undefined },
      ]
      expect(observer.getSnapshot().persistedStatus).toBe(
        expectedPersistedSnapshot(model).status,
      )
      let initialRenderSettled = false
      const initialRenderWait = observer.preloadForInitialRender().then(() => {
        initialRenderSettled = true
      })
      await Promise.resolve()
      expect(initialRenderSettled).toBe(false)

      secondLeftRead.resolve()
      model[0]!.outcome = `ready`
      await initialRenderWait
      expect(observer.getSnapshot()).toMatchObject({
        persistedStatus: expectedPersistedSnapshot(model).status,
        data: [
          { a: { id: `one`, value: `left` }, b: { id: `one`, value: `right` } },
        ],
      })
    }, [
      () => secondLeftRead.resolve(),
      () => unsubscribe?.(),
      () => observer?.dispose(),
      () => query?.cleanup(),
      () => sourceA.cleanup(),
      () => sourceB.cleanup(),
    ])
  })
})

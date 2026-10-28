/**
 * Native failure histories compose ownership, application, and sync-run
 * authority. Authority: LoadSubsetOptions.signal, SyncAppliedReceipt and
 * CleanupFn in db/src/types.ts; live/ARCHITECTURE.md laws 6, 7 and 14. Releasing
 * one owner cannot cancel its peer's accepted writes. A canceled caller waits
 * for its already accepted writes, unless cleanup abandons them. Cleanup puts
 * every old dependent graph in terminal error; restart needs a fresh graph.
 * Ordinary provider errors may reject acquisitions and valid later snapshots
 * may recover the native source. They are not authoritative truncate replay.
 *
 * The scientific receipt model is LazyReceiptModel. Authored row/version facts
 * identify a uniquely necessary batch for two deep callers. The small terminal
 * monitor below keeps only the last complete graph value and cleanup authority;
 * transport ranges, pager queues, cursor encodings and sealing are driver facts.
 * Three episodes compose pre-acceptance failure, shared held acceptance with
 * cancellation and a surviving owner, then held cleanup and restart. Generated
 * rows, order, transport, retiring owner, delivery order, and stale-callback
 * order reconstruct adjacent schedules. Removing either failure cut loses the
 * distinction between unaccepted work and an irrevocable accepted batch.
 * Limits: finite fixed-query source, one coherent accepted native batch per
 * deep acquisition, no same-run authoritative truncate, and no claim that
 * ordinary rejection must await application. Both SDK shapes are fixtures;
 * real SDK/backend observations have separate receiving owners.
 */
import { createLiveQueryCollection, createTransaction } from '@tanstack/db'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import { runOracleCampaign } from '../../db/tests/oracle-campaign'
import { oracleRuns } from '../../db/tests/oracle-config'
import { withTestCleanup } from './helpers'
import { lazyFixture } from './lazy-paging-driver'
import {
  LazyTerminalGraphModel,
  assertLazyCoverage,
  copyLazyRows,
  expectedLazyRows,
  ordered,
} from './lazy-paging-model-oracle'
import { LazyReceiptModel } from './lazy-paging-receipt-model'
import type { LazyRow } from './lazy-paging-model-oracle'

const drain = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}
const gate = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const fact = (row: LazyRow) => JSON.stringify(row)

const grammar = fc.record({
  size: fc.integer({ min: 7, max: 13 }),
  pageSize: fc.integer({ min: 1, max: 3 }),
  descending: fc.boolean(),
  react: fc.boolean(),
  reverse: fc.boolean(),
  retiring: fc.integer({ min: 0, max: 1 }),
  staleErrorFirst: fc.boolean(),
  text: fc.string({ maxLength: 8 }),
})

type History = typeof grammar extends fc.Arbitrary<infer T> ? T : never
async function runFailureHistory(h: History) {
  const rows = Array.from({ length: h.size }, (_, rank) => ({
    id: `row-${rank}`,
    rank,
    text: h.text,
  }))
  let cleanupHold: ReturnType<typeof gate> | undefined
  const f = lazyFixture(
    rows,
    h.pageSize,
    h.descending,
    `none`,
    false,
    () => cleanupHold?.promise ?? Promise.resolve(),
    h.react ? `react` : `javascript`,
  )
  const releases: Array<() => void> = []
  const stopGraphObservers: Array<() => void> = []
  const graphCleanups: Array<() => Promise<void>> = []
  const receiptFailures: Array<unknown> = []
  const reaches = new Set<string>()
  let releaseApplication = async () => {}
  let stopBatches = () => {}
  const load = (limit: number, signal?: AbortSignal) => {
    const result = f.load({ limit }, signal)
    releases.push(result.release)
    void Promise.resolve(result.result).catch(() => {})
    return result
  }
  const hold = () => {
    const pending = gate()
    const transaction = createTransaction({ mutationFn: () => pending.promise })
    transaction.mutate(() =>
      f.source.insert({ id: `optimistic-only`, rank: 10000, text: `hold` }),
    )
    releaseApplication = async () => {
      pending.resolve()
      await transaction.isPersisted.promise
      await drain()
    }
  }
  const dependent = (limit: number) => {
    const graph = createLiveQueryCollection((q) =>
      q
        .from({ row: f.source })
        .orderBy(({ row }) => row.rank, h.descending ? `desc` : `asc`)
        .orderBy(({ row }) => row.id, h.descending ? `desc` : `asc`)
        .select(({ row }) => row)
        .limit(limit),
    )
    graphCleanups.push(() => graph.cleanup())
    return graph
  }
  const terminalMonitor = (graph: ReturnType<typeof dependent>) => {
    const model = new LazyTerminalGraphModel()
    const observe = () => {
      try {
        model.observe(graph.status, graph.toArray)
      } catch (error) {
        // Do not throw through a production subscriber. Retain every failure
        // until the next explicit comparison cut, including transient events.
        receiptFailures.push(error)
      }
    }
    const changes = graph.subscribeChanges(observe, {
      includeInitialState: false,
    })
    stopGraphObservers.push(() => changes.unsubscribe())
    stopGraphObservers.push(graph.on(`status:change`, observe))
    return model
  }
  const preload = (graph: ReturnType<typeof dependent>) => {
    const promise = graph.preload()
    let settled = false
    void promise.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    return async () => {
      await drain()
      if (!settled)
        throw new Error(`native progress: quiescent preload waiter stranded`)
      await promise
    }
  }
  await withTestCleanup(
    async () => {
      // Before source acceptance, two owners can fail without any provider
      // rows entering the applied base. This episode ends before recovery.
      const failed = [load(h.size), load(h.size)]
      const failure = new Error(`before acceptance`)
      f.remote.error(failure)
      await drain()
      for (const attempt of failed)
        await expect(attempt.complete()).rejects.toBe(failure)
      expect(f.source.base.size).toBe(0)
      failed.forEach((attempt) => attempt.release())
      reaches.add(`failure-before-acceptance`)
      await f.source.cleanup()
      f.source.startSyncImmediate()

      const shallow = load(1)
      await f.remote.pump(() => false, h.reverse)
      await shallow.complete()
      const graph = dependent(1)
      const permission = {}
      f.remote.scopes.set(permission, { limit: 1 })
      const graphReady = preload(graph)
      await f.remote.pump(() => false, h.reverse)
      await drain()
      expect(graph.status, `native progress: initial dependent stranded`).toBe(
        `ready`,
      )
      await graphReady()

      // One previously absent required fact is a unique causal witness. The
      // same accepted native batch establishes both callers; no page/commit
      // bijection or global-latest rule enters that attribution.
      const model = new LazyReceiptModel()
      let acquiring = false
      const required = ordered(rows, h.descending).at(-1)!
      expect(f.source.base.has(required.id)).toBe(false)
      const ids = [`owner-0`, `owner-1`]
      const controllers = [new AbortController(), new AbortController()]
      const outcomes = new Map<string, string>()
      const accepted: Array<string> = []
      stopBatches = f.observeBatches((batch) => {
        try {
          const establishes =
            acquiring && batch.rows.some((row) => fact(row) === fact(required))
              ? ids
              : []
          model.accept(batch.id, batch.rows.map(fact), establishes)
          if (establishes.length) accepted.push(batch.id)
          const apply = () => model.apply(batch.id)
          if (batch.receipt === true) apply()
          else void batch.receipt.then(apply, () => {})
        } catch (error) {
          receiptFailures.push(error)
        }
      })
      ids.forEach((id) => model.acquire(id, rows.map(fact)))
      hold()
      acquiring = true
      const owners = controllers.map((controller, index) => {
        const attempt = load(h.size, controller.signal)
        void Promise.resolve(attempt.result).then(
          () => {
            outcomes.set(ids[index]!, `success`)
            try {
              model.observe(ids[index]!, `success`)
            } catch (error) {
              receiptFailures.push(error)
            }
          },
          (error: unknown) => {
            const outcome =
              error instanceof Error && error.name === `AbortError`
                ? `canceled`
                : `rejected`
            outcomes.set(ids[index]!, outcome)
            try {
              model.observe(ids[index]!, outcome)
            } catch (modelFailure) {
              receiptFailures.push(modelFailure)
            }
          },
        )
        return attempt
      })
      await f.remote.pump(() => false, h.reverse)
      acquiring = false
      expect(
        accepted.length,
        `native batch lacks unique establishing fact`,
      ).toBe(1)
      expect(outcomes.size, `native load settled before held application`).toBe(
        0,
      )
      reaches.add(`two-owners-share-held-native-receipt`)
      const canceled = h.retiring
      model.abort(ids[canceled]!)
      controllers[canceled]!.abort()
      owners[canceled]!.release()
      const providerError = new Error(`after acceptance`)
      f.remote.error(providerError)
      await drain()
      expect(
        f.errors,
        `native provider failure path was not observed`,
      ).toContain(providerError)
      expect(
        outcomes.has(ids[canceled]!),
        `native canceled owner settled before accepted application`,
      ).toBe(false)
      expect(f.source.base.has(required.id)).toBe(false)
      reaches.add(`error-after-acceptance-with-surviving-owner`)
      await releaseApplication()
      await drain()
      expect(
        outcomes.size,
        `native progress: callers stranded after accepted application`,
      ).toBe(2)
      // A subsequent valid coherent cache observation can recover the native
      // source before the surviving caller settles. Its ordinary error is not
      // terminal: either rejection or successful applied coverage is legal.
      await Promise.allSettled(owners.map((owner) => owner.result))
      await expect(owners[canceled]!.result).rejects.toMatchObject({
        name: `AbortError`,
      })
      assertLazyCoverage([...f.source.base.values()], rows, {}, h.descending)
      expect(outcomes.get(ids[canceled]!)).toBe(`canceled`)
      if (receiptFailures.length) throw receiptFailures[0]
      model.complete()
      stopBatches()
      reaches.add(`accepted-writes-survive-peer-retirement-and-error`)

      // Cleanup terminates the still-owned graph. Its provider failure did not
      // itself grant terminal authority. A new run can serve a fresh graph.
      const terminal = terminalMonitor(graph)
      terminal.cleanup(graph.toArray)
      const cleaning = f.source._lifecycle.cleanup()
      terminal.observe(graph.status, graph.toArray)
      await cleaning
      f.remote.scopes.set(permission, {})
      f.source.startSyncImmediate()
      const recovered = load(1)
      await f.remote.pump(() => false, h.reverse)
      await recovered.complete()
      const fresh = dependent(2)
      const freshReady = preload(fresh)
      await f.remote.pump(() => false, h.reverse)
      await drain()
      expect(fresh.status, `native progress: fresh dependent stranded`).toBe(
        `ready`,
      )
      await freshReady()
      terminal.observe(graph.status, graph.toArray)
      expect(copyLazyRows(fresh.toArray)).toEqual(
        expectedLazyRows(rows, { limit: 2 }, h.descending),
      )

      // A subsequent native update is accepted but held. Cleanup may abandon
      // it; neither its old receipt nor retired callbacks may revive graphs.
      hold()
      const changed = rows.map((row) => ({ ...row, text: `${h.text}:next` }))
      f.remote.change(changed)
      const before = f.receipts.length
      await f.remote.pump(() => false, h.reverse)
      expect(f.receipts.slice(before).some((receipt) => receipt !== true)).toBe(
        true,
      )
      const freshTerminal = terminalMonitor(fresh)
      freshTerminal.cleanup(fresh.toArray)
      cleanupHold = gate()
      const heldCleaning = f.source._lifecycle.cleanup()
      reaches.add(`held-cleanup-after-failure-recovery`)
      const staleCheckpoint = async () => {
        const baseline = {
          base: copyLazyRows([...f.source.base.values()]),
          status: f.source.status,
          statuses: [...f.statuses],
          errors: [...f.errors],
          syncError: f.source.utils.getSyncError(),
          publications: [...f.publications],
        }
        for (const outcome of h.staleErrorFirst
          ? ([`error`, `success`] as const)
          : ([`success`, `error`] as const))
          f.remote.late(outcome)
        await drain()
        expect(
          {
            base: copyLazyRows([...f.source.base.values()]),
            status: f.source.status,
            statuses: [...f.statuses],
            errors: [...f.errors],
            syncError: f.source.utils.getSyncError(),
            publications: [...f.publications],
          },
          `native lifecycle: retired callback retained authority`,
        ).toEqual(baseline)
        terminal.observe(graph.status, graph.toArray)
        freshTerminal.observe(fresh.status, fresh.toArray)
        if (receiptFailures.length) throw receiptFailures[0]
      }
      await staleCheckpoint()
      expect(f.source.status).not.toBe(`cleaned-up`)
      await releaseApplication()
      await staleCheckpoint()
      cleanupHold.resolve()
      await heldCleaning
      f.source.startSyncImmediate()
      const restarted = load(2)
      await f.remote.pump(() => false, h.reverse)
      await restarted.complete()
      await staleCheckpoint()
      const newest = dependent(3)
      const newestReady = preload(newest)
      await f.remote.pump(() => false, h.reverse)
      await drain()
      expect(
        newest.status,
        `native progress: restarted dependent stranded`,
      ).toBe(`ready`)
      await newestReady()
      expect(copyLazyRows(newest.toArray)).toEqual(
        expectedLazyRows(changed, { limit: 3 }, h.descending),
      )
      expect(newest.status).toBe(`ready`)
      terminal.observe(graph.status, graph.toArray)
      freshTerminal.observe(fresh.status, fresh.toArray)
      if (receiptFailures.length) throw receiptFailures[0]
      reaches.add(`fresh-graph-after-held-cleanup-old-graphs-terminal`)
      f.remote.scopes.delete(permission)
    },
    () => {
      stopBatches()
      stopGraphObservers.forEach((stop) => stop())
      cleanupHold?.resolve()
      releases.forEach((release) => release())
    },
    () => releaseApplication(),
    async () => {
      for (const cleanup of graphCleanups) await cleanup()
    },
    () => f.source.cleanup(),
  )
  return reaches
}

it(`composes native failures, shared holds, retirement and terminal restart`, async () => {
  await runOracleCampaign(
    `CONVEX_LAZY_FAILURE_HISTORY_ORACLE`,
    [
      `failure-before-acceptance`,
      `two-owners-share-held-native-receipt`,
      `error-after-acceptance-with-surviving-owner`,
      `accepted-writes-survive-peer-retirement-and-error`,
      `held-cleanup-after-failure-recovery`,
      `fresh-graph-after-held-cleanup-old-graphs-terminal`,
    ] as const,
    (reach, parameters) =>
      fc.assert(
        fc.asyncProperty(grammar, async (h) => {
          reach.beginHistory()
          const states = await runFailureHistory(h)
          for (const state of [
            `failure-before-acceptance`,
            `two-owners-share-held-native-receipt`,
            `error-after-acceptance-with-surviving-owner`,
            `accepted-writes-survive-peer-retirement-and-error`,
            `held-cleanup-after-failure-recovery`,
            `fresh-graph-after-held-cleanup-old-graphs-terminal`,
          ] as const) {
            expect(states.has(state)).toBe(true)
            reach.reach(state)
          }
        }),
        { numRuns: oracleRuns(40), ...parameters },
      ),
    { fixedSeed: 20261027 },
  )
}, 60000)

it(`rejects old graphs recovering or changing after cleanup`, () => {
  const row = { id: `one`, rank: 1, text: `authored` }
  const model = new LazyTerminalGraphModel()
  model.cleanup([row])
  model.observe(`crashed`, [row])
  expect(() => model.observe(`ready`, [row])).toThrow(`old graph recovered`)
  expect(() => model.observe(`crashed`, [{ ...row, text: `new run` }])).toThrow(
    `dead graph published`,
  )
})

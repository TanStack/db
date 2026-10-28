/**
 * Abort ends cancellable request work. Without accepted writes, the adapter's
 * load must reject without a provider response. Old success/error callbacks
 * cannot alter a later successful replay or resurrect its excluded rows.
 * Authority: #2269 comment 6448490334, LoadSubsetOptions.signal, LoadSubsetFn,
 * and publication laws 7/9. LazyVersionModel owns the public-history judgment;
 * expectedLazyRows owns the promised window, never the pager's retained base.
 *
 * Contract reconciliation: this branch still waits for uncancelable baselines
 * during core replay. This family supplies cancellable native work with zero
 * accepted receipts. It therefore checks the common adapter obligation without
 * changing that older core law or withdrawing already accepted writes. The
 * receipt owners retain accepted-work and cleanup-abandonment coverage.
 *
 * Both controlled SDK shapes receive abort before any response, a withheld
 * response delivered with no demand, fresh acquisition, then two real same-run
 * core truncate replays with disjoint source keys. After each replay, retired
 * transport callbacks deliver both success and error in generated order. Every
 * graph callback is checked, and all stale errors are retained. The fixture
 * exposes the real truncate control; Convex does not initiate that input itself.
 *
 * Grammar: 12–18 rows, page sizes 2–3, windows 2–4, short text, either stale
 * callback order and either drain order. Removing no-demand delivery loses
 * cancellation's write boundary; removing replay loses subsequent authority;
 * disjoint keys distinguish resurrection from harmless repeated equal rows.
 * Limits: controlled SDK caches, no real-provider emission claim, no arbitrary
 * adapter ignoring abort, accepted-write cancellation or prospective #2168
 * immediate-core-publication law.
 */
import { createLiveQueryCollection } from '@tanstack/db'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import { runOracleCampaign } from '../../db/tests/oracle-campaign'
import { withTestCleanup } from './helpers'
import { lazyFixture } from './lazy-paging-driver'
import { lazyOracleRuns, receiveBothSdks } from './lazy-paging-campaign'
import { expectedLazyRows } from './lazy-paging-model-oracle'
import { LazyVersionModel } from './lazy-paging-version-model-oracle'
import type { LazyRow } from './lazy-paging-model-oracle'

const grammar = fc.record({
  size: fc.integer({ min: 12, max: 18 }),
  pageSize: fc.integer({ min: 2, max: 3 }),
  limit: fc.integer({ min: 2, max: 4 }),
  text: fc.string({ maxLength: 10 }),
  errorFirst: fc.boolean(),
  reverse: fc.boolean(),
})
type History = typeof grammar extends fc.Arbitrary<infer T> ? T : never
const drain = async () => {
  for (let turn = 0; turn < 60; turn++) await Promise.resolve()
}

async function receive(h: History, sdk: `javascript` | `react`) {
  const rows = (revision: number): Array<LazyRow> =>
    Array.from({ length: h.size }, (_, rank) => ({
      id: `revision-${revision}-${rank}`,
      rank,
      text: `${h.text}:${revision}`,
    }))
  const f = lazyFixture(
    rows(0),
    h.pageSize,
    false,
    `none`,
    false,
    undefined,
    sdk,
  )
  const versions = new LazyVersionModel(`sequence`)
  const failures: Array<unknown> = []
  const reaches = new Set<string>()
  let outcome: string | undefined
  const controller = new AbortController()
  const canceled = f.load({ limit: h.limit }, controller.signal)
  const cancellation = Promise.resolve(canceled.result).then(
    () => {
      outcome = `success`
    },
    (error: unknown) => {
      outcome = error instanceof Error ? error.name : `unknown`
    },
  )
  let graph: ReturnType<typeof createGraph> | undefined
  let graphObserver: { unsubscribe: () => void } | undefined
  let monitor = false
  const read = () =>
    graph!.toArray.map(({ id, rank, text }) => ({ id, rank, text }))
  function createGraph() {
    return createLiveQueryCollection((q) =>
      q
        .from({ row: f.source })
        .orderBy(({ row }) => row.rank, `asc`)
        .limit(h.limit)
        .select(({ row }) => ({ id: row.id, rank: row.rank, text: row.text })),
    )
  }
  const observe = () => {
    if (!monitor) return
    try {
      versions.observe(read())
    } catch (error) {
      failures.push(error)
    }
  }
  const checkpoint = () => {
    if (failures.length) throw failures[0]
    expect(outcome, `aborted request outcome changed`).toBe(`AbortError`)
    expect(
      f.errors,
      `obsolete error reached current sync: ${f.errors.map(String).join(`; `)}`,
    ).toEqual([])
    expect(f.source.utils.getSyncError()).toBeUndefined()
    expect(f.remote.obsoleteReads, `retired watch read its old cache`).toBe(0)
  }
  const scopeOwner = {}
  await withTestCleanup(
    async () => {
      await drain()
      expect(f.remote.slots.some((slot) => slot.active && !slot.current)).toBe(
        true,
      )
      const before = f.batches.length
      controller.abort()
      await drain()
      expect(outcome, `abort waited for absent provider delivery`).toBe(
        `AbortError`,
      )
      expect(f.batches).toHaveLength(before)
      await cancellation
      reaches.add(`abort-before-response-without-acceptance`)
      await f.remote.pump(() => false, h.reverse)
      expect(f.source.base.size, `canceled load installed late rows`).toBe(0)
      expect(f.batches).toHaveLength(before)
      reaches.add(`late-response-with-no-demand`)
      // Explicit window retry may lawfully request an authoritative full-source
      // repair. This receiver judges cancellation/publication, not bounded work.
      f.remote.scopes.set(scopeOwner, {})
      graph = createGraph()
      graphObserver = graph.subscribeChanges(observe, {
        includeInitialState: false,
      })
      const preload = graph.preload()
      await f.remote.pump(() => false, h.reverse)
      await preload
      versions.offer(expectedLazyRows(rows(0), { limit: h.limit }))
      monitor = true
      observe()
      checkpoint()
      for (const revision of [1, 2]) {
        versions.offer(expectedLazyRows(rows(revision), { limit: h.limit }))
        f.remote.change(rows(revision))
        // SDK caches advance coherently before callbacks. Replay itself must
        // re-read them; the driver does not install any Collection rows.
        f.remote.installCaches()
        await f.truncateSource()
        const replay = Promise.resolve(
          graph.utils.setWindow({ limit: h.limit }),
        )
        void replay.catch(() => undefined)
        await f.remote.pump(() => false, h.reverse, checkpoint)
        await replay
        expect(graph.status).toBe(`ready`)
        expect(read(), `successful replay window`).toEqual(
          expectedLazyRows(rows(revision), { limit: h.limit }),
        )
        expect(
          [...f.source.base.keys()].every((key) =>
            String(key).startsWith(`revision-${revision}-`),
          ),
        ).toBe(true)
        expect(
          f.remote.slots.filter((slot) => !slot.active).length,
        ).toBeGreaterThan(0)
        for (const late of h.errorFirst
          ? ([`error`, `success`] as const)
          : ([`success`, `error`] as const)) {
          f.remote.late(late)
          await drain()
          observe()
          checkpoint()
          expect(graph.status).toBe(`ready`)
          expect(read(), `late ${late} changed replay`).toEqual(
            expectedLazyRows(rows(revision), { limit: h.limit }),
          )
          reaches.add(`late-${late}-after-replay`)
        }
        reaches.add(`disjoint-replay-${revision}`)
      }
    },
    () => {
      controller.abort()
      canceled.release()
    },
    () => cancellation,
    () => {
      monitor = false
      graphObserver?.unsubscribe()
    },
    () => graph?.cleanup(),
    () => f.source.cleanup(),
    () => f.stopObserving(),
  )
  return reaches
}
const states = [
  `abort-before-response-without-acceptance`,
  `late-response-with-no-demand`,
  `late-success-after-replay`,
  `late-error-after-replay`,
  `disjoint-replay-1`,
  `disjoint-replay-2`,
  `javascript`,
  `react`,
] as const
it(`fences aborted work from later successful same-run replay`, async () => {
  await runOracleCampaign(
    `CONVEX_ABORT_REPLAY_ORACLE`,
    states,
    (reach, parameters) =>
      fc.assert(
        fc.asyncProperty(grammar, async (h) => {
          reach.beginHistory()
          for (const [sdk, observed] of await receiveBothSdks((kind) =>
            receive(h, kind),
          )) {
            for (const state of states)
              if (observed.has(state)) reach.reach(state)
            reach.reach(sdk)
          }
        }),
        { numRuns: lazyOracleRuns(30), ...parameters },
      ),
    { fixedSeed: 20261030 },
  )
})

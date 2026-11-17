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
import { expect } from 'vitest'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { oracleProperty } from '../../db/tests/oracle-property'
import { withTestCleanup } from './helpers'
import { lazyFixture } from './lazy-paging-driver'
import { lazyOracleBaseRuns, receiveBothSdks } from './lazy-paging-campaign'
import { expectedLazyRows } from './lazy-paging-model-oracle'
import { LazyVersionModel } from './lazy-paging-version-model-oracle'
import type { LazyRow } from './lazy-paging-model-oracle'

type AssertionHistory<T> = T extends fc.Arbitrary<infer H> ? H : never
type AssertionReach = {
  beginHistory: () => void
  reach: (state: string) => void
}

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
    oracleAssertion(
      `lazy-paging-abort-replay-oracle.property.test.ts:115:toBe`,
      () =>
        expect(outcome, `aborted request outcome changed`).toBe(`AbortError`),
    )
    oracleAssertion(
      `lazy-paging-abort-replay-oracle.property.test.ts:116:toEqual`,
      () =>
        expect(
          f.errors,
          `obsolete error reached current sync: ${f.errors.map(String).join(`; `)}`,
        ).toEqual([]),
    )
    oracleAssertion(
      `lazy-paging-abort-replay-oracle.property.test.ts:120:toBeUndefined`,
      () => expect(f.source.utils.getSyncError()).toBeUndefined(),
    )
    oracleAssertion(
      `lazy-paging-abort-replay-oracle.property.test.ts:121:toBe`,
      () =>
        expect(f.remote.obsoleteReads, `retired watch read its old cache`).toBe(
          0,
        ),
    )
  }
  const scopeOwner = {}
  await withTestCleanup(
    async () => {
      await drain()
      oracleAssertion(
        `lazy-paging-abort-replay-oracle.property.test.ts:127:toBe`,
        () =>
          expect(
            f.remote.slots.some((slot) => slot.active && !slot.current),
          ).toBe(true),
      )
      const before = f.batches.length
      controller.abort()
      await drain()
      oracleAssertion(
        `lazy-paging-abort-replay-oracle.property.test.ts:133:toBe`,
        () =>
          expect(outcome, `abort waited for absent provider delivery`).toBe(
            `AbortError`,
          ),
      )
      oracleAssertion(
        `lazy-paging-abort-replay-oracle.property.test.ts:136:toHaveLength`,
        () => expect(f.batches).toHaveLength(before),
      )
      await cancellation
      reaches.add(`abort-before-response-without-acceptance`)
      await f.remote.pump(() => false, h.reverse)
      oracleAssertion(
        `lazy-paging-abort-replay-oracle.property.test.ts:140:toBe`,
        () =>
          expect(f.source.base.size, `canceled load installed late rows`).toBe(
            0,
          ),
      )
      oracleAssertion(
        `lazy-paging-abort-replay-oracle.property.test.ts:141:toHaveLength`,
        () => expect(f.batches).toHaveLength(before),
      )
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
        oracleAssertion(
          `lazy-paging-abort-replay-oracle.property.test.ts:170:toBe`,
          () => expect(graph!.status).toBe(`ready`),
        )
        oracleAssertion(
          `lazy-paging-abort-replay-oracle.property.test.ts:171:toEqual`,
          () =>
            expect(read(), `successful replay window`).toEqual(
              expectedLazyRows(rows(revision), { limit: h.limit }),
            ),
        )
        oracleAssertion(
          `lazy-paging-abort-replay-oracle.property.test.ts:174:toBe`,
          () =>
            expect(
              [...f.source.base.keys()].every((key) =>
                String(key).startsWith(`revision-${revision}-`),
              ),
            ).toBe(true),
        )
        oracleAssertion(
          `lazy-paging-abort-replay-oracle.property.test.ts:179:toBeGreaterThan`,
          () =>
            expect(
              f.remote.slots.filter((slot) => !slot.active).length,
            ).toBeGreaterThan(0),
        )
        for (const late of h.errorFirst
          ? ([`error`, `success`] as const)
          : ([`success`, `error`] as const)) {
          f.remote.late(late)
          await drain()
          observe()
          checkpoint()
          oracleAssertion(
            `lazy-paging-abort-replay-oracle.property.test.ts:189:toBe`,
            () => expect(graph!.status).toBe(`ready`),
          )
          oracleAssertion(
            `lazy-paging-abort-replay-oracle.property.test.ts:190:toEqual`,
            () =>
              expect(read(), `late ${late} changed replay`).toEqual(
                expectedLazyRows(rows(revision), { limit: h.limit }),
              ),
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

const convex_abort_replayHistory = grammar
// This existing helper retains the independent reference, production lifecycle,
// comparison cuts and assertions. The native adapter only transports its judgment.
async function convex_abort_replayJudgment(
  h: AssertionHistory<typeof convex_abort_replayHistory>,
  reach: AssertionReach,
) {
  reach.beginHistory()
  for (const [sdk, observed] of await receiveBothSdks((kind) =>
    receive(h, kind),
  )) {
    for (const state of states) if (observed.has(state)) reach.reach(state)
    reach.reach(sdk)
  }
}

oracleProperty({
  id: `convex.abort-replay`,
  law: {
    statement: `fences aborted work from later successful same-run replay`,
    authority: `docs/collections/convex-collection.md; the existing model and contract stated above and named in docs/contributing/oracle-coverage.md.`,
    limits: `The unchanged bounded grammar, receiving paths and observation cuts described above; registration migration adds no product coverage.`,
  },
  owns: [`src/paginated-options.ts#convexPaginatedCollectionOptions`],
  histories: {
    arbitrary: convex_abort_replayHistory,
    runs: lazyOracleBaseRuns(30),
    fixedSeeds: [20261030],
    states: states,
    constructed: [
      {
        name: `existing constructive history`,
        enters: states,
        build: (generated) => generated,
      },
    ],
  },
  resolve: (generated) => ({ history: generated }),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
  driver: async (plan, observe) =>
    recordAssertionJudgment(`convex.abort-replay`, plan, observe, () =>
      convex_abort_replayJudgment(plan.history, {
        beginHistory: () => {},
        reach: (state) => observe(`reach`, state),
      }),
    ),
  timeout: 120000,
})

/**
 * Lazy page acquisitions refine the laws in lazy-paging-model-oracle.ts.
 * Five families use the same generated history and 60-run fixed/random budget:
 * values/scopes; successor work; publication/repair; acquisition/lifecycle;
 * publication-reentrant receipts.
 * Each has its own predeclared reach ledger and direct SEED/PATH replay.
 * Drivers are real Collection/ordered live-query boundaries plus the controlled
 * transport in lazy-paging-driver.ts. Expectations never use pager internals.
 *
 * Grammar: finite ranks (ties included), stable IDs, page partitions, offset,
 * forward/reverse transitions and generated finite limit-move suffixes (work
 * family). Shared arbitrary fields not used by a family earn it no coverage. The
 * constructive scenes below reconstruct the named witnesses before suffixes.
 * Removing ties loses scope-vs-display; removing holds loses early settlement;
 * removing cleanup/restart loses run authority. Unsupported orders/filters are
 * a nearby negative. The receipt family supplies two actual batches through
 * publication reentry. Arbitrary progressive multi-commit acquisitions and
 * delayed cancellation remain with core's receipt/replay owners.
 * Quiescent provider drains detect finite stalls; the fixture turn guard is
 * diagnostic and does not claim arbitrary nonquiescent termination coverage.
 */
import fc from 'fast-check'
import {
  IR,
  createCollection,
  createLiveQueryCollection,
  createTransaction,
} from '@tanstack/db'
import { expect, it } from 'vitest'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { oracleProperty } from '../../db/tests/oracle-property'
import { oracleRoute } from '../../db/tests/oracle-config'
import { convexPaginatedCollectionOptions } from '../src/index'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { withTestCleanup } from './helpers'
import {
  lazyFixture,
  lazyOrder,
  lazyQuery,
  lazyRequest,
} from './lazy-paging-driver'
import {
  assertLazyCoverage,
  assertLazyPublications,
  copyLazyRows,
  deliveredScopeComplete,
  expectedLazyRows,
  ordered,
} from './lazy-paging-model-oracle'
import type { LazyRow } from './lazy-paging-model-oracle'

type AssertionHistory<T> = T extends fc.Arbitrary<infer H> ? H : never
type AssertionReach = {
  beginHistory: () => void
  reach: (state: string) => void
}

declareOracle({
  owns: [`src/paginated-options.ts#convexPaginatedCollectionOptions`],
})

const history = fc.record({
  size: fc.integer({ min: 16, max: 32 }),
  pageSize: fc.integer({ min: 1, max: 5 }),
  offset: fc.integer({ min: 1, max: 5 }),
  limit: fc.integer({ min: 1, max: 5 }),
  descending: fc.boolean(),
  reverse: fc.boolean(),
  texts: fc.array(fc.string({ maxLength: 8 }), {
    minLength: 32,
    maxLength: 32,
  }),
  suffix: fc.array(fc.integer({ min: 1, max: 12 }), { maxLength: 8 }),
})
type History = typeof history extends fc.Arbitrary<infer T> ? T : never
function rowsFor(h: History, ties = true): Array<LazyRow> {
  return Array.from({ length: h.size }, (_, i) => ({
    id: `r${String(i).padStart(2, `0`)}`,
    rank: ties ? Math.floor(i / 2) : i,
    text: h.texts[i]!,
  }))
}
const fixedSeed = 20261026

const convex_lazy_valuesHistory = history
// This existing helper retains the independent reference, production lifecycle,
// comparison cuts and assertions. The native adapter only transports its judgment.
async function convex_lazy_valuesJudgment(
  h: AssertionHistory<typeof convex_lazy_valuesHistory>,
  reach: AssertionReach,
) {
  reach.beginHistory()
  const rows = rowsFor(h)
  const order = ordered(rows, h.descending)
  const scopes = [
    { offset: h.offset + h.pageSize, limit: h.limit },
    { equal: order[3]!.rank },
    { after: order[3]!.rank, limit: h.limit },
    {},
  ]
  for (const [i, scope] of scopes.entries()) {
    const f = lazyFixture(rows, h.pageSize, h.descending)
    await withTestCleanup(
      async () => {
        const load = f.load(scope)
        await f.remote.pump(() => false, h.reverse)
        await load.complete()
        const actual = [...f.source.values()]
        oracleAssertion(`lazy-paging-oracle.property.test.ts:103:toEqual`, () =>
          expect(
            expectedLazyRows(actual, scope, h.descending),
            `lazy exact scope ${i}`,
          ).toEqual(expectedLazyRows(rows, scope, h.descending)),
        )
        assertLazyCoverage(actual, rows, scope, h.descending)
        if (i === 0)
          oracleAssertion(
            `lazy-paging-oracle.property.test.ts:108:toBeGreaterThan`,
            () => expect(f.remote.successorStarts).toBeGreaterThan(0),
          )
        reach.reach(
          (
            [
              `offset-crosses-page`,
              `scoped-unlimited-tie`,
              `continuation-scope`,
              `whole-source-exhausted`,
            ] as const
          )[i]!,
        )
        load.release()
      },
      () => f.source.cleanup(),
    )
  }
  for (const split of [`required`, `recommended`] as const) {
    const f = lazyFixture(rows, 4, h.descending, split, true)
    await withTestCleanup(
      async () => {
        const load = f.load({ limit: 6 })
        await f.remote.pump(() => false, h.reverse)
        await load.complete()
        assertLazyCoverage(
          [...f.source.values()],
          rows,
          { limit: 6 },
          h.descending,
        )
        oracleAssertion(`lazy-paging-oracle.property.test.ts:137:toBe`, () =>
          expect(
            f.remote.slots.some(
              (slot) =>
                slot.current?.pageStatus ===
                (split === `required` ? `SplitRequired` : `SplitRecommended`),
            ),
          ).toBe(true),
        )
        reach.reach(
          split === `required` ? `required-split` : `recommended-split`,
        )
        oracleAssertion(`lazy-paging-oracle.property.test.ts:149:toBe`, () =>
          expect(
            f.remote.slots.some(
              (slot) =>
                slot.current &&
                !slot.current.isDone &&
                slot.current.page.length < slot.opts.numItems,
            ),
          ).toBe(true),
        )
        reach.reach(`short-nonterminal`)
        load.release()
      },
      () => f.source.cleanup(),
    )
  }
  const capability = lazyFixture(rows, h.pageSize, h.descending)
  await withTestCleanup(
    async () => {
      const valid = lazyRequest({ limit: h.limit }, h.descending)
      const rank = new IR.PropRef([`rank`])
      const invalid = [
        { ...valid, orderBy: lazyOrder(!h.descending) },
        {
          ...valid,
          where: new IR.Func(`gt`, [rank, new IR.Value(h.offset)]),
        },
        { ...valid, offset: -h.offset },
        {
          ...valid,
          cursor: {
            whereFrom: new IR.Func(`eq`, [rank, new IR.Value(h.offset)]),
            whereCurrent: new IR.Func(`eq`, [rank, new IR.Value(h.offset)]),
          },
        },
      ]
      for (const request of invalid) {
        await oracleAssertion(
          `lazy-paging-oracle.property.test.ts:190:toBeInstanceOf`,
          () =>
            expect(
              capability.source._sync.loadSubset(request),
            ).rejects.toBeInstanceOf(Error),
        )
        capability.source._sync.unloadSubset(request)
      }
      oracleAssertion(
        `lazy-paging-oracle.property.test.ts:195:toHaveLength`,
        () => expect(capability.remote.slots).toHaveLength(0),
      )
      reach.reach(`unsupported-shape-rejected`)
      const peer = capability.load({ limit: h.limit })
      await capability.remote.pump()
      await peer.complete()
      for (const request of invalid)
        capability.source._sync.unloadSubset(request)
      assertLazyCoverage(
        [...capability.source.values()],
        rows,
        { limit: h.limit },
        h.descending,
      )
      reach.reach(`rejected-unload-preserves-peer`)
      peer.release()
    },
    () => capability.source.cleanup(),
  )
  const empty = lazyFixture([], h.pageSize, h.descending)
  await withTestCleanup(
    async () => {
      const load = empty.load({ limit: h.limit })
      await empty.remote.pump()
      await load.complete()
      oracleAssertion(`lazy-paging-oracle.property.test.ts:219:toEqual`, () =>
        expect([...empty.source.values()]).toEqual([]),
      )
      reach.reach(`authoritative-empty`)
      load.release()
    },
    () => empty.source.cleanup(),
  )
}

oracleProperty({
  id: `convex.lazy-values`,
  law: {
    statement: `matches exact finite, offset, tie, continuation, whole and empty scopes`,
    authority: `docs/collections/convex-collection.md; the existing model and contract stated above and named in docs/contributing/oracle-coverage.md.`,
    limits: `The unchanged bounded grammar, receiving paths and observation cuts described above; registration migration adds no product coverage.`,
    owner: `Convex collection integration`,
  },
  histories: {
    arbitrary: convex_lazy_valuesHistory,
    runs: 60,
    fixedSeeds: [fixedSeed],
    states: [
      `offset-crosses-page`,
      `scoped-unlimited-tie`,
      `continuation-scope`,
      `whole-source-exhausted`,
      `authoritative-empty`,
      `required-split`,
      `recommended-split`,
      `short-nonterminal`,
      `unsupported-shape-rejected`,
      `rejected-unload-preserves-peer`,
    ] as const,
    constructed: [
      {
        name: `existing constructive history`,
        enters: [
          `offset-crosses-page`,
          `scoped-unlimited-tie`,
          `continuation-scope`,
          `whole-source-exhausted`,
          `authoritative-empty`,
          `required-split`,
          `recommended-split`,
          `short-nonterminal`,
          `unsupported-shape-rejected`,
          `rejected-unload-preserves-peer`,
        ] as const,
        build: (generated) => generated,
      },
    ],
  },
  resolve: (generated) => ({ history: generated }),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
  driver: async (plan, observe) =>
    recordAssertionJudgment(`convex.lazy-values`, plan, observe, () =>
      convex_lazy_valuesJudgment(plan.history, {
        beginHistory: () => {},
        reach: (state) => observe(`reach`, state),
      }),
    ),
  timeout: 60000,
})

const convex_lazy_workHistory = history
// This existing helper retains the independent reference, production lifecycle,
// comparison cuts and assertions. The native adapter only transports its judgment.
async function convex_lazy_workJudgment(
  h: AssertionHistory<typeof convex_lazy_workHistory>,
  reach: AssertionReach,
) {
  reach.beginHistory()
  const rows = rowsFor(h, false)
  const f = lazyFixture(rows, 4, h.descending)
  await withTestCleanup(
    async () => {
      await f.remote.pump()
      oracleAssertion(
        `lazy-paging-oracle.property.test.ts:271:toHaveLength`,
        () =>
          expect(
            f.remote.slots,
            `lazy work: no row-range without demand`,
          ).toHaveLength(0),
      )
      reach.reach(`no-demand`)
      const zero = f.load({ limit: 0 })
      await zero.complete()
      oracleAssertion(
        `lazy-paging-oracle.property.test.ts:278:toHaveLength`,
        () => expect(f.remote.slots).toHaveLength(0),
      )
      reach.reach(`zero-limit`)
      zero.release()
      const a = f.load({ limit: 3 })
      let duplicateSettled = false
      const duplicate = f.source._sync.loadSubset(a.request)
      void Promise.resolve(duplicate).then(() => {
        duplicateSettled = true
      })
      await f.remote.pump()
      await a.complete()
      oracleAssertion(`lazy-paging-oracle.property.test.ts:289:toBe`, () =>
        expect(
          duplicateSettled,
          `lazy progress: duplicate pending attempt stranded`,
        ).toBe(true),
      )
      await duplicate
      reach.reach(`same-object-pending-attempts`)
      assertLazyCoverage(
        [...f.source.values()],
        rows,
        { limit: 3 },
        h.descending,
      )
      oracleAssertion(
        `lazy-paging-oracle.property.test.ts:301:toBeLessThan`,
        () => expect(f.source.size).toBeLessThan(rows.length),
      )
      reach.reach(`finite-with-unread-tail`)
      const b = f.load({ limit: 6 })
      await f.remote.pump(
        (slot) => slot.opts.cursor !== null && slot.opts.endCursor == null,
      )
      // Newly held deeper work must not make already applied shallow coverage
      // unavailable. This cut supplies no delayed cancellation premise.
      let shallow = false
      const peer = f.load({ limit: 3 })
      void Promise.resolve(peer.result).then(() => {
        shallow = true
      })
      await f.remote.pump(() => true)
      oracleAssertion(`lazy-paging-oracle.property.test.ts:316:toBe`, () =>
        expect(shallow, `lazy shallow read blocked by deeper work`).toBe(true),
      )
      reach.reach(`shallow-read-during-growth`)
      a.release()
      peer.release()
      await f.remote.pump()
      await b.complete()
      assertLazyCoverage(
        [...f.source.values()],
        rows,
        { limit: 6 },
        h.descending,
      )
      reach.reach(`gap-free-growth-across-page`)
      reach.reach(`peer-survives-release`)
      for (const limit of h.suffix) {
        const next = f.load({ limit })
        await f.remote.pump()
        await next.complete()
        assertLazyCoverage(
          [...f.source.values()],
          rows,
          { limit },
          h.descending,
        )
        next.release()
      }
      b.release()
    },
    () => f.source.cleanup(),
  )
}

oracleProperty({
  id: `convex.lazy-work`,
  law: {
    statement: `starts no unneeded ranges and preserves gap-free growth with healthy peers`,
    authority: `docs/collections/convex-collection.md; the existing model and contract stated above and named in docs/contributing/oracle-coverage.md.`,
    limits: `The unchanged bounded grammar, receiving paths and observation cuts described above; registration migration adds no product coverage.`,
    owner: `Convex collection integration`,
  },
  histories: {
    arbitrary: convex_lazy_workHistory,
    runs: 60,
    fixedSeeds: [fixedSeed],
    states: [
      `no-demand`,
      `zero-limit`,
      `finite-with-unread-tail`,
      `gap-free-growth-across-page`,
      `shallow-read-during-growth`,
      `peer-survives-release`,
      `same-object-pending-attempts`,
    ] as const,
    constructed: [
      {
        name: `existing constructive history`,
        enters: [
          `no-demand`,
          `zero-limit`,
          `finite-with-unread-tail`,
          `gap-free-growth-across-page`,
          `shallow-read-during-growth`,
          `peer-survives-release`,
          `same-object-pending-attempts`,
        ] as const,
        build: (generated) => generated,
      },
    ],
  },
  resolve: (generated) => ({ history: generated }),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
  driver: async (plan, observe) =>
    recordAssertionJudgment(`convex.lazy-work`, plan, observe, () =>
      convex_lazy_workJudgment(plan.history, {
        beginHistory: () => {},
        reach: (state) => observe(`reach`, state),
      }),
    ),
  timeout: 60000,
})

const convex_lazy_publicationHistory = history
// This existing helper retains the independent reference, production lifecycle,
// comparison cuts and assertions. The native adapter only transports its judgment.
async function convex_lazy_publicationJudgment(
  h: AssertionHistory<typeof convex_lazy_publicationHistory>,
  reach: AssertionReach,
) {
  reach.beginHistory()
  let rows = rowsFor(h, false)
  const f = lazyFixture(rows, 2, h.descending)
  const permission = {}
  f.remote.scopes.set(permission, { limit: 3 })
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: f.source })
      .orderBy(({ row }) => row.rank, h.descending ? `desc` : `asc`)
      .orderBy(({ row }) => row.id, h.descending ? `desc` : `asc`)
      .select(({ row }) => row)
      .limit(3),
  )
  const trace: Array<Array<LazyRow>> = []
  const subscription = live.subscribeChanges(() =>
    trace.push(copyLazyRows(live.toArray)),
  )
  const read = () => {
    trace.push(copyLazyRows(live.toArray))
  }
  await withTestCleanup(
    async () => {
      const ready = live.preload()
      void ready.catch(() => {})
      await f.remote.pump(
        (slot) => slot.opts.cursor !== null && slot.opts.endCursor == null,
        h.reverse,
        read,
      )
      oracleAssertion(`lazy-paging-oracle.property.test.ts:412:toEqual`, () =>
        expect(copyLazyRows(live.toArray)).toEqual([]),
      )
      reach.reach(`pending-initial-window`)
      await f.remote.pump(() => false, h.reverse, read)
      await ready
      const initial = expectedLazyRows(rows, { limit: 3 }, h.descending)
      oracleAssertion(`lazy-paging-oracle.property.test.ts:417:toEqual`, () =>
        expect(copyLazyRows(live.toArray)).toEqual(initial),
      )
      assertLazyPublications(trace, [], initial)
      trace.length = 0
      f.remote.scopes.set(permission, { offset: 3, limit: 4 })
      const moved = Promise.resolve(
        live.utils.setWindow({ offset: 3, limit: 4 }),
      )
      void moved.catch(() => {})
      await f.remote.pump(
        (slot) => slot.opts.cursor !== null && slot.opts.endCursor == null,
        h.reverse,
        read,
      )
      oracleAssertion(`lazy-paging-oracle.property.test.ts:431:toEqual`, () =>
        expect(copyLazyRows(live.toArray)).toEqual(initial),
      )
      reach.reach(`pending-window-move`)
      await f.remote.pump(() => false, h.reverse, read)
      await moved
      const next = expectedLazyRows(rows, { offset: 3, limit: 4 }, h.descending)
      oracleAssertion(`lazy-paging-oracle.property.test.ts:440:toEqual`, () =>
        expect(copyLazyRows(live.toArray)).toEqual(next),
      )
      assertLazyPublications(trace, initial, next)
      trace.length = 0
      // Remove every currently acquired row. Existing bounded intervals become
      // empty; only a successor can supply the required replacement window.
      const retained = new Set([...f.source.values()].map((row) => row.id))
      rows = rows.filter((row) => !retained.has(row.id))
      f.remote.change(rows)
      await f.remote.pump(
        (slot) => slot.opts.cursor !== null && slot.opts.endCursor == null,
        h.reverse,
        read,
      )
      oracleAssertion(`lazy-paging-oracle.property.test.ts:456:toEqual`, () =>
        expect(copyLazyRows(live.toArray)).toEqual(next),
      )
      reach.reach(`pending-boundary-repair`)
      await f.remote.pump(() => false, h.reverse, read)
      oracleAssertion(`lazy-paging-oracle.property.test.ts:459:toEqual`, () =>
        expect(copyLazyRows(live.toArray)).toEqual(
          expectedLazyRows(rows, { offset: 3, limit: 4 }, h.descending),
        ),
      )
      assertLazyPublications(
        trace,
        next,
        expectedLazyRows(rows, { offset: 3, limit: 4 }, h.descending),
      )
      reach.reach(`completed-boundary-refill`)
      reach.reach(`coherent-cache-before-callback`)
      trace.length = 0
      const prior = copyLazyRows(live.toArray)
      rows = rows.map((row) => ({
        ...row,
        text: `${row.text} refreshed`,
      }))
      f.remote.change(rows)
      f.remote.installCaches()
      let refreshed = false
      const refetch = f.load({ offset: 3, limit: 4 }, undefined, true)
      void Promise.resolve(refetch.result).then(() => {
        refreshed = true
      })
      // No callback runs: explicit refetch must read installed caches.
      await f.remote.pump(() => true, h.reverse, read)
      oracleAssertion(`lazy-paging-oracle.property.test.ts:484:toBe`, () =>
        expect(refreshed, `lazy refetch left a coherent cache unread`).toBe(
          true,
        ),
      )
      await refetch.complete()
      const fresh = expectedLazyRows(
        rows,
        { offset: 3, limit: 4 },
        h.descending,
      )
      oracleAssertion(`lazy-paging-oracle.property.test.ts:494:toEqual`, () =>
        expect(copyLazyRows(live.toArray)).toEqual(fresh),
      )
      assertLazyPublications(trace, prior, fresh)
      reach.reach(`refetch-cache-before-callback`)
      refetch.release()
    },
    () => subscription.unsubscribe(),
    () => live.cleanup(),
    () => f.source.cleanup(),
  )
}

oracleProperty({
  id: `convex.lazy-publication`,
  law: {
    statement: `publishes complete initial, moved and repaired live windows`,
    authority: `docs/collections/convex-collection.md; the existing model and contract stated above and named in docs/contributing/oracle-coverage.md.`,
    limits: `The unchanged bounded grammar, receiving paths and observation cuts described above; registration migration adds no product coverage.`,
    owner: `Convex collection integration`,
  },
  histories: {
    arbitrary: convex_lazy_publicationHistory,
    runs: 60,
    fixedSeeds: [fixedSeed],
    states: [
      `pending-initial-window`,
      `pending-window-move`,
      `pending-boundary-repair`,
      `completed-boundary-refill`,
      `coherent-cache-before-callback`,
      `refetch-cache-before-callback`,
    ] as const,
    constructed: [
      {
        name: `existing constructive history`,
        enters: [
          `pending-initial-window`,
          `pending-window-move`,
          `pending-boundary-repair`,
          `completed-boundary-refill`,
          `coherent-cache-before-callback`,
          `refetch-cache-before-callback`,
        ] as const,
        build: (generated) => generated,
      },
    ],
  },
  resolve: (generated) => ({ history: generated }),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
  driver: async (plan, observe) =>
    recordAssertionJudgment(`convex.lazy-publication`, plan, observe, () =>
      convex_lazy_publicationJudgment(plan.history, {
        beginHistory: () => {},
        reach: (state) => observe(`reach`, state),
      }),
    ),
  timeout: 60000,
})

const convex_lazy_lifecycleHistory = history
// This existing helper retains the independent reference, production lifecycle,
// comparison cuts and assertions. The native adapter only transports its judgment.
async function convex_lazy_lifecycleJudgment(
  h: AssertionHistory<typeof convex_lazy_lifecycleHistory>,
  reach: AssertionReach,
) {
  reach.beginHistory()
  const rows = rowsFor(h, false)
  let releaseBlock = () => {}
  let cleanDependent = async () => {}
  let cleanFresh = async () => {}
  let finishCleanup!: () => void
  const cleanupGate = new Promise<void>((resolve) => {
    finishCleanup = resolve
  })
  const f = lazyFixture(
    rows,
    h.pageSize,
    h.descending,
    `none`,
    false,
    () => cleanupGate,
  )
  await withTestCleanup(
    async () => {
      const controller = new AbortController()
      const canceled = f.load({ limit: 3 }, controller.signal)
      let rejected = false
      void Promise.resolve(canceled.result).catch(() => {
        rejected = true
      })
      controller.abort()
      await f.remote.pump()
      oracleAssertion(`lazy-paging-oracle.property.test.ts:562:toBe`, () =>
        expect(rejected).toBe(true),
      )
      oracleAssertion(`lazy-paging-oracle.property.test.ts:563:toBe`, () =>
        expect(f.source.size).toBe(0),
      )
      reach.reach(`abort-before-acceptance`)
      canceled.release()
      // An optimistic write outside the query parks every following ordinary
      // sync commit. This is a real core receipt, not a substituted promise.
      let release!: () => void
      const transaction = createTransaction({
        mutationFn: () =>
          new Promise<void>((resolve) => {
            release = resolve
            releaseBlock = resolve
          }),
      })
      transaction.mutate(() =>
        f.source.insert({ id: `blocker`, rank: 1000, text: `held` }),
      )
      const after = new AbortController()
      let settled = false
      const loading = f.load({ limit: 3 }, after.signal)
      void Promise.resolve(loading.result).then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )
      await f.remote.pump()
      oracleAssertion(`lazy-paging-oracle.property.test.ts:591:toBe`, () =>
        expect(
          settled,
          `lazy receipt: successful load before application`,
        ).toBe(false),
      )
      oracleAssertion(`lazy-paging-oracle.property.test.ts:595:toBe`, () =>
        expect(f.receipts.some((receipt) => receipt !== true)).toBe(true),
      )
      after.abort()
      await f.remote.pump()
      oracleAssertion(`lazy-paging-oracle.property.test.ts:598:toBe`, () =>
        expect(settled, `lazy abort: accepted rows must apply first`).toBe(
          false,
        ),
      )
      release()
      await transaction.when('settled')
      await f.remote.pump()
      await oracleAssertion(
        `lazy-paging-oracle.property.test.ts:605:toMatchObject`,
        () =>
          expect(loading.result).rejects.toMatchObject({
            name: `AbortError`,
          }),
      )
      assertLazyCoverage(
        [...f.source.values()],
        rows,
        { limit: 3 },
        h.descending,
      )
      reach.reach(`actual-establishing-set-checked`)
      reach.reach(`abort-after-acceptance`)
      loading.release()
      const current = f.load({ limit: 3 })
      await f.remote.pump()
      await current.complete()
      f.remote.disconnect()
      const changed = rows.map((row, i) =>
        i === rows.length - 1
          ? { ...row, rank: h.descending ? 100 : -100 }
          : row,
      )
      f.remote.change(changed)
      await f.remote.pump()
      f.remote.reconnect()
      await f.remote.pump()
      assertLazyCoverage(
        [...f.source.values()],
        changed,
        { limit: 3 },
        h.descending,
      )
      reach.reach(`same-run-reconnect-recovery`)
      current.release()
      const dependent = createLiveQueryCollection((q) =>
        q
          .from({ row: f.source })
          .orderBy(({ row }) => row.rank, h.descending ? `desc` : `asc`)
          .select(({ row }) => row)
          .limit(3),
      )
      cleanDependent = () => dependent.cleanup()
      const permission = {}
      f.remote.scopes.set(permission, { limit: 3 })
      const ready = dependent.preload()
      await f.remote.pump()
      await ready
      const dependentPublications: Array<Array<LazyRow>> = []
      const dependentStatuses: Array<string> = []
      const stopDependentStatuses = dependent.on(
        `status:change`,
        ({ status }) => dependentStatuses.push(status),
      )
      const dependentObserver = dependent.subscribeChanges(
        () => dependentPublications.push(copyLazyRows(dependent.toArray)),
        { includeInitialState: false },
      )
      // Public cleanup now refuses active dependents. Internal teardown
      // still owns this stale-callback and terminal-graph boundary.
      await oracleAssertion(
        `lazy-paging-oracle.property.test.ts:664:toThrow`,
        () =>
          expect(f.source.cleanup()).rejects.toThrow(`dependent(s) read it`),
      )
      const cleaning = f.source._lifecycle.cleanup()
      const staleCheckpoint = async () => {
        const before = {
          base: [...f.source.base.values()],
          status: f.source.status,
          statuses: [...f.statuses],
          errors: [...f.errors],
          syncError: f.source.utils.getSyncError(),
          publications: [...f.publications],
          dependentPublications: [...dependentPublications],
          dependentStatuses: [...dependentStatuses],
          dependent: [...dependent.values()],
          dependentStatus: dependent.status,
        }
        f.remote.late(`success`)
        f.remote.late(`error`)
        for (let turn = 0; turn < 10; turn++) await Promise.resolve()
        oracleAssertion(`lazy-paging-oracle.property.test.ts:684:toEqual`, () =>
          expect(
            {
              base: [...f.source.base.values()],
              status: f.source.status,
              statuses: [...f.statuses],
              errors: [...f.errors],
              syncError: f.source.utils.getSyncError(),
              publications: [...f.publications],
              dependentPublications: [...dependentPublications],
              dependentStatuses: [...dependentStatuses],
              dependent: [...dependent.values()],
              dependentStatus: dependent.status,
            },
            `retired callback retained authority across cleanup`,
          ).toEqual(before),
        )
      }
      await staleCheckpoint()
      oracleAssertion(`lazy-paging-oracle.property.test.ts:701:toBe`, () =>
        expect(f.source.has(`obsolete`)).toBe(false),
      )
      oracleAssertion(`lazy-paging-oracle.property.test.ts:702:toBe`, () =>
        expect(dependent.status).toBe(`crashed`),
      )
      oracleAssertion(`lazy-paging-oracle.property.test.ts:703:toThrow`, () =>
        expect(() => f.source.startSyncImmediate()).toThrow(),
      )
      reach.reach(`cleanup-start-fences-callback`)
      await f.remote.pump()
      await staleCheckpoint()
      oracleAssertion(`lazy-paging-oracle.property.test.ts:707:toBe`, () =>
        expect(f.source.has(`obsolete`)).toBe(false),
      )
      oracleAssertion(`lazy-paging-oracle.property.test.ts:708:toBe`, () =>
        expect(f.source.status).not.toBe(`cleaned-up`),
      )
      reach.reach(`held-cleanup-fences-callback`)
      finishCleanup()
      await cleaning
      // Core retains the terminal query's source subscription. Its new-run
      // truncate requests a whole-source replay even though the old graph
      // remains terminal. Account for that real demand; do not call it
      // speculative work for the fresh bounded request.
      f.remote.scopes.set(permission, {})
      f.source.startSyncImmediate()
      const restarted = f.load({ limit: 3 })
      await f.remote.pump()
      await restarted.complete()
      await staleCheckpoint()
      await f.remote.pump()
      oracleAssertion(`lazy-paging-oracle.property.test.ts:723:toBe`, () =>
        expect(f.source.has(`obsolete`)).toBe(false),
      )
      assertLazyCoverage(
        [...f.source.values()],
        changed,
        { limit: 3 },
        h.descending,
      )
      reach.reach(`stale-after-restart`)
      oracleAssertion(`lazy-paging-oracle.property.test.ts:731:toBe`, () =>
        expect(dependent.status).toBe(`crashed`),
      )
      reach.reach(`old-dependent-stays-terminal`)
      reach.reach(`retired-error-and-status-fenced`)
      const fresh = createLiveQueryCollection((q) =>
        q
          .from({ row: f.source })
          .orderBy(({ row }) => row.rank, h.descending ? `desc` : `asc`)
          .orderBy(({ row }) => row.id, h.descending ? `desc` : `asc`)
          .select(({ row }) => row)
          .limit(3),
      )
      cleanFresh = () => fresh.cleanup()
      const freshReady = fresh.preload()
      await f.remote.pump()
      await freshReady
      oracleAssertion(`lazy-paging-oracle.property.test.ts:746:toEqual`, () =>
        expect(copyLazyRows(fresh.toArray)).toEqual(
          expectedLazyRows(changed, { limit: 3 }, h.descending),
        ),
      )
      oracleAssertion(`lazy-paging-oracle.property.test.ts:749:toBe`, () =>
        expect(fresh.status).toBe(`ready`),
      )
      oracleAssertion(`lazy-paging-oracle.property.test.ts:750:toBe`, () =>
        expect(dependent.status).toBe(`crashed`),
      )
      reach.reach(`fresh-dependent-after-restart`)
      await fresh.cleanup()
      stopDependentStatuses()
      dependentObserver.unsubscribe()
      await dependent.cleanup()
      f.remote.scopes.delete(permission)
      restarted.release()
    },
    () => {
      releaseBlock()
      finishCleanup()
      return f.source.cleanup()
    },
    () => cleanDependent(),
    () => cleanFresh(),
  )
}

oracleProperty({
  id: `convex.lazy-lifecycle`,
  law: {
    statement: `waits for applied receipts, respects abort and fences callbacks across restart`,
    authority: `docs/collections/convex-collection.md; the existing model and contract stated above and named in docs/contributing/oracle-coverage.md.`,
    limits: `The unchanged bounded grammar, receiving paths and observation cuts described above; registration migration adds no product coverage.`,
    owner: `Convex collection integration`,
  },
  histories: {
    arbitrary: convex_lazy_lifecycleHistory,
    runs: 60,
    fixedSeeds: [fixedSeed],
    states: [
      `actual-establishing-set-checked`,
      `abort-before-acceptance`,
      `abort-after-acceptance`,
      `stale-after-restart`,
      `same-run-reconnect-recovery`,
      `cleanup-start-fences-callback`,
      `held-cleanup-fences-callback`,
      `old-dependent-stays-terminal`,
      `retired-error-and-status-fenced`,
      `fresh-dependent-after-restart`,
    ] as const,
    constructed: [
      {
        name: `existing constructive history`,
        enters: [
          `actual-establishing-set-checked`,
          `abort-before-acceptance`,
          `abort-after-acceptance`,
          `stale-after-restart`,
          `same-run-reconnect-recovery`,
          `cleanup-start-fences-callback`,
          `held-cleanup-fences-callback`,
          `old-dependent-stays-terminal`,
          `retired-error-and-status-fenced`,
          `fresh-dependent-after-restart`,
        ] as const,
        build: (generated) => generated,
      },
    ],
  },
  resolve: (generated) => ({ history: generated }),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
  driver: async (plan, observe) =>
    recordAssertionJudgment(`convex.lazy-lifecycle`, plan, observe, () =>
      convex_lazy_lifecycleJudgment(plan.history, {
        beginHistory: () => {},
        reach: (state) => observe(`reach`, state),
      }),
    ),
  timeout: 60000,
})

/** A publication callback may open a second optimistic hold and install the
 * next source revision before the older applied receipt's continuation runs.
 * Each cached acquisition still owes the actual latest establishing receipt.
 * The two receipts here come from core; no promise is substituted. */

const convex_lazy_receiptHistory = history
// This existing helper retains the independent reference, production lifecycle,
// comparison cuts and assertions. The native adapter only transports its judgment.
async function convex_lazy_receiptJudgment(
  h: AssertionHistory<typeof convex_lazy_receiptHistory>,
  reach: AssertionReach,
) {
  reach.beginHistory()
  const rows = rowsFor(h, false)
  const target = ordered(rows, h.descending)[0]!
  const fresh = rows.map((row) =>
    row.id === target.id ? { ...row, text: `${row.text} new` } : row,
  )
  const f = lazyFixture(rows, Math.max(2, h.pageSize), h.descending)
  let open1 = () => {}
  let open2 = () => {}
  const firstBlock = createTransaction({
    mutationFn: () =>
      new Promise<void>((resolve) => {
        open1 = resolve
      }),
  })
  firstBlock.mutate(() =>
    f.source.insert({
      id: `block1`,
      rank: h.descending ? -1000 : 1000,
      text: `held`,
    }),
  )
  const first = f.load({ limit: 1 })
  await f.remote.pump()
  let second: ReturnType<typeof f.load> | undefined
  let cached: ReturnType<typeof f.load> | undefined
  let secondBlock: ReturnType<typeof createTransaction> | undefined
  let started = false
  const subscription = f.source.subscribeChanges(
    (changes) => {
      if (started || !changes.some((change) => change.key === target.id)) return
      started = true
      secondBlock = createTransaction({
        mutationFn: () =>
          new Promise<void>((resolve) => {
            open2 = resolve
          }),
      })
      secondBlock.mutate(() =>
        f.source.insert({
          id: `block2`,
          rank: h.descending ? -1001 : 1001,
          text: `held`,
        }),
      )
      f.remote.change(fresh)
      f.remote.installCaches()
      second = f.load({ limit: 1 })
    },
    { includeInitialState: false },
  )
  await withTestCleanup(
    async () => {
      open1()
      await firstBlock.when('settled')
      await f.remote.pump()
      oracleAssertion(`lazy-paging-oracle.property.test.ts:871:toBe`, () =>
        expect(started).toBe(true),
      )
      oracleAssertion(
        `lazy-paging-oracle.property.test.ts:872:toBeGreaterThanOrEqual`,
        () =>
          expect(
            f.receipts.filter((receipt) => receipt !== true).length,
          ).toBeGreaterThanOrEqual(2),
      )
      oracleAssertion(`lazy-paging-oracle.property.test.ts:875:toBe`, () =>
        expect(f.source.get(target.id)!.text).toBe(target.text),
      )
      reach.reach(`reentrant-second-held-receipt`)
      let settled = false
      cached = f.load({ limit: 1 })
      void Promise.resolve(cached.result).then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )
      await f.remote.pump()
      oracleAssertion(`lazy-paging-oracle.property.test.ts:888:toBe`, () =>
        expect(
          settled,
          `lazy receipt: cached load skipped newer establishing receipt`,
        ).toBe(false),
      )
      reach.reach(`cached-load-waits-for-latest`)
      open2()
      await secondBlock!.when('settled')
      await f.remote.pump()
      await first.complete()
      await second!.complete()
      await cached.complete()
      assertLazyCoverage(
        [...f.source.values()],
        fresh,
        { limit: 1 },
        h.descending,
      )
    },
    () => {
      open1()
      open2()
    },
    () => subscription.unsubscribe(),
    () => {
      first.release()
      second?.release()
      cached?.release()
    },
    () => f.source.cleanup(),
  )
}

oracleProperty({
  id: `convex.lazy-receipt`,
  law: {
    statement: `keeps the newer establishing receipt through publication reentry`,
    authority: `docs/collections/convex-collection.md; the existing model and contract stated above and named in docs/contributing/oracle-coverage.md.`,
    limits: `The unchanged bounded grammar, receiving paths and observation cuts described above; registration migration adds no product coverage.`,
    owner: `Convex collection integration`,
  },
  histories: {
    arbitrary: convex_lazy_receiptHistory,
    runs: 60,
    fixedSeeds: [fixedSeed],
    states: [
      `reentrant-second-held-receipt`,
      `cached-load-waits-for-latest`,
    ] as const,
    constructed: [
      {
        name: `existing constructive history`,
        enters: [
          `reentrant-second-held-receipt`,
          `cached-load-waits-for-latest`,
        ] as const,
        build: (generated) => generated,
      },
    ],
  },
  resolve: (generated) => ({ history: generated }),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
  driver: async (plan, observe) =>
    recordAssertionJudgment(`convex.lazy-receipt`, plan, observe, () =>
      convex_lazy_receiptJudgment(plan.history, {
        beginHistory: () => {},
        reach: (state) => observe(`reach`, state),
      }),
    ),
  timeout: 60000,
})

// Wrong-answer controls distinguish missing same-rank coverage, skipped
// overshoot, transient publication and hidden-suffix knowledge independently
// of the production driver. Legal batch/cached and reacquisition behavior
// carries no mandatory second-receipt or retained-tail assertion.
it(`rejects wrong coverage and transient windows while preserving discovery freedom`, () => {
  oracleRoute(`calibration`)
  const rows = [
    { id: `a`, rank: 1, text: `` },
    { id: `b`, rank: 1, text: `` },
    { id: `c`, rank: 2, text: `` },
  ]
  oracleAssertion(`lazy-paging-oracle.property.test.ts:942:toThrow`, () =>
    expect(() => assertLazyCoverage([rows[0]!], rows, { limit: 1 })).toThrow(
      `lazy coverage`,
    ),
  )
  oracleAssertion(`lazy-paging-oracle.property.test.ts:945:toThrow`, () =>
    expect(() => assertLazyPublications([[rows[0]!]], [], rows)).toThrow(
      `lazy publication`,
    ),
  )
  for (const suffix of [
    [{ id: `c`, rank: 3, text: `` }],
    [{ id: `d`, rank: 2, text: `` }],
  ]) {
    const delivered = [
      { id: `a`, rank: 1, text: `` },
      { id: `b`, rank: 2, text: `` },
    ]
    oracleAssertion(`lazy-paging-oracle.property.test.ts:956:toBe`, () =>
      expect(deliveredScopeComplete(delivered, false, { limit: 2 })).toBe(
        false,
      ),
    )
    oracleAssertion(`lazy-paging-oracle.property.test.ts:957:toEqual`, () =>
      expect(expectedLazyRows([...delivered, ...suffix], { limit: 2 })).toEqual(
        delivered,
      ),
    )
  }
})

it.each([0, -1, 1.5, Infinity, NaN])(
  `rejects invalid lazy row caps before readiness: %s`,
  async (maxRows) => {
    oracleRoute(`case`)
    const f = lazyFixture([], 1)
    await f.source.cleanup()
    const source = createCollection(
      convexPaginatedCollectionOptions({
        client: f.remote.client,
        query: lazyQuery,
        queryArgs: {},
        syncMode: `on-demand`,
        queryOrder: { field: `rank`, direction: `asc` },
        maxRows,
        getKey: (row) => row.id,
      }),
    )
    const statuses: Array<string> = []
    const off = source.on(`status:change`, ({ status }) => {
      statuses.push(status)
    })
    await withTestCleanup(
      async () => {
        await oracleAssertion(
          `lazy-paging-oracle.property.test.ts:986:toBeInstanceOf`,
          () => expect(source.preload()).rejects.toBeInstanceOf(Error),
        )
        oracleAssertion(
          `lazy-paging-oracle.property.test.ts:987:toBeInstanceOf`,
          () => expect(source.utils.getSyncError()).toBeInstanceOf(RangeError),
        )
        oracleAssertion(
          `lazy-paging-oracle.property.test.ts:988:toContain`,
          () =>
            expect(
              statuses,
              `lazy startup: invalid provider config reported ready`,
            ).not.toContain(`ready`),
        )
        oracleAssertion(
          `lazy-paging-oracle.property.test.ts:992:toHaveLength`,
          () => expect(f.remote.slots).toHaveLength(0),
        )
      },
      off,
      () => source.cleanup(),
    )
  },
)

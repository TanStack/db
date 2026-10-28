/**
 * Revalidation owes actual establishing application even when its values equal
 * the old base. A newer accepted revision can supersede those values before
 * receipt observers run. Authority: LoadSubsetOptions.refetch/signal,
 * LoadSubsetFn and SyncAppliedReceipt in db/src/types.ts. LazyReceiptModel
 * judges settlement; LazyVersionModel and source provenance judge publication.
 *
 * This receiver invokes the native public paginated adapter and real core.
 * The SDK fixture installs a coherent cache before explicit revalidation.
 * Only synchronous commits inside that isolated invocation are attributed to
 * it: no row inequality, page, queue or global-latest guess establishes debt.
 * Fresh equal-valued SDK objects permit a genuinely accepted idempotent batch.
 * An identical-cache revalidation may create zero new receipts. Both choices
 * are legal; a receipt is owed only when core actually accepted it.
 *
 * Generated histories vary rows, page size, order, text and which caller aborts;
 * every history receives both SDK shapes. Each forces equal-valued acceptance,
 * later supersession, cancellation while held, cached revalidation and an
 * unheld reactive revision. Reuse
 * may accept another receipt or owe no new one; both refinements are permitted.
 * Limits: coherent controlled SDK caches, synchronous isolated revalidation,
 * complete stable-key source and nonreentrant commits. This does not claim a
 * real server emits equal-valued query updates or general causal attribution.
 */
import { createTransaction } from '@tanstack/db'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import { runOracleCampaign } from '../../db/tests/oracle-campaign'
import { withTestCleanup } from './helpers'
import { lazyFixture } from './lazy-paging-driver'
import { lazyOracleRuns, receiveBothSdks } from './lazy-paging-campaign'
import { assertLazySourceFacts, copyLazyRows } from './lazy-paging-model-oracle'
import { LazyReceiptModel } from './lazy-paging-receipt-model'
import { LazyVersionModel } from './lazy-paging-version-model-oracle'
import type { LazyRow } from './lazy-paging-model-oracle'

const turns = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}
const fact = (row: LazyRow) => JSON.stringify([row.id, row.rank, row.text])
const grammar = fc.record({
  size: fc.integer({ min: 5, max: 11 }),
  pageSize: fc.integer({ min: 2, max: 4 }),
  descending: fc.boolean(),
  cancelFirst: fc.boolean(),
  text: fc.string({ maxLength: 8 }),
})
type History = typeof grammar extends fc.Arbitrary<infer T> ? T : never

async function receive(
  h: History,
  kind: `javascript` | `react`,
  borrowApplied = process.env.CONVEX_REVALIDATION_FAULT === `borrow-applied`,
) {
  const rows = Array.from({ length: h.size }, (_, rank) => ({
    id: String(rank),
    rank,
    text: h.text,
  }))
  const revised = rows.map((row) => ({ ...row, text: `${row.text}:new` }))
  let latest = revised
  const f = lazyFixture(
    rows,
    h.pageSize,
    h.descending,
    `none`,
    false,
    undefined,
    kind,
    borrowApplied ? () => true : undefined,
  )
  const receipts = new LazyReceiptModel()
  const versions = new LazyVersionModel()
  const failures: Array<unknown> = []
  const outcomes = new Map<string, string>()
  const edges = new Map<string, Array<string>>()
  const loads: Array<ReturnType<typeof f.load>> = []
  const callbacks: Array<Array<LazyRow>> = []
  let call: string | undefined
  let stopBatches = () => {}
  let stopChanges = () => {}
  let release = () => {}
  let zeroReceiptReuse = false
  const checkpoint = () => {
    if (failures.length) {
      const signature = (values: ReadonlyArray<LazyRow>) =>
        JSON.stringify(
          [...values].sort((a, b) => a.id.localeCompare(b.id)).map(fact),
        )
      console.info(
        `ORACLE_REVALIDATION_FAILURE ${JSON.stringify({
          kind,
          finalMatchesLatest:
            signature([...f.source.base.values()]) === signature(latest),
        })}`,
      )
      throw failures[0]
    }
  }
  const acquire = (
    id: string,
    required: Array<LazyRow>,
    refetch: boolean,
    controller?: AbortController,
  ) => {
    receipts.acquire(id, required.map(fact))
    call = id
    let load: ReturnType<typeof f.load>
    try {
      load = f.load({}, controller?.signal, refetch)
    } finally {
      call = undefined
    }
    loads.push(load)
    void Promise.resolve(load.result).then(
      () => {
        outcomes.set(id, `success`)
        try {
          receipts.observe(id, `success`)
        } catch (error) {
          failures.push(error)
        }
      },
      (error: unknown) => {
        const outcome =
          error instanceof Error && error.name === `AbortError`
            ? `canceled`
            : `rejected`
        outcomes.set(id, outcome)
        try {
          receipts.observe(id, outcome)
        } catch (failure) {
          failures.push(failure)
        }
      },
    )
    return load
  }
  await withTestCleanup(
    async () => {
      const warm = f.load({})
      loads.push(warm)
      await f.remote.pump()
      await warm.complete()
      versions.offer(rows)
      versions.observe([...f.source.base.values()])
      stopBatches = f.observeBatches((batch) => {
        try {
          const owners = call === undefined ? [] : [call]
          edges.set(batch.id, owners)
          receipts.accept(batch.id, batch.rows.map(fact), owners)
          const apply = () => {
            try {
              receipts.apply(batch.id)
            } catch (error) {
              failures.push(error)
            }
          }
          // A later FIFO revision can already be public at this callback. The
          // real receipt proves application; public values are checked separately.
          if (batch.receipt === true) apply()
          else
            void batch.receipt.then(apply, (error: unknown) =>
              failures.push(error),
            )
        } catch (error) {
          failures.push(error)
        }
      })
      const observing = f.source.subscribeChanges(
        () => {
          try {
            const actual = copyLazyRows([...f.source.base.values()])
            callbacks.push(actual)
            assertLazySourceFacts(actual, f.remote.deliveredFacts)
            versions.observe(actual)
          } catch (error) {
            failures.push(error)
          }
        },
        { includeInitialState: false },
      )
      stopChanges = () => observing.unsubscribe()
      let resolve!: () => void
      const held = new Promise<void>((done) => {
        resolve = done
      })
      release = resolve
      const transaction = createTransaction({ mutationFn: () => held })
      transaction.mutate(() =>
        f.source.insert({ id: `overlay`, rank: 10000, text: `hold` }),
      )

      // Equal values, fresh SDK objects: explicit revalidation actually commits
      // while the old equal facts are already applied. No changed fact can name it.
      f.remote.change(rows)
      f.remote.installCaches()
      const controllers = [new AbortController(), new AbortController()]
      const beforeEqual = f.batches.length
      const equal = acquire(`equal`, rows, true, controllers[0])
      expect(
        f.batches
          .slice(beforeEqual)
          .some(
            (batch) =>
              edges.get(batch.id)?.includes(`equal`) && batch.receipt !== true,
          ),
        `idempotent revalidation needs actual held acceptance`,
      ).toBe(true)
      expect(
        copyLazyRows([...f.source.base.values()]).sort((a, b) =>
          a.id.localeCompare(b.id),
        ),
      ).toEqual(copyLazyRows(rows).sort((a, b) => a.id.localeCompare(b.id)))

      versions.offer(revised)
      f.remote.change(revised)
      f.remote.installCaches()
      const beforeNew = f.batches.length
      const newer = acquire(`newer`, revised, true, controllers[1])
      expect(
        f.batches
          .slice(beforeNew)
          .some(
            (batch) =>
              edges.get(batch.id)?.includes(`newer`) && batch.receipt !== true,
          ),
        `superseding revalidation needs actual held acceptance`,
      ).toBe(true)
      const beforeReuse = f.batches.length
      const reuse = acquire(`reuse`, revised, true)
      zeroReceiptReuse = f.batches.length === beforeReuse
      const canceled = h.cancelFirst ? `equal` : `newer`
      receipts.abort(canceled)
      controllers[h.cancelFirst ? 0 : 1]!.abort()
      await turns()
      checkpoint()
      expect(
        outcomes.size,
        `revalidation settled before accepted application`,
      ).toBe(0)
      release()
      await transaction.isPersisted.promise
      await turns()
      checkpoint()
      await Promise.allSettled([equal.result, newer.result, reuse.result])
      expect(outcomes.get(canceled)).toBe(`canceled`)
      expect(outcomes.get(h.cancelFirst ? `newer` : `equal`)).toBe(`success`)
      expect(outcomes.get(`reuse`)).toBe(`success`)
      expect(
        callbacks.some(
          (snapshot) =>
            JSON.stringify(
              [...snapshot].sort((a, b) => a.id.localeCompare(b.id)),
            ) ===
            JSON.stringify(
              [...revised].sort((a, b) => a.id.localeCompare(b.id)),
            ),
        ),
        `superseding revision never reached publication callback`,
      ).toBe(true)
      // Explicit refetch is not the ordinary reactive callback path. Exercise
      // that path without a hold, so a transient rollback followed by correct
      // final rows must remain observable and fail the retained comparison.
      latest = rows.map((row) => ({ ...row, text: `${row.text}:reactive` }))
      versions.offer(latest)
      f.remote.change(latest)
      await f.remote.pump()
      await turns()
      checkpoint()
      expect(
        callbacks.some(
          (snapshot) =>
            JSON.stringify(
              [...snapshot].sort((a, b) => a.id.localeCompare(b.id)),
            ) ===
            JSON.stringify(
              [...latest].sort((a, b) => a.id.localeCompare(b.id)),
            ),
        ),
        `reactive revision never reached publication callback`,
      ).toBe(true)
      receipts.complete()
    },
    () => release(),
    () => loads.forEach((load) => load.release()),
    () => f.source.cleanup(),
    () => {
      stopBatches()
      stopChanges()
    },
  )
  return { zeroReceiptReuse }
}

it(`receives equal-valued and superseding revalidation through actual receipts`, async () => {
  await runOracleCampaign(
    `CONVEX_REVALIDATION_ORACLE`,
    [
      `equal-held`,
      `superseding-held`,
      `cached-revalidation`,
      `canceled-held`,
      `coherent-callback`,
      `unheld-reactive-publication`,
      `javascript`,
      `react`,
    ] as const,
    async (reach, parameters) => {
      let zeroReceiptReuses = 0
      await fc.assert(
        fc.asyncProperty(grammar, async (h) => {
          reach.beginHistory()
          for (const [kind, observed] of await receiveBothSdks((sdk) =>
            receive(h, sdk),
          )) {
            reach.reach(kind)
            if (observed.zeroReceiptReuse) zeroReceiptReuses++
          }
          for (const state of [
            `equal-held`,
            `superseding-held`,
            `cached-revalidation`,
            `canceled-held`,
            `coherent-callback`,
            `unheld-reactive-publication`,
          ] as const)
            reach.reach(state)
        }),
        { numRuns: lazyOracleRuns(30), ...parameters },
      )
      console.info(
        `ORACLE_REVALIDATION_ALTERNATIVES ${JSON.stringify({ zeroReceiptReuses })}`,
      )
    },
    { fixedSeed: 20261029 },
  )
}, 60000)

it(`rejects applied-content substitution for an equal-valued held receipt`, async () => {
  await expect(
    receive(
      { size: 5, pageSize: 2, descending: false, cancelFirst: true, text: `` },
      `javascript`,
      true,
    ),
  ).rejects.toThrow(/receipt law/)
})

it(`calibrates cleanup authority without treating cleanup as receipt application`, () => {
  const model = new LazyReceiptModel()
  model.acquire(`a`, [`equal`])
  model.accept(`actual`, [`equal`], [`a`])
  model.abort(`a`)
  expect(() => model.abandon(`actual`)).toThrow(
    /abandonment without pending cleanup work/,
  )
  model.cleanup()
  expect(() => model.observe(`a`, `canceled`)).toThrow(
    /settled before actual applied/,
  )
  model.abandon(`actual`)
  expect(() => model.observe(`a`, `success`)).toThrow(
    /settled before actual applied/,
  )
  model.observe(`a`, `canceled`)
  model.complete()
})

it(`calibrates exact window order while accepting coherent skipped revisions`, () => {
  const a = { id: `a`, rank: 0, text: `old` }
  const b = { id: `b`, rank: 1, text: `old` }
  const latest = [
    { ...a, text: `latest` },
    { ...b, text: `latest` },
  ]
  const model = new LazyVersionModel(`sequence`)
  model.offer([a, b])
  model.offer([
    { ...a, text: `middle` },
    { ...b, text: `middle` },
  ])
  model.offer(latest)
  model.observe([a, b])
  expect(() => model.observe([b, a])).toThrow(
    /mixed revision or public rollback/,
  )
  model.observe(latest)
  expect(() => model.observe([a, b])).toThrow(
    /mixed revision or public rollback/,
  )
})

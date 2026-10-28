/**
 * Native receipt refinement of LazyReceiptModel (LoadSubsetFn, signal and
 * SyncAppliedReceipt in db/src/types.ts). Each required authored row/version
 * absent at acquisition has exactly one supplying batch in these stable source
 * episodes. That unique causal witness assigns an establishing receipt, shared
 * by both callers when appropriate. No queue, page or cursor determines debt.
 *
 * Native writes, actual core receipts, and caller outcomes enter the SAME model
 * as the controlled interleaving receiver. Cached facts can owe zero new
 * receipts. Waiting behind unrelated work remains legal; only quiescent drain
 * requires completion. The driver alone chooses provider page/callback order.
 * Limits: stable keys/order, disjoint new version facts, no idempotent refresh
 * attribution, cleanup abandonment or adversarial acceptance rejection here.
 */
import { createTransaction } from '@tanstack/db'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import { runOracleCampaign } from '../../db/tests/oracle-campaign'
import { oracleRuns } from '../../db/tests/oracle-config'
import { withTestCleanup } from './helpers'
import { lazyFixture } from './lazy-paging-driver'
import { LazyReceiptModel } from './lazy-paging-receipt-model'
import { ordered } from './lazy-paging-model-oracle'
import type { LazyRow } from './lazy-paging-model-oracle'

const turns = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve()
}
const fact = (row: LazyRow) => JSON.stringify([row.id, row.rank, row.text])
type History = {
  size: number
  pageSize: number
  descending: boolean
  react: boolean
  cancel: boolean
  reverse: boolean
  text: string
}

async function nativeHistory(
  h: History,
  borrowStartup = process.env.CONVEX_LAZY_NATIVE_RECEIPT_FAULT ===
    `borrow-startup`,
) {
  const rows = Array.from({ length: h.size }, (_, rank) => ({
    id: `r${rank}`,
    rank,
    text: `${h.text}:v1`,
  }))
  const model = new LazyReceiptModel()
  const failures: Array<unknown> = []
  const attempts = new Map<
    string,
    {
      missing: Set<string>
      active: boolean
      outcome?: `success` | `canceled` | `rejected`
    }
  >()
  const f = lazyFixture(
    rows,
    h.pageSize,
    h.descending,
    `none`,
    false,
    undefined,
    h.react ? `react` : `javascript`,
    borrowStartup ? () => true : undefined,
  )
  const applied = new Set<string>()
  const edges = new Map<string, Array<string>>()
  const stop = f.observeBatches((batch) => {
    try {
      const facts = batch.rows.map(fact)
      const owners = [...attempts].filter(
        ([, attempt]) =>
          attempt.active && facts.some((value) => attempt.missing.has(value)),
      )
      for (const [, attempt] of owners)
        for (const value of facts) attempt.missing.delete(value)
      const ids = owners.map(([id]) => id)
      model.accept(batch.id, facts, ids)
      edges.set(batch.id, ids)
      const observeApplied = () => {
        try {
          for (const row of batch.rows)
            expect(
              f.source.base.get(row.id),
              `receipt before authored fact visibility`,
            ).toEqual(row)
          model.apply(batch.id)
          for (const value of facts) applied.add(value)
        } catch (error) {
          failures.push(error)
        }
      }
      if (batch.receipt === true) observeApplied()
      else
        void batch.receipt.then(observeApplied, (error: unknown) =>
          failures.push(error),
        )
    } catch (error) {
      failures.push(error)
    }
  })
  const loads: Array<ReturnType<typeof f.load>> = []
  const acquire = (
    id: string,
    required: Array<LazyRow>,
    limit: number,
    signal?: AbortSignal,
    refetch = false,
  ) => {
    const facts = required.map(fact)
    model.acquire(id, facts)
    const attempt = {
      missing: new Set(facts.filter((value) => !applied.has(value))),
      active: true,
      outcome: undefined as `success` | `canceled` | `rejected` | undefined,
    }
    attempts.set(id, attempt)
    const load = f.load({ limit }, signal, refetch)
    loads.push(load)
    const observe = (outcome: `success` | `canceled` | `rejected`) => {
      attempt.outcome = outcome
      attempt.active = false
      try {
        model.observe(id, outcome)
      } catch (error) {
        failures.push(error)
      }
    }
    void Promise.resolve(load.result).then(
      () => observe(`success`),
      (error: unknown) =>
        observe(
          error instanceof Error && error.name === `AbortError`
            ? `canceled`
            : `rejected`,
        ),
    )
    return { load, attempt }
  }
  let release = () => {}
  const hold = (id: string) => {
    let resolve!: () => void
    const promise = new Promise<void>((done) => {
      resolve = done
    })
    release = resolve
    const tx = createTransaction({ mutationFn: () => promise })
    tx.mutate(() => f.source.insert({ id, rank: 10000, text: `overlay` }))
    return async () => {
      resolve()
      await tx.isPersisted.promise
      await turns()
    }
  }
  const checkpoint = () => {
    if (failures.length) throw failures[0]
  }
  await withTestCleanup(
    async () => {
      // Empty native startup is an actual zero-fact receipt, not a substitute
      // for a later caller's establishing receipt.
      const warmRows = ordered(rows, h.descending).slice(0, 1)
      const initial = acquire(`initial`, warmRows, 1)
      await f.remote.pump()
      await initial.load.complete()
      await turns()
      checkpoint()
      const controller = new AbortController()
      const a = acquire(`a`, rows, h.size, controller.signal)
      const c = acquire(`c`, rows, h.size)
      const drain = hold(`first-overlay`)
      await f.remote.pump(() => false, h.reverse)
      expect(
        [...edges.values()].some(
          (ids) => ids.includes(`a`) && ids.includes(`c`),
        ),
        `unique new facts must witness shared establishment`,
      ).toBe(true)
      expect(f.batches.some((batch) => batch.receipt !== true)).toBe(true)
      const cachedHeld = acquire(`cached-held`, warmRows, 1)
      // These facts were applied before the peer's deeper acquisition. The
      // cached caller owes no new receipt, but may lawfully wait behind it.
      expect([...edges.values()].flat()).not.toContain(`cached-held`)
      if (h.cancel) {
        model.abort(`a`)
        a.attempt.active = false
        controller.abort()
      }
      await turns()
      checkpoint()
      expect(
        a.attempt.outcome,
        `native caller escaped a held receipt`,
      ).toBeUndefined()
      expect(
        c.attempt.outcome,
        `native shared caller escaped a held receipt`,
      ).toBeUndefined()
      await drain()
      await turns()
      checkpoint()
      expect(
        a.attempt.outcome,
        `receipt progress: quiescent native a stranded`,
      ).toBe(h.cancel ? `canceled` : `success`)
      expect(
        c.attempt.outcome,
        `receipt progress: quiescent native c stranded`,
      ).toBe(`success`)
      expect(
        cachedHeld.attempt.outcome,
        `receipt progress: cached native caller stranded after peer drain`,
      ).toBe(`success`)
      const cached = acquire(`cached`, rows, h.size)
      await f.remote.pump()
      await cached.load.complete()
      await turns()
      checkpoint()
      expect([...edges.values()].flat()).not.toContain(`cached`)
      const revised = rows.map((row) => ({ ...row, text: `${h.text}:v2` }))
      f.remote.change(revised)
      // The SDK has atomically installed this authored revision while its
      // callbacks remain queued. Explicit revalidation can now require these
      // facts; a load against an unchanged cache could lawfully serve v1.
      f.remote.installCaches()
      const secondDrain = hold(`second-overlay`)
      const changed = acquire(`changed`, revised, h.size, undefined, true)
      await f.remote.pump(() => false, !h.reverse)
      expect([...edges.values()].flat()).toContain(`changed`)
      await turns()
      checkpoint()
      expect(changed.attempt.outcome).toBeUndefined()
      await secondDrain()
      await changed.load.complete()
      await turns()
      checkpoint()
      model.complete()
    },
    () => release(),
    () => {
      for (const load of loads) load.release()
    },
    () => f.source.cleanup(),
    () => stop(),
  )
}

it(`refines the same receipt model through native uniquely establishing batches`, async () => {
  await runOracleCampaign(
    `CONVEX_LAZY_NATIVE_RECEIPT_ORACLE`,
    [
      `native-shared-held`,
      `native-cached-zero`,
      `native-cached-behind-peer`,
      `native-new-version`,
      `native-canceled-held`,
      `native-success-held`,
      `javascript`,
      `react`,
    ] as const,
    (reach, parameters) =>
      fc.assert(
        fc.asyncProperty(
          fc.record({
            size: fc.integer({ min: 7, max: 12 }),
            pageSize: fc.integer({ min: 2, max: 4 }),
            descending: fc.boolean(),
            react: fc.boolean(),
            reverse: fc.boolean(),
            text: fc.string({ maxLength: 8 }),
          }),
          async (h) => {
            reach.beginHistory()
            for (const cancel of [false, true])
              await nativeHistory({ ...h, cancel })
            for (const state of [
              `native-shared-held`,
              `native-cached-zero`,
              `native-cached-behind-peer`,
              `native-new-version`,
              `native-canceled-held`,
              `native-success-held`,
            ] as const)
              reach.reach(state)
            reach.reach(h.react ? `react` : `javascript`)
          },
        ),
        { numRuns: oracleRuns(45), ...parameters },
      ),
    { fixedSeed: 20261027 },
  )
}, 60000)

it(`rejects a native receiver borrowing the applied startup receipt`, async () => {
  await expect(
    nativeHistory(
      {
        size: 8,
        pageSize: 2,
        descending: false,
        react: false,
        cancel: false,
        reverse: false,
        text: ``,
      },
      true,
    ),
  ).rejects.toThrow(/receipt law/)
})

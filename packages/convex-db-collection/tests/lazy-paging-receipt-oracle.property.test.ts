/**
 * Exact establishment is a relation between attempts and accepted batches,
 * independently of provider response partition. LoadSubsetFn and
 * SyncAppliedReceipt in db/src/types.ts require every establishing receipt on
 * success and retain accepted writes after cancellation. A shared batch may
 * establish two callers; a cached caller may need no new batch.
 *
 * This controlled adapter exercises the real Collection boundary with actual
 * commit receipts and an optimistic transaction that holds application. It is
 * a receiving check of the core contract used by Convex, not a second Convex
 * pager. Authored facts and establishment edges feed the scientific model;
 * the driver's response grouping and commit partition never enter that model.
 * Native Convex histories separately test its actual batching strategy.
 *
 * Each generated history crosses cached zero, one and several establishing
 * receipts, a shared receipt, cancellation between receipts, a successful peer
 * while another receipt waits, synchronous true and throw. Ordinary rejection
 * is distinct from cancellation. After all environment holds are released, a
 * named quiescent comparison detects a stranded attempt. No finite test claims
 * termination of an arbitrary nonquiescent execution.
 */
import { createCollection, createTransaction } from '@tanstack/db'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import { runOracleCampaign } from '../../db/tests/oracle-campaign'
import { withTestCleanup } from './helpers'
import { LazyReceiptModel } from './lazy-paging-receipt-model'
import type {
  LoadSubsetOptions,
  SyncAppliedReceipt,
  SyncConfig,
} from '@tanstack/db'

type Row = { id: string; text: string }
const gate = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const turns = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
type Fault =
  | `none`
  | `borrow-peer`
  | `first-only`
  | `skip-response`
  | `content-only`
  | `prompt-cancel`
  | `stranded`

async function receiptHistory(
  h: {
    responses: number
    batches: number
    cancel: boolean
    reverse: boolean
    text: string
  },
  fault: Fault = `none`,
) {
  const model = new LazyReceiptModel()
  const providerDone = gate()
  const attempts = new Map<
    number,
    {
      id: string
      done: ReturnType<typeof gate>
      controller: AbortController
      receipts: Array<SyncAppliedReceipt>
      outcome?: `success` | `canceled` | `rejected`
    }
  >()
  let controls!: Parameters<SyncConfig<Row>[`sync`]>[0]
  const source = createCollection<Row>({
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: (sync) => {
        controls = sync
        sync.markReady()
        return {
          loadSubset: (request) => {
            if (request.limit === 99) throw new Error(`authored throw`)
            if (request.limit === 98) return true
            if (request.limit === 95)
              return Promise.reject(new Error(`authored rejection`))
            if (request.limit === 96 || request.limit === 97) {
              const count = request.limit === 96 ? 1 : h.batches
              for (let i = 0; i < count; i++) {
                const fact = `synchronous-${request.limit}-${i}`
                available.add(fact)
                if (accept(fact, [fact], [request.limit]) !== true)
                  throw new Error(`synchronous fixture unexpectedly deferred`)
              }
              return true
            }
            const attempt = attempts.get(request.limit!)!
            if (fault === `stranded` && attempt.id === `cached`)
              return new Promise<void>(() => {})
            return attempt.done.promise.then(async () => {
              if (
                (attempt.id === `a` || attempt.id === `shared`) &&
                fault !== `skip-response`
              )
                await providerDone.promise
              if (fault === `prompt-cancel` && request.signal?.aborted)
                throw Object.assign(new Error(`canceled`), {
                  name: `AbortError`,
                })
              const receipts =
                fault === `content-only` && attempt.id === `idempotent`
                  ? []
                  : fault === `borrow-peer` && attempt.id === `a`
                    ? attempts.get(1)!.receipts
                    : fault === `first-only`
                      ? attempt.receipts.slice(0, 1)
                      : attempt.receipts
              await Promise.all(receipts)
              if (request.signal?.aborted)
                throw Object.assign(new Error(`canceled`), {
                  name: `AbortError`,
                })
            })
          },
        }
      },
    },
  })
  source.startSyncImmediate()
  const requests: Array<LoadSubsetOptions> = []
  const accepted: Array<{
    id: string
    facts: Array<string>
    applied: boolean
    receipt: SyncAppliedReceipt
  }> = []
  const errors: Array<unknown> = []
  const facts = Array.from({ length: 6 }, (_, i) => `a${i}`)
  // Provider grouping and actual batch grouping vary independently. The
  // driver holds every response boundary before supplying the next group.
  // Provider completion gates the real adapter result; no cursor is modeled.
  const responses = Array.from({ length: h.responses }, (_, i) =>
    facts.filter((_fact, j) => j % h.responses === i),
  )
  const available = new Set<string>()
  const batches = Array.from({ length: h.batches }, (_, i) =>
    facts.filter((_fact, j) => j % h.batches === i),
  )
  if (h.reverse) batches.reverse()
  const acquire = (key: number, id: string, required: Array<string>) => {
    model.acquire(id, required)
    const attempt = {
      id,
      done: gate(),
      controller: new AbortController(),
      receipts: [] as Array<SyncAppliedReceipt>,
      outcome: undefined as `success` | `canceled` | `rejected` | undefined,
    }
    attempts.set(key, attempt)
    const request = { limit: key, signal: attempt.controller.signal }
    requests.push(request)
    const result = source._sync.loadSubset(request)
    void Promise.resolve(result).then(
      () => {
        attempt.outcome = `success`
        try {
          model.observe(id, `success`)
        } catch (error) {
          errors.push(error)
        }
      },
      (error: unknown) => {
        const canceled = error instanceof Error && error.name === `AbortError`
        attempt.outcome = canceled ? `canceled` : `rejected`
        try {
          model.observe(id, attempt.outcome)
        } catch (failure) {
          errors.push(failure)
        }
      },
    )
    return attempt
  }
  const accept = (id: string, values: Array<string>, owners: Array<number>) => {
    expect(values.every((fact) => available.has(fact) || fact === `peer`)).toBe(
      true,
    )
    controls.begin()
    for (const fact of values)
      controls.write({
        type: source.base.has(fact) ? `update` : `insert`,
        value: { id: fact, text: h.text },
      })
    const receipt = controls.commit()
    model.accept(
      id,
      values,
      owners.map((key) => attempts.get(key)!.id),
    )
    const batch = { id, facts: values, applied: false, receipt }
    accepted.push(batch)
    for (const key of owners) attempts.get(key)!.receipts.push(receipt)
    const applied = () => {
      try {
        for (const fact of values)
          expect(
            source.base.get(fact)?.text,
            `receipt fulfilled before its base facts applied`,
          ).toBe(h.text)
        batch.applied = true
        model.apply(id)
      } catch (error) {
        errors.push(error)
      }
    }
    if (receipt === true) applied()
    else void receipt.then(applied, (error: unknown) => errors.push(error))
    return receipt
  }
  let release = () => {}
  await withTestCleanup(
    async () => {
      const peer = acquire(1, `peer`, [`peer`])
      accept(`peer-batch`, [`peer`], [1])
      const a = acquire(2, `a`, facts)
      const shared = acquire(3, `shared`, facts)
      a.done.resolve()
      shared.done.resolve()
      // Completing the caller-side work before provider delivery cannot produce
      // success. Each response group really crosses this adapter's input gate.
      await turns()
      if (errors.length) throw errors[0]
      expect(a.outcome, `success without source response`).toBeUndefined()
      for (let i = 0; i < responses.length; i++) {
        for (const fact of responses[i]!) available.add(fact)
        if (i < responses.length - 1) {
          await turns()
          if (errors.length) throw errors[0]
          expect(
            a.outcome,
            `success with an undelivered response`,
          ).toBeUndefined()
        }
      }
      providerDone.resolve()
      // The first receipt applies before the unrelated optimistic hold. Every
      // remaining partition is accepted while application waits.
      accept(`a0`, batches[0]!, [2, 3])
      const held = gate()
      release = held.resolve
      const blocker = createTransaction({ mutationFn: () => held.promise })
      blocker.mutate(() =>
        source.insert({ id: `optimistic-only`, text: `overlay` }),
      )
      for (let i = 1; i < batches.length; i++)
        accept(`a${i}`, batches[i]!, [2, 3])
      if (h.cancel) {
        a.controller.abort()
        model.abort(`a`)
      }
      peer.done.resolve()
      a.done.resolve()
      shared.done.resolve()
      await turns()
      if (errors.length) throw errors[0]
      expect(
        peer.outcome,
        `unrelated held work stranded the established peer`,
      ).toBe(`success`)
      if (h.batches > 1) {
        expect(
          shared.outcome,
          `shared caller skipped an establishing receipt`,
        ).toBeUndefined()
        if (!h.cancel)
          expect(
            a.outcome,
            `caller skipped its exact receipt set`,
          ).toBeUndefined()
        expect(accepted.slice(2).every((batch) => batch.receipt !== true)).toBe(
          true,
        )
      }
      // Accepted work is no longer cancelable; even the canceled caller owes
      // its visibility before settlement, while the shared peer must succeed.
      release()
      await blocker.isPersisted.promise
      await turns()
      if (errors.length) throw errors[0]
      expect(shared.outcome).toBe(`success`)
      expect(a.outcome).toBe(h.cancel ? `canceled` : `success`)
      // Identical facts are already visible, but a newly establishing receipt
      // still waits. Content coincidence must not stand in for that receipt.
      const same = acquire(5, `idempotent`, [facts[0]!])
      const secondHold = gate()
      release = secondHold.resolve
      const secondBlocker = createTransaction({
        mutationFn: () => secondHold.promise,
      })
      secondBlocker.mutate(() =>
        source.insert({ id: `second-overlay`, text: `overlay` }),
      )
      expect(accept(`same-facts`, [facts[0]!], [5])).not.toBe(true)
      same.done.resolve()
      await turns()
      if (errors.length) throw errors[0]
      expect(
        same.outcome,
        `visible facts hid a held establishing receipt`,
      ).toBeUndefined()
      release()
      await secondBlocker.isPersisted.promise
      await turns()
      if (errors.length) throw errors[0]
      expect(same.outcome).toBe(`success`)
      // Cached success owes no new receipt: the same authored facts already apply.
      const cached = acquire(4, `cached`, facts)
      cached.done.resolve()
      await turns()
      if (errors.length) throw errors[0]
      model.complete()
      expect(cached.outcome).toBe(`success`)
      for (const key of [96, 97]) {
        const count = key === 96 ? 1 : h.batches
        const required = Array.from(
          { length: count },
          (_, i) => `synchronous-${key}-${i}`,
        )
        const synchronous = acquire(key, `true-${key}`, required)
        await turns()
        if (errors.length) throw errors[0]
        expect(synchronous.outcome).toBe(`success`)
      }
      const rejected = acquire(95, `rejected`, [])
      await turns()
      if (errors.length) throw errors[0]
      expect(rejected.outcome).toBe(`rejected`)
      model.acquire(`true`, facts)
      expect(source._sync.loadSubset({ limit: 98 })).toBe(true)
      model.observe(`true`, `success`)
      model.acquire(`throw`, [])
      const throwing = { limit: 99 }
      expect(() => source._sync.loadSubset(throwing)).toThrow(`authored throw`)
      model.observe(`throw`, `rejected`)
      model.complete()
    },
    () => release(),
    () => {
      for (const request of requests) source._sync.unloadSubset(request)
    },
    () => source.cleanup(),
  )
}

it(`checks exact shared receipt obligations independently of response partition`, async () => {
  await runOracleCampaign(
    `CONVEX_LAZY_EXACT_RECEIPT_ORACLE`,
    [
      `response-held-before-acceptance`,
      `idempotent-establishing-receipt`,
      `zero-one-many-receipts`,
      `shared-establishment`,
      `cancellation-between-receipts`,
      `unrelated-peer-progress`,
      `true-and-throw`,
      `quiescent-settlement`,
    ] as const,
    (reach, parameters) =>
      fc.assert(
        fc.asyncProperty(
          fc.record({
            responses: fc.integer({ min: 1, max: 3 }),
            batches: fc.integer({ min: 2, max: 3 }),
            reverse: fc.boolean(),
            text: fc.string({ maxLength: 8 }),
          }),
          async (h) => {
            reach.beginHistory()
            for (const cancel of [false, true])
              await receiptHistory({ ...h, cancel })
            for (const state of [
              `response-held-before-acceptance`,
              `idempotent-establishing-receipt`,
              `zero-one-many-receipts`,
              `shared-establishment`,
              `cancellation-between-receipts`,
              `unrelated-peer-progress`,
              `true-and-throw`,
              `quiescent-settlement`,
            ] as const)
              reach.reach(state)
          },
        ),
        { numRuns: 60, ...parameters },
      ),
    { fixedSeed: 20261027 },
  )
}, 60000)

it.each([
  `borrow-peer`,
  `first-only`,
  `skip-response`,
  `content-only`,
  `prompt-cancel`,
  `stranded`,
] as const)(
  `rejects the %s faulty adapter at the real Collection boundary`,
  async (fault) => {
    await expect(
      receiptHistory(
        {
          responses: 3,
          batches: 2,
          cancel: fault === `prompt-cancel`,
          reverse: false,
          text: ``,
        },
        fault,
      ),
    ).rejects.toThrow(/receipt (law|progress)/)
  },
)

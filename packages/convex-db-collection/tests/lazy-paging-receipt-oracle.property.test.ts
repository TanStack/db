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
import { expect } from 'vitest'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { oracleProperty } from '../../db/tests/oracle-property'
import { rejectsAs } from '../../db/tests/calibration-rejection'
import { withTestCleanup } from './helpers'
import { LazyReceiptModel } from './lazy-paging-receipt-model'
import type {
  LoadSubsetOptions,
  SyncAppliedReceipt,
  SyncConfig,
} from '@tanstack/db'

type AssertionHistory<T> = T extends fc.Arbitrary<infer H> ? H : never
type AssertionReach = {
  beginHistory: () => void
  reach: (state: string) => void
}

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
    oracleAssertion(
      `lazy-paging-receipt-oracle.property.test.ts:195:toBe`,
      () =>
        expect(
          values.every((fact) => available.has(fact) || fact === `peer`),
        ).toBe(true),
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
          oracleAssertion(
            `lazy-paging-receipt-oracle.property.test.ts:216:toBe`,
            () =>
              expect(
                source.base.get(fact)?.text,
                `receipt fulfilled before its base facts applied`,
              ).toBe(h.text),
          )
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
      oracleAssertion(
        `lazy-paging-receipt-oracle.property.test.ts:243:toBeUndefined`,
        () =>
          expect(a.outcome, `success without source response`).toBeUndefined(),
      )
      for (let i = 0; i < responses.length; i++) {
        for (const fact of responses[i]!) available.add(fact)
        if (i < responses.length - 1) {
          await turns()
          if (errors.length) throw errors[0]
          oracleAssertion(
            `lazy-paging-receipt-oracle.property.test.ts:249:toBeUndefined`,
            () =>
              expect(
                a.outcome,
                `success with an undelivered response`,
              ).toBeUndefined(),
          )
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
      oracleAssertion(
        `lazy-paging-receipt-oracle.property.test.ts:276:toBe`,
        () =>
          expect(
            peer.outcome,
            `unrelated held work stranded the established peer`,
          ).toBe(`success`),
      )
      if (h.batches > 1) {
        oracleAssertion(
          `lazy-paging-receipt-oracle.property.test.ts:281:toBeUndefined`,
          () =>
            expect(
              shared.outcome,
              `shared caller skipped an establishing receipt`,
            ).toBeUndefined(),
        )
        if (!h.cancel)
          oracleAssertion(
            `lazy-paging-receipt-oracle.property.test.ts:286:toBeUndefined`,
            () =>
              expect(
                a.outcome,
                `caller skipped its exact receipt set`,
              ).toBeUndefined(),
          )
        oracleAssertion(
          `lazy-paging-receipt-oracle.property.test.ts:290:toBe`,
          () =>
            expect(
              accepted.slice(2).every((batch) => batch.receipt !== true),
            ).toBe(true),
        )
      }
      // Accepted work is no longer cancelable; even the canceled caller owes
      // its visibility before settlement, while the shared peer must succeed.
      release()
      await blocker.when('settled')
      await turns()
      if (errors.length) throw errors[0]
      oracleAssertion(
        `lazy-paging-receipt-oracle.property.test.ts:300:toBe`,
        () => expect(shared.outcome).toBe(`success`),
      )
      oracleAssertion(
        `lazy-paging-receipt-oracle.property.test.ts:301:toBe`,
        () => expect(a.outcome).toBe(h.cancel ? `canceled` : `success`),
      )
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
      oracleAssertion(
        `lazy-paging-receipt-oracle.property.test.ts:313:toBe`,
        () => expect(accept(`same-facts`, [facts[0]!], [5])).not.toBe(true),
      )
      same.done.resolve()
      await turns()
      if (errors.length) throw errors[0]
      oracleAssertion(
        `lazy-paging-receipt-oracle.property.test.ts:317:toBeUndefined`,
        () =>
          expect(
            same.outcome,
            `visible facts hid a held establishing receipt`,
          ).toBeUndefined(),
      )
      release()
      await secondBlocker.when('settled')
      await turns()
      if (errors.length) throw errors[0]
      oracleAssertion(
        `lazy-paging-receipt-oracle.property.test.ts:325:toBe`,
        () => expect(same.outcome).toBe(`success`),
      )
      // Cached success owes no new receipt: the same authored facts already apply.
      const cached = acquire(4, `cached`, facts)
      cached.done.resolve()
      await turns()
      if (errors.length) throw errors[0]
      model.complete()
      oracleAssertion(
        `lazy-paging-receipt-oracle.property.test.ts:332:toBe`,
        () => expect(cached.outcome).toBe(`success`),
      )
      for (const key of [96, 97]) {
        const count = key === 96 ? 1 : h.batches
        const required = Array.from(
          { length: count },
          (_, i) => `synchronous-${key}-${i}`,
        )
        const synchronous = acquire(key, `true-${key}`, required)
        await turns()
        if (errors.length) throw errors[0]
        oracleAssertion(
          `lazy-paging-receipt-oracle.property.test.ts:342:toBe`,
          () => expect(synchronous.outcome).toBe(`success`),
        )
      }
      const rejected = acquire(95, `rejected`, [])
      await turns()
      if (errors.length) throw errors[0]
      oracleAssertion(
        `lazy-paging-receipt-oracle.property.test.ts:347:toBe`,
        () => expect(rejected.outcome).toBe(`rejected`),
      )
      model.acquire(`true`, facts)
      oracleAssertion(
        `lazy-paging-receipt-oracle.property.test.ts:349:toBe`,
        () => expect(source._sync.loadSubset({ limit: 98 })).toBe(true),
      )
      model.observe(`true`, `success`)
      model.acquire(`throw`, [])
      const throwing = { limit: 99 }
      // Core normalizes a synchronous adapter throw into a rejected load.
      await oracleAssertion(
        `lazy-paging-receipt-oracle.property.test.ts:354:toThrow`,
        () =>
          expect(source._sync.loadSubset(throwing)).rejects.toThrow(
            `authored throw`,
          ),
      )
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

const convex_lazy_exact_receiptHistory = fc.record({
  responses: fc.integer({ min: 1, max: 3 }),
  batches: fc.integer({ min: 2, max: 3 }),
  reverse: fc.boolean(),
  text: fc.string({ maxLength: 8 }),
})
// This existing helper retains the independent reference, production lifecycle,
// comparison cuts and assertions. The native adapter only transports its judgment.
async function convex_lazy_exact_receiptJudgment(
  h: AssertionHistory<typeof convex_lazy_exact_receiptHistory>,
  reach: AssertionReach,
) {
  reach.beginHistory()
  for (const cancel of [false, true]) await receiptHistory({ ...h, cancel })
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
}

oracleProperty({
  id: `convex.lazy-exact-receipt`,
  law: {
    statement: `checks exact shared receipt obligations independently of response partition`,
    authority: `docs/collections/convex-collection.md; the existing model and contract stated above and named in docs/contributing/oracle-coverage.md.`,
    limits: `The unchanged bounded grammar, receiving paths and observation cuts described above; registration migration adds no product coverage.`,
  },
  histories: {
    arbitrary: convex_lazy_exact_receiptHistory,
    runs: 60,
    fixedSeeds: [20261027],
    states: [
      `response-held-before-acceptance`,
      `idempotent-establishing-receipt`,
      `zero-one-many-receipts`,
      `shared-establishment`,
      `cancellation-between-receipts`,
      `unrelated-peer-progress`,
      `true-and-throw`,
      `quiescent-settlement`,
    ] as const,
    // The faulty-adapter calibrations below corrupt this history.
    fixed: [
      {
        name: `three responses in two batches`,
        history: { responses: 3, batches: 2, reverse: false, text: `` },
      },
    ],
    constructed: [
      {
        name: `existing constructive history`,
        enters: [
          `response-held-before-acceptance`,
          `idempotent-establishing-receipt`,
          `zero-one-many-receipts`,
          `shared-establishment`,
          `cancellation-between-receipts`,
          `unrelated-peer-progress`,
          `true-and-throw`,
          `quiescent-settlement`,
        ] as const,
        build: (generated) => generated,
      },
    ],
  },
  resolve: (generated) => ({ history: generated }),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
  driver: async (plan, observe) =>
    recordAssertionJudgment(`convex.lazy-exact-receipt`, plan, observe, () =>
      convex_lazy_exact_receiptJudgment(plan.history, {
        beginHistory: () => {},
        reach: (state) => observe(`reach`, state),
      }),
    ),
  // The prompt-cancel fault is observable only on a canceled history, as in
  // the old calibration; every other fault runs the uncanceled history.
  calibrations: (
    [
      `borrow-peer`,
      `first-only`,
      `skip-response`,
      `content-only`,
      `prompt-cancel`,
      `stranded`,
    ] as const
  ).map((fault) => ({
    name: `rejects the ${fault} faulty adapter at the real Collection boundary`,
    law: `convex.lazy-exact-receipt`,
    driver: async (
      plan: {
        history: AssertionHistory<typeof convex_lazy_exact_receiptHistory>
      },
      observe: (checkpoint: string, value: unknown) => void,
    ) =>
      recordAssertionJudgment(`convex.lazy-exact-receipt`, plan, observe, () =>
        rejectsAs(
          `lazy-paging-receipt-oracle.property.test.ts:434:toThrow`,
          () =>
            receiptHistory(
              { ...plan.history, cancel: fault === `prompt-cancel` },
              fault,
            ),
          (failure) =>
            expect(() => {
              throw failure
            }).toThrow(/receipt (law|progress)/),
        ),
      ),
  })),
  timeout: 60000,
})

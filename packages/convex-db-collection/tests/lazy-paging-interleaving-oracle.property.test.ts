/**
 * Provider response, acceptance and application are independent boundaries.
 * LoadSubsetFn and LoadSubsetOptions.signal in db/src/types.ts require success
 * to await every establishing receipt; cancellation preserves earlier accepted
 * writes without acquiring the surviving peer's future receipt obligations.
 *
 * The grammar has deliver, accept, apply and abort actions. Enabled actions
 * depend only on authored facts/establishment edges, not pages or a sync queue.
 * Choices select legal topological orders. Actual Collection commit receipts
 * and real optimistic transactions implement acceptance/application separation.
 * The same LazyReceiptModel used by the native receiver judges caller outcomes.
 * A constructive prefix guarantees acceptance before provider completion,
 * partial application before another acceptance, and cancellation before a
 * peer-only batch. Random legal suffixes explore neighboring orders.
 * Limits: six stable disjoint facts, two shared callers, one independent peer,
 * finite responses/batches, and no cleanup abandonment in this receiver.
 */
import { createCollection, createTransaction } from '@tanstack/db'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import { runOracleCampaign } from '../../db/tests/oracle-campaign'
import { withTestCleanup } from './helpers'
import { LazyReceiptModel } from './lazy-paging-receipt-model'
import type { SyncAppliedReceipt, SyncConfig } from '@tanstack/db'

type Row = { id: string }
const gate = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const drain = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
type Action =
  { type: `deliver` | `accept`; index: number } | { type: `apply` | `abort` }
type Fault = `none` | `borrow-peer` | `first-only` | `premature-inflight-cancel`

async function runInterleaving(
  h: {
    responses: number
    batches: number
    choices: Array<number>
    cancelAt: number
    constructive: boolean
    uncancelable: boolean
  },
  fault: Fault = process.env.CONVEX_LAZY_INTERLEAVING_FAULT ===
  `premature-inflight-cancel`
    ? `premature-inflight-cancel`
    : `none`,
) {
  const model = new LazyReceiptModel()
  const facts = Array.from({ length: 6 }, (_, i) => `fact${i}`)
  const responses = Array.from({ length: h.responses }, (_response, i) =>
    facts.filter((_fact, j) => j % h.responses === i),
  )
  const partitions = Array.from({ length: h.batches }, (_batch, i) =>
    facts.filter((_fact, j) => j % h.batches === i),
  )
  const available = new Set<string>()
  const delivered = new Set<number>()
  const accepted = new Set<number>()
  const applied = new Set<number>()
  const allAccepted = gate()
  const canceled = gate()
  const receiptSets: Record<string, Array<SyncAppliedReceipt>> = {
    a: [],
    c: [],
    peer: [],
  }
  const outcomes = new Map<string, `success` | `canceled`>()
  const failures: Array<unknown> = []
  let operations!: Parameters<SyncConfig<Row>[`sync`]>[0]
  let aborted = false
  let baselineFinished = false
  let actionNumber = 0
  const trace: Array<string> = []
  const reaches = new Set<string>()
  const controller = new AbortController()
  const source = createCollection<Row>({
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: (controls) => {
        operations = controls
        controls.markReady()
        return {
          loadSubset: (request) => {
            const id =
              request.limit === 1 ? `peer` : request.limit === 2 ? `a` : `c`
            return (
              id === `peer`
                ? Promise.resolve()
                : id === `a` &&
                    (!h.uncancelable || fault === `premature-inflight-cancel`)
                  ? Promise.race([allAccepted.promise, canceled.promise])
                  : allAccepted.promise
            ).then(async () => {
              const owed =
                fault === `borrow-peer` && id === `a`
                  ? receiptSets.peer!
                  : fault === `first-only` && id === `a`
                    ? receiptSets.a!.slice(0, 1)
                    : receiptSets[id]!
              await Promise.all(owed)
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
  const load = (
    id: string,
    limit: number,
    required: Array<string>,
    signal?: AbortSignal,
  ) => {
    model.acquire(id, required)
    if (id === `a` && h.uncancelable) model.initiate(id, `baseline`)
    const result = source._sync.loadSubset({ limit, signal })
    void Promise.resolve(result).then(
      () => {
        outcomes.set(id, `success`)
        try {
          model.observe(id, `success`)
        } catch (error) {
          failures.push(error)
        }
      },
      (error: unknown) => {
        const outcome =
          error instanceof Error && error.name === `AbortError`
            ? `canceled`
            : `rejected`
        if (outcome !== `rejected`) outcomes.set(id, outcome)
        try {
          model.observe(id, outcome)
        } catch (failure) {
          failures.push(failure)
        }
      },
    )
  }
  const commit = (
    id: string,
    values: Array<string>,
    owners: Array<string>,
    index?: number,
  ) => {
    operations.begin()
    for (const fact of values)
      operations.write({ type: `insert`, value: { id: fact } })
    const receipt = operations.commit()
    model.accept(id, values, owners)
    for (const owner of owners) receiptSets[owner]!.push(receipt)
    const application = () => {
      try {
        expect(
          values.every((fact) => source.base.has(fact)),
          `receipt before base visibility`,
        ).toBe(true)
        model.apply(id)
        if (index !== undefined) applied.add(index)
      } catch (error) {
        failures.push(error)
      }
    }
    if (receipt === true) application()
    else
      void receipt.then(application, (error: unknown) => failures.push(error))
  }
  let held: { release: () => void; persisted: Promise<unknown> } | undefined
  const hold = () => {
    const pending = gate()
    const transaction = createTransaction({ mutationFn: () => pending.promise })
    transaction.mutate(() => source.insert({ id: `overlay-${actionNumber}` }))
    held = {
      release: pending.resolve,
      persisted: transaction.isPersisted.promise,
    }
  }
  const release = async () => {
    if (!held) return
    const pending = held
    held = undefined
    pending.release()
    await pending.persisted
    await drain()
  }
  const checkpoint = () => {
    if (failures.length) throw failures[0]
    // Independent provider facts also constrain the applied source base.
    for (const row of source.base.values())
      expect(
        row.id === `peer` || available.has(row.id),
        `undelivered source fact`,
      ).toBe(true)
  }
  const act = async (action: Action) => {
    actionNumber++
    trace.push(`${action.type}${`index` in action ? action.index : ``}`)
    switch (action.type) {
      case `deliver`:
        delivered.add(action.index)
        for (const fact of responses[action.index]!) available.add(fact)
        break
      case `accept`: {
        const owners = aborted && !h.uncancelable ? [`c`] : [`a`, `c`]
        commit(
          `batch${action.index}`,
          partitions[action.index]!,
          owners,
          action.index,
        )
        accepted.add(action.index)
        if (delivered.size < responses.length)
          reaches.add(`accept-before-last-response`)
        if (aborted) reaches.add(`peer-accept-after-abort`)
        if (aborted && h.uncancelable)
          reaches.add(`uncancelable-accept-after-abort`)
        break
      }
      case `apply`:
        await release()
        if (accepted.size < partitions.length) {
          reaches.add(`apply-before-next-accept`)
          hold()
        }
        break
      case `abort`:
        model.abort(`a`)
        aborted = true
        controller.abort()
        canceled.resolve()
        if (applied.size < accepted.size) reaches.add(`abort-with-held-receipt`)
        if (
          h.uncancelable &&
          applied.size === accepted.size &&
          accepted.size < partitions.length
        )
          reaches.add(`abort-with-only-inflight-work`)
        break
    }
    if (accepted.size === partitions.length && aborted) {
      if (h.uncancelable && !baselineFinished) {
        model.finish(`a`, `baseline`)
        baselineFinished = true
      }
      allAccepted.resolve()
    }
    await drain()
    checkpoint()
  }
  await withTestCleanup(
    async () => {
      load(`peer`, 1, [`peer`])
      commit(`peer-batch`, [`peer`], [`peer`])
      load(`a`, 2, facts, controller.signal)
      load(`c`, 3, facts)
      hold()
      if (h.constructive) {
        // Same fact partition for this prefix; the generated suffix and the
        // second profile vary response/batch cardinalities independently.
        await act({ type: `deliver`, index: 0 })
        await act({ type: `accept`, index: 0 })
        await act({ type: `apply` })
        if (h.cancelAt === 1) await act({ type: `abort` })
        await act({ type: `deliver`, index: 1 })
        await act({ type: `accept`, index: 1 })
        if (!aborted) await act({ type: `abort` })
      }
      // Every action consumes one previously outstanding delivery/acceptance,
      // cancellation, or actual application. This finite scheduler needs no
      // artificial bound on provider calls or knowledge of a production queue.
      while (
        delivered.size < responses.length ||
        accepted.size < partitions.length ||
        applied.size < accepted.size ||
        !aborted
      ) {
        const enabled: Array<Action> = []
        for (let i = 0; i < responses.length; i++)
          if (!delivered.has(i)) enabled.push({ type: `deliver`, index: i })
        for (let i = 0; i < partitions.length; i++)
          if (
            !accepted.has(i) &&
            partitions[i]!.every((fact) => available.has(fact))
          )
            enabled.push({ type: `accept`, index: i })
        if (applied.size < accepted.size) enabled.push({ type: `apply` })
        if (
          !aborted &&
          accepted.size >= Math.min(h.cancelAt, partitions.length)
        )
          enabled.push({ type: `abort` })
        if (!enabled.length)
          throw new Error(
            `illegal authored receipt schedule ${trace.join(`,`)}`,
          )
        const choice = h.choices[actionNumber % h.choices.length]!
        await act(enabled[choice % enabled.length]!)
      }
      await release()
      await drain()
      checkpoint()
      expect(outcomes.get(`a`)).toBe(`canceled`)
      expect(outcomes.get(`c`)).toBe(`success`)
      expect(outcomes.get(`peer`)).toBe(`success`)
      model.complete()
    },
    () => release(),
    () => source.cleanup(),
  )
  return reaches
}

it(`generates legal response/receipt/application/cancellation interleavings`, async () => {
  await runOracleCampaign(
    `CONVEX_LAZY_INTERLEAVING_ORACLE`,
    [
      `accept-before-last-response`,
      `apply-before-next-accept`,
      `abort-with-held-receipt`,
      `peer-accept-after-abort`,
      `uncancelable-accept-after-abort`,
      `abort-with-only-inflight-work`,
    ] as const,
    (reach, parameters) =>
      fc.assert(
        fc.asyncProperty(
          fc.record({
            responses: fc.integer({ min: 1, max: 3 }),
            batches: fc.integer({ min: 2, max: 3 }),
            choices: fc.array(fc.nat({ max: 100 }), {
              minLength: 1,
              maxLength: 24,
            }),
            cancelAt: fc.integer({ min: 1, max: 3 }),
            uncancelable: fc.boolean(),
          }),
          async (h) => {
            reach.beginHistory()
            await runInterleaving({
              ...h,
              responses: 3,
              batches: 3,
              constructive: true,
              uncancelable: false,
              cancelAt: 2,
            })
            const observed = await runInterleaving({
              ...h,
              responses: 3,
              batches: 3,
              constructive: true,
              uncancelable: true,
              cancelAt: 2,
            })
            const early = await runInterleaving({
              ...h,
              responses: 3,
              batches: 3,
              constructive: true,
              uncancelable: true,
              cancelAt: 1,
            })
            await runInterleaving({ ...h, constructive: false })
            for (const state of [
              `accept-before-last-response`,
              `apply-before-next-accept`,
              `abort-with-held-receipt`,
              `peer-accept-after-abort`,
              `uncancelable-accept-after-abort`,
              `abort-with-only-inflight-work`,
            ] as const) {
              expect(observed.has(state) || early.has(state)).toBe(true)
              reach.reach(state)
            }
          },
        ),
        { numRuns: 60, ...parameters },
      ),
    { fixedSeed: 20261027 },
  )
}, 60000)

it.each([`borrow-peer`, `first-only`, `premature-inflight-cancel`] as const)(
  `rejects %s under interleaving`,
  async (fault) => {
    await expect(
      runInterleaving(
        {
          responses: 3,
          batches: 3,
          choices: [0],
          cancelAt: fault === `premature-inflight-cancel` ? 1 : 2,
          constructive: true,
          uncancelable: true,
        },
        fault,
      ),
    ).rejects.toThrow(/receipt (law|model)/)
  },
)

it(`permits core fulfillment after abort once an uncancelable baseline applies`, () => {
  const model = new LazyReceiptModel()
  model.acquire(`a`, [`v1`])
  model.initiate(`a`, `baseline`)
  model.abort(`a`)
  model.accept(`receipt`, [`v1`], [`a`])
  expect(() => model.observe(`a`, `success`)).toThrow(`in-flight work`)
  model.finish(`a`, `baseline`)
  expect(() => model.observe(`a`, `success`)).toThrow(`receipt`)
  model.apply(`receipt`)
  model.observe(`a`, `success`)
  model.complete()
})

/**
 * The Convex offline bridge sends one durable idempotency key, then waits for
 * source acceptance. Argument construction and rejected server mutations are
 * terminal application failures; a sync failure after server confirmation may
 * be retried with that same key. This is the bridge's public retry contract,
 * received by the existing outbox engine's NonRetriableError boundary.
 *
 * The model is an ordered dependency list: args, mutation, sync. A failure
 * admits only its prefix. Generated histories choose the failing stage or no
 * failure, plus arbitrary text and durable keys. Each stage records its call;
 * the comparison checks the prefix and caller error after settlement. It does
 * not model outbox storage or leadership, whose owners remain in that package.
 * The real process-crash witness uses actual Convex mutations in e2e.
 */
import { createCollection, withAcceptedReceipt } from '@tanstack/db'
import fc from 'fast-check'
import { NonRetriableError } from '@tanstack/offline-transactions'
import { makeFunctionReference } from 'convex/server'
import { expect, it } from 'vitest'
import { convexCollectionOptions } from '../src/index'
import { convexOfflineMutation } from '../src/offline'
import { controlledClient, query, withTestCleanup } from './helpers'
import type { ConvexClient } from 'convex/browser'
import type { OfflineConfig } from '@tanstack/offline-transactions'

const mutation = makeFunctionReference<
  `mutation`,
  { idempotencyKey: string; text: string },
  null
>(`tasks:save`)
const stages = [`args`, `mutation`, `sync`] as const
const property = fc.asyncProperty(
  fc.record({
    failure: fc.constantFrom(`none`, ...stages),
    key: fc.string({ maxLength: 15 }),
    text: fc.string({ maxLength: 15 }),
  }),
  async ({ failure, key, text }) => {
    const trace: Array<string> = []
    const cause = new Error(`injected ${failure}`)
    const enter = (stage: string) => {
      trace.push(stage)
      if (failure === stage) throw cause
    }
    const send = (
      _ref: unknown,
      args: { idempotencyKey: string; text: string },
    ) => {
      enter(`mutation`)
      expect(args).toEqual({ idempotencyKey: key, text })
      return Promise.resolve(null)
    }
    const persist = convexOfflineMutation({
      client: { mutation: send } as unknown as Pick<ConvexClient, `mutation`>,
      mutation,
      getArgs: () => {
        enter(`args`)
        return { text }
      },
      collections: [
        {
          utils: {
            awaitSync: () => {
              enter(`sync`)
              return Promise.resolve()
            },
          },
        },
      ],
    })
    const params = {
      transaction: { mutations: [] },
      idempotencyKey: key,
    } as unknown as Parameters<OfflineConfig[`mutationFns`][string]>[0]
    const observed = await persist(params).then(
      () => ({ status: `fulfilled` as const }),
      (error: unknown) => ({ status: `rejected` as const, error }),
    )
    const boundary = stages.indexOf(failure as (typeof stages)[number])
    expect(trace).toEqual(
      boundary === -1 ? stages : stages.slice(0, boundary + 1),
    )
    expect(observed.status).toBe(boundary === -1 ? `fulfilled` : `rejected`)
    if (observed.status === `rejected`) {
      if (boundary < 2) expect(observed.error).toBeInstanceOf(NonRetriableError)
      else expect(observed.error).toBe(cause)
    }
  },
)

it(`preserves ordered replay and retry classification across bridge failures`, async () => {
  const seed = process.env.CONVEX_OFFLINE_ORACLE_SEED
  if (seed)
    await fc.assert(property, {
      seed: Number(seed),
      path: process.env.CONVEX_OFFLINE_ORACLE_PATH,
      numRuns: 60,
    })
  else {
    await fc.assert(property, { seed: 20261022, numRuns: 60 })
    await fc.assert(property, { numRuns: 60 })
  }
})

/**
 * Source acceptance is owed by the bridge's documented Collection boundary,
 * even on cold replay. This second driver uses real Collections, rather than
 * treating an awaitSync stub as evidence of source acceptance. The independent
 * model has one fact, whether a valid source snapshot has arrived. Before that
 * fact, a successful mutation cannot fulfill replay. A provider failure rejects
 * replay and preserves its cause. A valid empty snapshot counts as acceptance.
 *
 * Histories start idle, awaiting a result, or failed during startup, then cross
 * empty/nonempty snapshots and failures before the first result. The provider
 * holds callbacks at an explicit cut. We observe bridge settlement and public
 * rows before and after that delivery. This does not model durable outbox I/O.
 */
const sourceProperty = fc.asyncProperty(
  fc.record({
    state: fc.constantFrom(`idle`, `pending`, `startup-error`),
    delivery: fc.constantFrom(`empty`, `rows`, `error`, `cleanup`),
    text: fc.string({ maxLength: 15 }),
  }),
  async ({ state, delivery, text }) => {
    const transport = controlledClient()
    const cause = new Error(`source unavailable`)
    const collection = createCollection(
      convexCollectionOptions({
        client:
          state === `startup-error`
            ? {
                onUpdate: () => {
                  throw cause
                },
              }
            : transport.client,
        query,
        queryArgs: { owner: `alice` },
        getKey: (row) => row._id,
        gcTime: 0,
      }),
    )
    if (state !== `idle`) collection.startSyncImmediate()
    const persist = convexOfflineMutation({
      client: { mutation: () => Promise.resolve(null) } as unknown as Pick<
        ConvexClient,
        `mutation`
      >,
      mutation,
      getArgs: () => ({ text }),
      collections: [collection],
    })
    let outcome: { status: string; error?: unknown } = { status: `pending` }
    const pending = persist({
      transaction: { mutations: [] },
      idempotencyKey: `source-key`,
    } as unknown as Parameters<typeof persist>[0]).then(
      () => {
        outcome = { status: `fulfilled` }
      },
      (error) => {
        outcome = { status: `rejected`, error }
      },
    )
    await withTestCleanup(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (state === `startup-error`) {
          expect(outcome).toEqual({ status: `rejected`, error: cause })
        } else {
          expect(outcome.status).toBe(`pending`)
          expect(transport.counts().subscriptions).toBe(1)
          if (delivery === `error`) transport.error(cause)
          else if (delivery === `cleanup`) await collection.cleanup()
          else transport.emit(delivery === `empty` ? [] : [{ _id: `a`, text }])
          await pending
          expect(outcome.status).toBe(
            delivery === `error` || delivery === `cleanup`
              ? `rejected`
              : `fulfilled`,
          )
          if (delivery === `error`) {
            expect(outcome.error).toBe(cause)
            // Provider errors can recover in this run when a valid result arrives.
            transport.emit([{ _id: `a`, text }])
            await persist({
              transaction: { mutations: [] },
              idempotencyKey: `source-key`,
            } as unknown as Parameters<typeof persist>[0])
            expect(collection.get(`a`)?.text).toBe(text)
          }
          if (delivery === `rows`) expect(collection.get(`a`)?.text).toBe(text)
          if (delivery === `empty`) expect(collection.size).toBe(0)
        }
      },
      async () => {
        await collection.cleanup()
      },
    )
  },
)

it(`requires real source acceptance through cold replay histories`, async () => {
  const seed = process.env.CONVEX_OFFLINE_SOURCE_ORACLE_SEED
  if (seed)
    await fc.assert(sourceProperty, {
      seed: Number(seed),
      path: process.env.CONVEX_OFFLINE_SOURCE_ORACLE_PATH,
      numRuns: 60,
    })
  else {
    await fc.assert(sourceProperty, { seed: 20261023, numRuns: 60 })
    await fc.assert(sourceProperty, { numRuns: 60 })
  }
})

/**
 * A durable wrapper can reject before handing a committed source proposal to
 * core, as specified by whenSyncAccepted. Once that happens, later diffs cannot
 * assume that proposal became the source base. This run stays failed until an
 * explicit cleanup/restart establishes a fresh authoritative snapshot.
 *
 * The reference has two states, failed run and restarted run. Same-cache reads
 * and new provider callbacks cannot distinguish failed states, all reject with
 * the durable cause. Restart is the one action that changes that judgment.
 * Histories vary empty/nonempty initial snapshots and one to four retries with
 * unchanged or changed cached rows. Actual commit is deferred behind a rejected
 * durability promise, matching the persistence adapter's acceptance boundary.
 */
const acceptanceProperty = fc.asyncProperty(
  fc.boolean(),
  fc.array(fc.boolean(), { minLength: 1, maxLength: 4 }),
  fc.string({ maxLength: 12 }),
  async (empty, retries, text) => {
    const transport = controlledClient()
    const cause = new Error(`durable acceptance failed`)
    let rejectDurable!: (error: unknown) => void
    let durable = new Promise<void>((_resolve, reject) => {
      rejectDurable = reject
    })
    const options = convexCollectionOptions({
      client: transport.client,
      query,
      queryArgs: { owner: `alice` },
      getKey: (row) => row._id,
      gcTime: 0,
    })
    const collection = createCollection({
      ...options,
      sync: {
        ...options.sync,
        sync: (syncParams) =>
          options.sync.sync({
            ...syncParams,
            commit: () => {
              const visible = durable
                .then(async () => {
                  await syncParams.commit()
                })
                .then(() => undefined)
              return withAcceptedReceipt(visible, durable)
            },
          }),
      },
    })
    const persist = convexOfflineMutation({
      client: { mutation: () => Promise.resolve(null) } as unknown as Pick<
        ConvexClient,
        `mutation`
      >,
      mutation,
      getArgs: () => ({ text }),
      collections: [collection],
    })
    const params = {
      transaction: { mutations: [] },
      idempotencyKey: `same-durable-key`,
    } as unknown as Parameters<typeof persist>[0]
    await withTestCleanup(
      async () => {
        const pending = persist(params)
        const rejected = expect(pending).rejects.toBe(cause)
        await new Promise((resolve) => setTimeout(resolve, 0))
        const initial = empty ? [] : [{ _id: `a`, text }]
        transport.emit(initial)
        rejectDurable(cause)
        await rejected
        for (const changed of retries) {
          if (changed) transport.emit([{ _id: `a`, text: `new:${text}` }])
          await expect(persist(params)).rejects.toBe(cause)
          expect(collection.size).toBe(0)
        }
        await collection.cleanup()
        durable = Promise.resolve()
        transport.cache([{ _id: `a`, text: `restarted:${text}` }])
        collection.startSyncImmediate()
        await persist(params)
        expect(collection.get(`a`)?.text).toBe(`restarted:${text}`)
      },
      () => collection.cleanup(),
    )
  },
)

it(`keeps rejected source acceptance terminal until a fresh sync run`, async () => {
  const seed = process.env.CONVEX_OFFLINE_ACCEPTANCE_ORACLE_SEED
  if (seed)
    await fc.assert(acceptanceProperty, {
      seed: Number(seed),
      path: process.env.CONVEX_OFFLINE_ACCEPTANCE_ORACLE_PATH,
      numRuns: 60,
    })
  else {
    await fc.assert(acceptanceProperty, { seed: 20261023, numRuns: 60 })
    await fc.assert(acceptanceProperty, { numRuns: 60 })
  }
})

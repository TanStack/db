import { createCollection, withAcceptedReceipt } from '@tanstack/db'
import { NonRetriableError } from '@tanstack/offline-transactions'
import { makeFunctionReference } from 'convex/server'
import { expect, it, vi } from 'vitest'
import { convexCollectionOptions } from '../src/index'
import { convexOfflineMutation } from '../src/offline'
import { controlledClient, query } from './helpers'
import type { ConvexClient } from 'convex/browser'
import type { OfflineConfig } from '@tanstack/offline-transactions'

const mutation = makeFunctionReference<
  `mutation`,
  { idempotencyKey: string; text: string },
  null
>(`tasks:save`)
const params = {
  transaction: { mutations: [] },
  idempotencyKey: `durable-id`,
} as unknown as Parameters<OfflineConfig[`mutationFns`][string]>[0]

it(`sends the durable idempotency key and waits for sync acceptance`, async () => {
  const send = vi.fn(() => Promise.resolve(null))
  let accepted!: () => void
  const gate = new Promise<void>((resolve) => {
    accepted = resolve
  })
  const synced = vi.fn(() => gate)
  const persist = convexOfflineMutation({
    client: { mutation: send } as unknown as Pick<ConvexClient, `mutation`>,
    mutation,
    getArgs: () => ({ text: `hello` }),
    collections: [{ utils: { awaitSync: synced } }],
  })
  let settled = false
  const pending = persist(params).then(() => {
    settled = true
  })
  await vi.waitFor(() => expect(synced).toHaveBeenCalledOnce())
  expect(settled).toBe(false)
  expect(send).toHaveBeenCalledWith(mutation, {
    text: `hello`,
    idempotencyKey: `durable-id`,
  })
  accepted()
  await pending
  expect(settled).toBe(true)
})

it(`rolls back rejected server functions without durable retry`, async () => {
  const persist = convexOfflineMutation({
    client: {
      mutation: () => Promise.reject(new Error(`permission denied`)),
    } as unknown as Pick<ConvexClient, `mutation`>,
    mutation,
    getArgs: () => ({ text: `hello` }),
    collections: [],
  })
  await expect(persist(params)).rejects.toBeInstanceOf(NonRetriableError)
})

it.each([`idle`, `pending`, `failed`] as const)(
  `requires a real source snapshot during %s replay`,
  async (state) => {
    const transport = controlledClient()
    const startupError = new Error(`startup failed`)
    const collection = createCollection(
      convexCollectionOptions({
        client:
          state === `failed`
            ? {
                onUpdate: () => {
                  throw startupError
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
      getArgs: () => ({ text: `hello` }),
      collections: [collection],
    })
    let outcome: unknown = `pending`
    const pending = persist(params).then(
      () => {
        outcome = `fulfilled`
      },
      (error) => {
        outcome = error
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    try {
      if (state === `failed`) {
        expect(outcome).toBe(startupError)
      } else {
        expect(outcome).toBe(`pending`)
        expect(transport.counts().subscriptions).toBe(1)
        transport.emit([])
        await pending
        expect(outcome).toBe(`fulfilled`)
      }
    } finally {
      await collection.cleanup()
    }
  },
)

it(`rejects replay when a wrapping sync rejects source acceptance`, async () => {
  const transport = controlledClient()
  const cause = new Error(`durable sync failed`)
  let rejectAcceptance!: (error: unknown) => void
  const accepted = new Promise<void>((_resolve, reject) => {
    rejectAcceptance = reject
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
            const visible = syncParams.commit()
            return withAcceptedReceipt(
              Promise.resolve(visible).then(() => undefined),
              accepted,
            )
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
    getArgs: () => ({ text: `hello` }),
    collections: [collection],
  })
  const pending = persist(params)
  const rejected = expect(pending).rejects.toBe(cause)
  await new Promise((resolve) => setTimeout(resolve, 0))
  transport.emit([])
  rejectAcceptance(cause)
  try {
    await rejected
  } finally {
    await collection.cleanup()
  }
})

it(`requires a new sync run after durable acceptance fails`, async () => {
  const transport = controlledClient()
  const cause = new Error(`durable source failure`)
  let rejectAcceptance!: (error: unknown) => void
  let durable = new Promise<void>((_resolve, reject) => {
    rejectAcceptance = reject
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
  const waiting = collection.utils.awaitSync()
  const rejected = expect(waiting).rejects.toBe(cause)
  transport.emit([])
  rejectAcceptance(cause)
  await rejected
  try {
    await expect(collection.utils.awaitSync()).rejects.toBe(cause)
    transport.emit([{ _id: `a`, text: `later callback` }])
    await expect(collection.utils.awaitSync()).rejects.toBe(cause)
    await collection.cleanup()
    durable = Promise.resolve()
    collection.startSyncImmediate()
    await collection.utils.awaitSync()
    expect(collection.get(`a`)?.text).toBe(`later callback`)
  } finally {
    await collection.cleanup()
  }
})

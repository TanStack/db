import { NonRetriableError } from '@tanstack/offline-transactions'
import { makeFunctionReference } from 'convex/server'
import { expect, it, vi } from 'vitest'
import { convexOfflineMutation } from '../src/offline'
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

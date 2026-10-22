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
import fc from 'fast-check'
import { NonRetriableError } from '@tanstack/offline-transactions'
import { makeFunctionReference } from 'convex/server'
import { expect, it } from 'vitest'
import { convexOfflineMutation } from '../src/offline'
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

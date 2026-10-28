import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { electricCollectionOptions } from '../src/electric'
import type { Message } from '@electric-sql/client'

/**
 * Outcome checklist for a progressive load that waits on the established
 * snapshot.
 *
 * Outside its buffered initial sync, a progressive `loadSubset` installs no
 * rows. It settles when the sync that establishes its rows completes, so its
 * success never precedes them (applied settlement, ARCHITECTURE.md law 7).
 * `electric-live-query.test.ts` owns the settle outcome for a reset before
 * and during the fetch. The retry-decision law in
 * `electric-oracle.property.test.ts` owns the outcomes of a stream error, an
 * `onError` decision, an Electric client give-up, an external abort, and
 * cleanup. This file pins two outcomes outside that grammar:
 *
 * - a must-refetch after the first full sync renews the wait, so a new load
 *   settles only with the replacement snapshot;
 * - an aborted demand rejects with its abort reason, before or during the
 *   wait, and a later snapshot does not settle it.
 *
 * The abort history reaches the wait through a must-refetch before the first
 * up-to-date; the renewal history resets after it.
 */

type User = { id: number; name: string }

const mockSubscribe = vi.fn()
const mockFetchSnapshot = vi.fn()

vi.mock(`@electric-sql/client`, async () => {
  const actual = await vi.importActual(`@electric-sql/client`)
  return {
    ...actual,
    ShapeStream: vi.fn(() => ({
      subscribe: mockSubscribe,
      unsubscribeAll: vi.fn(),
      fetchSnapshot: mockFetchSnapshot,
      requestSnapshot: vi.fn(),
    })),
  }
})

let subscriber: (messages: Array<Message<User>>) => void

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchSnapshot.mockResolvedValue({ metadata: {}, data: [] })
  mockSubscribe.mockImplementation((callback) => {
    subscriber = callback
    return () => {}
  })
})

const alice: User = { id: 1, name: `Alice` }
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function createProgressive(id: string) {
  return createCollection({
    ...electricCollectionOptions({
      id,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `users` },
      },
      syncMode: `progressive`,
      getKey: (user: User) => user.id,
    }),
    startSync: true,
  })
}

function fullSync(users: Array<User>) {
  subscriber([
    ...users.map((user) => ({
      key: user.id.toString(),
      value: user,
      headers: { operation: `insert` as const },
    })),
    { headers: { control: `up-to-date` as const } },
  ])
}

const mustRefetch = () => subscriber([{ headers: { control: `must-refetch` } }])

// Record a load's outcome without leaving a rejection unhandled.
function observe(result: true | Promise<void>) {
  const outcome: { state: string; error?: unknown } = { state: `pending` }
  void Promise.resolve(result).then(
    () => {
      outcome.state = `fulfilled`
    },
    (error: unknown) => {
      outcome.state = `rejected`
      outcome.error = error
    },
  )
  return outcome
}

describe(`progressive load waiting on the established snapshot`, () => {
  it(`settles a load after a later must-refetch only with the replacement snapshot`, async () => {
    const collection = createProgressive(`hold-renew`)
    fullSync([alice])
    expect(collection.status).toBe(`ready`)

    mustRefetch()
    const load = observe(collection._sync.loadSubset({ limit: 1 }))
    await flush()
    expect(load.state).toBe(`pending`)

    const renamed = { ...alice, name: `Alice again` }
    fullSync([renamed])
    await flush()
    expect(load.state).toBe(`fulfilled`)
    expect(collection.get(alice.id)?.name).toBe(renamed.name)
    await collection.cleanup()
  })

  it.each([`before`, `during`] as const)(
    `rejects a demand aborted %s the wait`,
    async (when) => {
      const collection = createProgressive(`hold-abort-${when}`)
      mustRefetch()
      const controller = new AbortController()
      if (when === `before`) controller.abort()
      const load = observe(
        collection._sync.loadSubset({ limit: 1, signal: controller.signal }),
      )
      await flush()
      if (when === `during`) {
        expect(load.state).toBe(`pending`)
        controller.abort()
        await flush()
      }
      expect(load.state).toBe(`rejected`)
      expect((load.error as Error).name).toBe(`AbortError`)

      fullSync([alice])
      await flush()
      expect(load.state).toBe(`rejected`)
      await collection.cleanup()
    },
  )
})

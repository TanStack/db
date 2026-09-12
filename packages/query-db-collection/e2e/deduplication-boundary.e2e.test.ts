import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/query-core'
import { createCollection, createLiveQueryCollection, gt } from '@tanstack/db'
import { createDeferred } from '../../db/src/deferred'
import { queryCollectionOptions } from '../src/query'
import type { LoadSubsetOptions } from '@tanstack/db'
import type { User } from '../../db-collection-e2e/src/types'

type Threshold = 30 | 50
type Outcome = 'pending' | 'fulfilled' | 'rejected'

function thresholdFromRequest(
  options: LoadSubsetOptions | undefined,
): Threshold {
  if (
    !options ||
    Object.keys(options).some(
      (key) =>
        !['where', 'orderBy', 'offset', 'limit', 'cursor', 'signal'].includes(
          key,
        ),
    )
  )
    throw new Error('Unexpected finite demand request fields')
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    throw new Error('Expected a live request AbortSignal')
  if (
    options.limit !== undefined ||
    options.cursor !== undefined ||
    (options.offset !== undefined && options.offset !== 0) ||
    (options.orderBy !== undefined && options.orderBy.length !== 0)
  )
    throw new Error('Unexpected finite demand order/window')
  const where = options.where
  if (where?.type !== 'func' || where.name !== 'gt' || where.args.length !== 2)
    throw new Error('Expected one finite age threshold')
  const [field, value] = where.args
  if (
    field?.type !== 'ref' ||
    field.path.length !== 1 ||
    field.path[0] !== 'age' ||
    value?.type !== 'val' ||
    (value.value !== 30 && value.value !== 50)
  )
    throw new Error('Unexpected finite age threshold operands')
  return value.value
}

function captureUsers(rows: Iterable<User>): Array<User> {
  return Array.from(rows, (row) =>
    structuredClone({
      id: row.id,
      name: row.name,
      email: row.email,
      age: row.age,
      isActive: row.isActive,
      createdAt: row.createdAt,
      metadata: row.metadata,
      deletedAt: row.deletedAt,
    }),
  )
}

function assertUsers(actual: Array<User>, expected: Array<User>) {
  const byId = (left: User, right: User) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  expect([...actual].sort(byId)).toStrictEqual([...expected].sort(byId))
}

function assertEntries(entries: Array<Threshold>) {
  expect(entries).toStrictEqual([30, 50])
}

describe('Query provider demand boundary', () => {
  it('shares one held provider call for equivalent consumers and isolates a distinct demand', async () => {
    const initial: Array<User> = [40, 45, 60].map((age, index) => ({
      id: `demand-user-${index}`,
      name: `Demand user ${index}`,
      email: null,
      age,
      isActive: true,
      createdAt: new Date(1_700_000_000_123 + index),
      metadata: { ordinal: index },
      deletedAt: null,
    }))
    const expectedAll = structuredClone(initial)
    const expectedDistinct = structuredClone([initial[2]!])
    const backend = structuredClone(initial)
    const firstGate = createDeferred<void>()
    const distinctGate = createDeferred<void>()
    const firstEntered = createDeferred<void>()
    const distinctEntered = createDeferred<void>()
    const entries: Array<{
      threshold: Threshold
      request: Omit<LoadSubsetOptions, 'signal'>
      signal: AbortSignal | undefined
    }> = []
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Number.POSITIVE_INFINITY,
          gcTime: Number.POSITIVE_INFINITY,
        },
      },
    })
    const source = createCollection(
      queryCollectionOptions({
        id: 'held-query-demand-source',
        queryClient: client,
        queryKey: ['e2e', 'held-demand'],
        syncMode: 'on-demand',
        startSync: false,
        getKey: (user: User) => user.id,
        queryFn: async (context) => {
          const request = context.meta?.loadSubsetOptions
          // Validate the complete admitted request before choosing a response.
          const threshold = thresholdFromRequest(request)
          // Request data is immutable; the separately retained signal has a
          // live lifecycle and must not be replaced by a serialized copy.
          const { signal, ...requestData } = request!
          entries.push({
            threshold,
            request: structuredClone(requestData),
            signal,
          })
          if (threshold === 30) {
            firstEntered.resolve()
            await firstGate.promise
          } else {
            distinctEntered.resolve()
            await distinctGate.promise
          }
          return structuredClone(backend.filter((user) => user.age > threshold))
        },
      }),
    )
    const queries: Array<{ cleanup: () => Promise<void> }> = []
    const outcomes: Array<Outcome> = ['pending', 'pending', 'pending']
    const callerErrors: Array<unknown> = []
    const callers: Array<Promise<void>> = []
    const errors: Array<unknown> = []
    const archives: Array<() => void> = []
    const start = (query: { preload: () => Promise<void> }, index: number) => {
      const handled = query.preload().then(
        () => {
          outcomes[index] = 'fulfilled'
        },
        (error: unknown) => {
          outcomes[index] = 'rejected'
          callerErrors.push(error)
        },
      )
      callers.push(handled)
      return handled
    }
    try {
      const first = createLiveQueryCollection((q) =>
        q.from({ user: source }).where(({ user }) => gt(user.age, 30)),
      )
      queries.push(first)
      const peer = createLiveQueryCollection((q) =>
        q.from({ user: source }).where(({ user }) => gt(user.age, 30)),
      )
      queries.push(peer)
      const distinct = createLiveQueryCollection((q) =>
        q.from({ user: source }).where(({ user }) => gt(user.age, 50)),
      )
      queries.push(distinct)
      start(first, 0)
      start(peer, 1)
      await vi.waitFor(() => expect(firstEntered.isPending()).toBe(false))
      start(distinct, 2)
      await vi.waitFor(() => expect(distinctEntered.isPending()).toBe(false))
      assertEntries(entries.map((entry) => entry.threshold))
      expect(outcomes).toStrictEqual(['pending', 'pending', 'pending'])
      const enteredSnapshot = entries.map((entry) => ({
        ...entry,
        request: structuredClone(entry.request),
      }))
      for (const entry of enteredSnapshot)
        expect(thresholdFromRequest(entry.request)).toBe(entry.threshold)

      distinctGate.resolve()
      await vi.waitFor(() => expect(outcomes[2]).toBe('fulfilled'))
      await callers[2]
      expect(outcomes).toStrictEqual(['pending', 'pending', 'fulfilled'])
      const distinctRows = captureUsers(distinct.values())
      assertUsers(distinctRows, expectedDistinct)
      assertEntries(entries.map((entry) => entry.threshold))
      archives.push(() => assertUsers(distinctRows, expectedDistinct))

      firstGate.resolve()
      await vi.waitFor(() =>
        expect(outcomes).toStrictEqual(['fulfilled', 'fulfilled', 'fulfilled']),
      )
      await Promise.all(callers)
      expect(outcomes).toStrictEqual(['fulfilled', 'fulfilled', 'fulfilled'])
      expect(callerErrors).toStrictEqual([])
      const firstRows = captureUsers(first.values())
      const peerRows = captureUsers(peer.values())
      assertUsers(firstRows, expectedAll)
      assertUsers(peerRows, expectedAll)
      assertUsers(captureUsers(distinct.values()), expectedDistinct)
      assertEntries(entries.map((entry) => entry.threshold))
      archives.push(
        () => assertUsers(firstRows, expectedAll),
        () => assertUsers(peerRows, expectedAll),
      )

      const wrongRows = structuredClone(peerRows)
      wrongRows[0]!.name += '-wrong'
      expect(() => assertUsers(wrongRows, expectedAll)).toThrow()
      const collapsedEntries = entries
        .map((entry) => entry.threshold)
        .slice(0, 1)
      expect(() => assertEntries(collapsedEntries)).toThrow()
      expect(() =>
        assertEntries([...entries.map((entry) => entry.threshold), 30]),
      ).toThrow()
      await first.cleanup()
      await vi.waitFor(() => {
        assertUsers(captureUsers(peer.values()), expectedAll)
        assertUsers(captureUsers(distinct.values()), expectedDistinct)
        assertEntries(entries.map((entry) => entry.threshold))
      })
      expect(entries).toStrictEqual(enteredSnapshot)
      archives.push(() => expect(entries).toStrictEqual(enteredSnapshot))
    } catch (error) {
      errors.push(error)
    } finally {
      firstGate.resolve()
      distinctGate.resolve()
      for (const query of queries) {
        try {
          await query.cleanup()
        } catch (error) {
          errors.push(error)
        }
      }
      try {
        await source.cleanup()
      } catch (error) {
        errors.push(error)
      }
      await Promise.all(callers)
      try {
        client.clear()
      } catch (error) {
        errors.push(error)
      }
      for (const check of archives) {
        try {
          check()
        } catch (error) {
          errors.push(error)
        }
      }
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1)
      throw new AggregateError(errors, 'Demand history and cleanup failed')
  })
})

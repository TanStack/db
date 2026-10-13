import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import { createDeferred } from '../../db/src/deferred.js'
import { persistedCollectionOptions } from '../src/index.js'
import type { Collection, LoadSubsetOptions } from '@tanstack/db'
import type { PersistenceAdapter } from '../src/index.js'

/**
 * # Does the persisted wrapper carry initial-query readiness?
 *
 * ARCHITECTURE.md law 10 makes a settled `loadSubset` the readiness evidence
 * for an on-demand source, and law 7 says a successful load settles only after
 * its rows are visible. The persisted wrapper composes two loads: it hydrates
 * the subset from local storage, then awaits the upstream source's load. The
 * upstream here never calls `markReady()`, as a progressive source would not
 * during its full sync. Each witness records the rows visible at the
 * query's first-ready transition.
 */

type Row = { id: string; group: string }

function storageAdapter(local: ReadonlyArray<Row>) {
  const read = createDeferred<void>()
  const adapter: PersistenceAdapter = {
    loadSubset: async () => {
      await read.promise
      return local.map((value) => ({ key: value.id, value }))
    },
    loadResumeSnapshot: () =>
      Promise.resolve({
        rows: [],
        keySet: { status: `consistent` },
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }),
    applyCommittedTx: async () => {},
    ensureIndex: async () => {},
  }
  return { adapter, read }
}

type Upstream = {
  calls: Array<LoadSubsetOptions>
  respond: (rows: ReadonlyArray<Row>) => void
  fail: (error: unknown) => void
}

function persistedOnDemand(
  adapter: PersistenceAdapter,
): [Collection<Row, string, any>, Upstream] {
  let pending = createDeferred<void>()
  let write!: (rows: ReadonlyArray<Row>) => void
  const upstream: Upstream = {
    calls: [],
    respond: (rows) => {
      write(rows)
      pending.resolve()
    },
    fail: (error) => pending.reject(error),
  }
  const collection = createCollection(
    persistedCollectionOptions<Row, string>({
      id: `exposure-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      persistence: { adapter },
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          write = (rows) => {
            params.begin()
            for (const value of rows) params.write({ type: `insert`, value })
            params.commit()
          }
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              upstream.calls.push(options)
              pending = createDeferred<void>()
              return pending.promise
            },
          }
        },
      },
    }),
  )
  onTestFinished(() => collection.cleanup())
  return [collection, upstream]
}

function groupA(source: Collection<Row, string, any>) {
  const query = createLiveQueryCollection((q) =>
    q.from({ row: source }).where(({ row }) => eq(row.group, `a`)),
  )
  onTestFinished(() => query.cleanup())
  return query
}

function rowsAtFirstReady(query: Collection<any, any, any>) {
  const seen: { rows?: Array<unknown> } = {}
  query.onFirstReady(() => {
    seen.rows = query.toArray.map((row: Row) => row.id).sort()
  })
  return seen
}

describe(`persisted on-demand initial readiness follows the composed load`, () => {
  it(`is first ready with local and upstream subset rows visible`, async () => {
    const storage = storageAdapter([{ id: `local`, group: `a` }])
    const [source, upstream] = persistedOnDemand(storage.adapter)
    const query = groupA(source)
    const seen = rowsAtFirstReady(query)
    const preload = query.preload()

    storage.read.resolve()
    await vi.waitFor(() => expect(upstream.calls).toHaveLength(1))
    expect(query.isReady()).toBe(false)
    upstream.respond([{ id: `remote`, group: `a` }])
    await preload

    expect(source.isReady()).toBe(false)
    expect(seen.rows).toEqual([`local`, `remote`])
  })

  it(`an upstream load failure errors the query and never readies it`, async () => {
    const storage = storageAdapter([])
    const [source, upstream] = persistedOnDemand(storage.adapter)
    const warned = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const loggedError = vi.spyOn(console, `error`).mockImplementation(() => {})
    onTestFinished(() => {
      warned.mockRestore()
      loggedError.mockRestore()
    })
    const query = groupA(source)
    const seen = rowsAtFirstReady(query)
    void query.preload().catch(() => {})
    storage.read.resolve()
    await vi.waitFor(() => expect(upstream.calls).toHaveLength(1))
    upstream.fail(new Error(`upstream failed`))
    await vi.waitFor(() => expect(query.status).toBe(`error`))
    expect(seen.rows).toBeUndefined()
  })

  it(`a demand released during local hydration starts no upstream load`, async () => {
    const storage = storageAdapter([{ id: `local`, group: `a` }])
    const [source, upstream] = persistedOnDemand(storage.adapter)
    const query = groupA(source)
    void query.preload().catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 0))
    await query.cleanup()
    storage.read.resolve()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(upstream.calls.every((options) => options.signal?.aborted)).toBe(
      true,
    )
    expect(source.has(`remote`)).toBe(false)
  })
})

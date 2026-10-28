import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import { createDeferred } from '../../db/src/deferred.js'
import { persistedCollectionOptions } from '../src/index.js'
import type { Collection, LoadSubsetOptions } from '@tanstack/db'
import type { PersistenceAdapter } from '../src/index.js'

/**
 * # What does an on-demand persisted query show while the network is pending?
 *
 * This file records current behavior; it does not state a contract. It
 * gathers evidence for a design question: whether `initialRender:
 * network-first` should extend to on-demand sources, where the core's
 * readiness evidence is a settled subset request rather than Collection
 * readiness (live-query ARCHITECTURE.md, "Initial readiness").
 *
 * The source is a generic on-demand sync, not Electric. Its upstream
 * `loadSubset` either stays pending (an offline network) or settles at once
 * without writing (a source that already holds complete local rows, as
 * ARCHITECTURE.md describes for a complete resume). The SQLite adapter holds
 * a complete, partial, or empty cache for the queried subset. The wrapper
 * cannot tell a complete cache from a partial one; both read back as rows.
 *
 * Checkpoint: after the local read settles and the upstream load has started,
 * then again after a delay longer than any plausible microtask scheduling.
 */

type Row = { id: string; group: string }

function storageAdapter(local: ReadonlyArray<Row>) {
  const adapter: PersistenceAdapter = {
    loadSubset: () =>
      Promise.resolve(local.map((value) => ({ key: value.id, value }))),
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
  return adapter
}

type UpstreamMode = `offline` | `settles-at-once`

function persistedOnDemand(adapter: PersistenceAdapter, mode: UpstreamMode) {
  const calls: Array<LoadSubsetOptions> = []
  const collection = createCollection(
    persistedCollectionOptions<Row, string>({
      id: `offline-witness-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      persistence: { adapter },
      syncMode: `on-demand`,
      sync: {
        sync: () => ({
          loadSubset: (options: LoadSubsetOptions) => {
            calls.push(options)
            return mode === `offline`
              ? createDeferred<void>().promise
              : Promise.resolve()
          },
        }),
      },
    }),
  )
  onTestFinished(() => collection.cleanup())
  return { collection, calls }
}

function groupA(source: Collection<Row, string, any>) {
  const query = createLiveQueryCollection((q) =>
    q.from({ row: source }).where(({ row }) => eq(row.group, `a`)),
  )
  onTestFinished(() => query.cleanup())
  return query
}

function observe(
  source: Collection<Row, string, any>,
  query: Collection<any, any, any>,
) {
  return {
    queryStatus: query.status,
    queryReady: query.isReady(),
    queryRows: query.toArray.map((row: Row) => row.id).sort(),
    sourceStatus: source.status,
    sourceRows: source.toArray.map((row) => row.id).sort(),
  }
}

async function runHistory(local: ReadonlyArray<Row>, mode: UpstreamMode) {
  const { collection: source, calls } = persistedOnDemand(
    storageAdapter(local),
    mode,
  )
  const query = groupA(source)
  let preloadSettled = false
  void query.preload().then(
    () => (preloadSettled = true),
    () => (preloadSettled = true),
  )
  await vi.waitFor(() => expect(calls).toHaveLength(1))
  const afterUpstreamStart = { ...observe(source, query), preloadSettled }
  await new Promise((resolve) => setTimeout(resolve, 50))
  const afterDelay = { ...observe(source, query), preloadSettled }
  return { afterUpstreamStart, afterDelay }
}

const complete = [
  { id: `a1`, group: `a` },
  { id: `a2`, group: `a` },
]
const partial = [{ id: `a1`, group: `a` }]

describe(`on-demand persisted query with a pending network (current behavior)`, () => {
  it(`offline upstream, complete local subset`, async () => {
    const { afterDelay } = await runHistory(complete, `offline`)
    console.info(`offline/complete`, afterDelay)
    expect(afterDelay.queryReady).toBe(false)
    expect(afterDelay.preloadSettled).toBe(false)
  })

  it(`offline upstream, partial local subset`, async () => {
    const { afterDelay } = await runHistory(partial, `offline`)
    console.info(`offline/partial`, afterDelay)
    expect(afterDelay.queryReady).toBe(false)
    expect(afterDelay.preloadSettled).toBe(false)
  })

  it(`offline upstream, empty local cache`, async () => {
    const { afterDelay } = await runHistory([], `offline`)
    console.info(`offline/empty`, afterDelay)
    expect(afterDelay.queryReady).toBe(false)
    expect(afterDelay.preloadSettled).toBe(false)
  })

  it(`upstream that settles at once, complete local subset`, async () => {
    const { afterDelay } = await runHistory(complete, `settles-at-once`)
    console.info(`settles/complete`, afterDelay)
    expect(afterDelay.queryReady).toBe(true)
    expect(afterDelay.queryRows).toEqual([`a1`, `a2`])
  })

  it(`upstream that settles at once, empty local cache`, async () => {
    const { afterDelay } = await runHistory([], `settles-at-once`)
    console.info(`settles/empty`, afterDelay)
    expect(afterDelay.queryReady).toBe(true)
    expect(afterDelay.queryRows).toEqual([])
  })
})

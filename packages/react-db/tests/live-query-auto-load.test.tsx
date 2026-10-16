import { act, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  createCollection,
  eq,
  getLiveQueryHash,
  prepareLiveQueryValue,
} from '@tanstack/db'
import { useLiveInfiniteQuery, useLiveQuery } from '../src'
import { useLiveQueryForSuspense } from '../src/useLiveQuery'
import { getLiveQueryResultInfo } from '../src/live-query-internals'
import type { InitialQueryBuilder, SyncConfig } from '@tanstack/db'

type Row = { id: number; name: string }
function source() {
  let writer!: Parameters<SyncConfig<Row>[`sync`]>[0]
  const load = vi.fn(() => true as const)
  const unload = vi.fn()
  const start = vi.fn((params: typeof writer) => {
    writer = params
    return { loadSubset: load, unloadSubset: unload }
  })
  const collection = createCollection<Row>({
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: { sync: start },
  })
  return {
    collection,
    start,
    load,
    unload,
    ingest(rows: Array<Row>) {
      collection.startSyncImmediate()
      writer.begin()
      for (const value of rows) writer.write({ type: `insert`, value })
      writer.commit()
    },
  }
}

describe(`React query automatic loading`, () => {
  for (const identity of [`key`, `deps`] as const) {
    it(`keeps the mode separate from caller ${identity} elements`, async () => {
      const src = source()
      const hook = renderHook(
        ({ autoLoad }) => {
          const key = autoLoad ? [`rows`, [`autoLoad`, false]] : [`rows`]
          return useLiveQuery(
            {
              query: (q) => q.from({ row: src.collection }),
              autoLoad,
              ...(identity === `key` ? { queryKey: key } : {}),
            },
            identity === `deps` ? key : undefined,
          )
        },
        { initialProps: { autoLoad: false as boolean | undefined } },
      )
      const local = hook.result.current.collection
      hook.rerender({ autoLoad: true })
      const remote = hook.result.current.collection
      expect(remote).not.toBe(local)
      expect(src.load).toHaveBeenCalledTimes(1)
      hook.unmount()
      await Promise.all([local.cleanup(), remote.cleanup()])
      await src.collection.cleanup()
    })
  }
  it(`is ready on empty memory and reacts to independently ingested rows in StrictMode`, async () => {
    const src = source()
    const hook = renderHook(
      ({ enabled }) =>
        useLiveQuery({
          autoLoad: false,
          query: (q) =>
            enabled
              ? q
                  .from({ row: src.collection })
                  .where(({ row }) => eq(row.name, `a`))
              : undefined,
        }),
      { initialProps: { enabled: true }, wrapper: StrictMode },
    )
    expect(hook.result.current.data).toEqual([])
    expect(hook.result.current.isReady).toBe(true)
    expect(src.start).not.toHaveBeenCalled()
    act(() =>
      src.ingest([
        { id: 1, name: `a` },
        { id: 2, name: `b` },
      ]),
    )
    expect(hook.result.current.data?.map((row) => row.id)).toEqual([1])
    const first = hook.result.current.collection
    hook.rerender({ enabled: false })
    expect(hook.result.current.isEnabled).toBe(false)
    hook.rerender({ enabled: true })
    expect(hook.result.current.data?.map((row) => row.id)).toEqual([1])
    expect(src.load).not.toHaveBeenCalled()
    const collection = hook.result.current.collection
    hook.unmount()
    await first?.cleanup()
    await collection?.cleanup()
    expect(src.unload).not.toHaveBeenCalled()
    await src.collection.cleanup()
  })

  for (const identity of [`derived`, `key`, `deps`] as const) {
    it(`switches automatic loading with ${identity} identity`, async () => {
      const src = source()
      const hook = renderHook(
        ({ autoLoad }) =>
          useLiveQuery(
            {
              query: (q) => q.from({ row: src.collection }),
              autoLoad,
              ...(identity === `key` ? { queryKey: [`same`] } : {}),
            },
            identity === `deps` ? [] : undefined,
          ),
        { initialProps: { autoLoad: false as boolean | undefined } },
      )
      const local = hook.result.current.collection
      expect(src.load).not.toHaveBeenCalled()
      hook.rerender({ autoLoad: true })
      const remote = hook.result.current.collection
      expect(remote).not.toBe(local)
      expect(src.load).toHaveBeenCalledTimes(1)
      hook.rerender({ autoLoad: undefined })
      expect(hook.result.current.collection).toBe(remote)
      expect(src.load).toHaveBeenCalledTimes(1)
      hook.rerender({ autoLoad: false })
      expect(hook.result.current.collection).not.toBe(remote)
      expect(src.load).toHaveBeenCalledTimes(1)
      const last = hook.result.current.collection
      hook.unmount()
      await Promise.all([local.cleanup(), remote.cleanup(), last.cleanup()])
      await src.collection.cleanup()
    })
  }

  it(`keeps local and fetching Suspense entries separate with the same explicit key`, async () => {
    const src = source()
    const config = {
      queryKey: [`shared`],
      query: (q: InitialQueryBuilder) => q.from({ row: src.collection }),
    }
    const hook = renderHook(() => ({
      local: useLiveQueryForSuspense({ ...config, autoLoad: false }, undefined),
      remote: useLiveQueryForSuspense(config, undefined),
    }))
    const { local, remote } = hook.result.current
    expect(local.collection).not.toBe(remote.collection)
    expect(src.load).toHaveBeenCalledTimes(1)
    expect(getLiveQueryResultInfo(local).queryHash).toBe(
      getLiveQueryHash(
        prepareLiveQueryValue({ ...config, autoLoad: false }, undefined),
        config.queryKey,
      ),
    )
    hook.unmount()
    await Promise.all([
      local.collection?.cleanup(),
      remote.collection?.cleanup(),
    ])
    await src.collection.cleanup()
  })

  it(`paginates local rows and resets pages when acquisition mode changes`, async () => {
    const src = source()
    src.ingest(Array.from({ length: 5 }, (_, id) => ({ id, name: `row` })))
    const hook = renderHook(
      ({ autoLoad }) =>
        useLiveInfiniteQuery(
          (q) => q.from({ row: src.collection }).orderBy(({ row }) => row.id),
          { autoLoad, pageSize: 2, queryKey: [`pages`] },
        ),
      { initialProps: { autoLoad: false }, wrapper: StrictMode },
    )
    expect(hook.result.current.data.map((row) => row.id)).toEqual([0, 1])
    await act(() => hook.result.current.fetchNextPage())
    expect(hook.result.current.data.map((row) => row.id)).toEqual([0, 1, 2, 3])
    await act(() => hook.result.current.fetchNextPage())
    expect(hook.result.current.hasNextPage).toBe(false)
    expect(src.load).not.toHaveBeenCalled()
    const local = hook.result.current.collection
    hook.rerender({ autoLoad: true })
    expect(hook.result.current.collection).not.toBe(local)
    expect(hook.result.current.pages).toHaveLength(1)
    expect(src.load).toHaveBeenCalled()
    const remote = hook.result.current.collection
    hook.unmount()
    await Promise.all([local?.cleanup(), remote?.cleanup()])
    await src.collection.cleanup()
  })
})

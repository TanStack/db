import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import { trailBaseCollectionOptions } from '../src/trailbase'
import { createDeferred } from '../../db/src/deferred'
import { MockRecordApi } from './mock-record-api'
import type { Collection } from '@tanstack/db'
import type { Event, ListResponse } from 'trailbase'

/**
 * # Does TrailBase settlement carry initial-query readiness?
 *
 * ARCHITECTURE.md law 10 makes a settled `loadSubset` the readiness evidence
 * for an on-demand source, and law 7 says a successful load settles only after
 * its rows are visible. These witnesses drive the TrailBase sync through a
 * scripted record API under a real live query and record the rows visible at
 * the first-ready transition. The last two witnesses check that an on-demand
 * load fetches only after the change subscription starts, so no change falls
 * between the fetch and the listener (`tests/ORACLE.md` owns that law).
 */

type Data = { id: number | null; updated: number | null; data: string }

function rowsAtFirstReady(query: Collection<any, any, any>) {
  const seen: { rows?: Array<unknown> } = {}
  query.onFirstReady(() => {
    seen.rows = query.toArray.map((row: Data) => row.id).sort()
  })
  return seen
}

// Record a load's outcome so a load that never settles fails an assertion at
// an explicit checkpoint instead of timing out.
function settlement(result: unknown) {
  const record = { state: `pending` }
  void Promise.resolve(result).then(
    () => {
      record.state = `fulfilled`
    },
    (error: unknown) => {
      record.state = `rejected:${(error as Error).name}`
    },
  )
  return record
}

function createSource(recordApi: MockRecordApi<Data>, onDemand = true) {
  const source = createCollection(
    trailBaseCollectionOptions({
      recordApi,
      getKey: (item: Data) => item.id ?? -1,
      startSync: true,
      ...(onDemand ? { syncMode: `on-demand` as const } : {}),
      parse: {},
      serialize: {},
    }),
  )
  onTestFinished(() => source.cleanup())
  return source
}

function visible(source: ReturnType<typeof createSource>) {
  const query = createLiveQueryCollection((q) =>
    q.from({ row: source }).where(({ row }) => eq(row.data, `visible`)),
  )
  onTestFinished(() => query.cleanup())
  return query
}

const rows: ListResponse<Data> = {
  records: [
    { id: 1, updated: 0, data: `visible` },
    { id: 2, updated: 0, data: `visible` },
  ],
}

describe(`TrailBase initial readiness follows applied subset settlement`, () => {
  it(`an on-demand query is first ready with its subset rows visible`, async () => {
    const recordApi = new MockRecordApi<Data>()
    const list = createDeferred<ListResponse<Data>>()
    recordApi.list.mockReturnValue(list.promise)
    recordApi.subscribe.mockResolvedValue(new TransformStream<Event>().readable)
    const query = visible(createSource(recordApi))
    const seen = rowsAtFirstReady(query)
    const preload = query.preload()
    await vi.waitFor(() => expect(recordApi.list).toHaveBeenCalled())
    expect(query.isReady()).toBe(false)
    list.resolve(rows)
    await preload
    expect(seen.rows).toEqual([1, 2])
  })

  it(`a failed on-demand list errors the query and never readies it`, async () => {
    const recordApi = new MockRecordApi<Data>()
    recordApi.list.mockRejectedValue(new Error(`list failed`))
    recordApi.subscribe.mockResolvedValue(new TransformStream<Event>().readable)
    const loggedError = vi.spyOn(console, `error`).mockImplementation(() => {})
    onTestFinished(() => loggedError.mockRestore())
    const query = visible(createSource(recordApi))
    const seen = rowsAtFirstReady(query)
    await query.preload().catch(() => {})
    await vi.waitFor(() => expect(query.status).toBe(`error`))
    expect(seen.rows).toBeUndefined()
  })

  it(`a demand released during its list installs no rows`, async () => {
    const recordApi = new MockRecordApi<Data>()
    const list = createDeferred<ListResponse<Data>>()
    recordApi.list.mockReturnValue(list.promise)
    recordApi.subscribe.mockResolvedValue(new TransformStream<Event>().readable)
    const source = createSource(recordApi)
    const query = visible(source)
    void query.preload().catch(() => {})
    await vi.waitFor(() => expect(recordApi.list).toHaveBeenCalled())
    await query.cleanup()
    list.resolve(rows)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(source.size).toBe(0)
  })

  it(`a source with no syncMode is eager and gates readiness`, async () => {
    const recordApi = new MockRecordApi<Data>()
    const list = createDeferred<ListResponse<Data>>()
    recordApi.list.mockReturnValue(list.promise)
    recordApi.subscribe.mockResolvedValue(new TransformStream<Event>().readable)
    const source = createSource(recordApi, false)
    expect(source.config.syncMode).not.toBe(`on-demand`)
    const query = visible(source)
    const seen = rowsAtFirstReady(query)
    const preload = query.preload()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(query.isReady()).toBe(false)
    list.resolve(rows)
    await preload
    expect(seen.rows).toEqual([1, 2])
  })

  // A query no longer waits for the source's `markReady()`, which follows the
  // subscription, so the load itself must wait for the subscription.
  it(`an on-demand query is first ready only after its change subscription starts`, async () => {
    const recordApi = new MockRecordApi<Data>()
    const subscribe = createDeferred<ReadableStream<Event>>()
    recordApi.list.mockResolvedValue(rows)
    recordApi.subscribe.mockReturnValue(subscribe.promise)
    const query = visible(createSource(recordApi))
    // Set before resolving, so TrailBase's own continuation cannot run first.
    let subscribed = false
    let subscribedAtReady: boolean | undefined
    query.onFirstReady(() => {
      subscribedAtReady = subscribed
    })
    void query.preload()
    await new Promise((resolve) => setTimeout(resolve, 20))
    subscribed = true
    subscribe.resolve(new TransformStream<Event>().readable)
    await query.preload()
    expect(subscribedAtReady).toBe(true)
  })

  // A small service model: `list` answers from the current rows, and a change
  // reaches only a subscription that was established when it was committed.
  // Without the wait, the fetch would start first and this change would fall
  // between the fetch and the listener.
  it(`an on-demand query keeps a change committed before its subscription starts`, async () => {
    const recordApi = new MockRecordApi<Data>()
    const server = new Map(rows.records.map((row) => [row.id, row]))
    const listeners: Array<WritableStreamDefaultWriter<Event>> = []
    const subscribe = createDeferred<ReadableStream<Event>>()
    recordApi.list.mockImplementation(() =>
      Promise.resolve({ records: [...server.values()] }),
    )
    recordApi.subscribe.mockReturnValue(subscribe.promise)
    const establish = () => {
      const stream = new TransformStream<Event>()
      listeners.push(stream.writable.getWriter())
      subscribe.resolve(stream.readable)
    }
    const commitChange = (row: Data) => {
      server.set(row.id, row)
      for (const writer of listeners) void writer.write({ Update: row })
    }

    const query = visible(createSource(recordApi))
    void query.preload()
    await new Promise((resolve) => setTimeout(resolve, 0))
    commitChange({ id: 1, updated: 1, data: `hidden` })
    establish()
    await query.preload()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(query.toArray.map((row) => row.id)).toEqual([2])
  })
  // A load waiting for a subscription that never starts still honors its
  // caller: an abort rejects it, and cleanup ends it quietly.
  it.each([`aborted`, `cleaned up`] as const)(
    `a load waiting for a stalled subscription settles when %s`,
    async (outcome) => {
      const recordApi = new MockRecordApi<Data>()
      recordApi.list.mockResolvedValue(rows)
      recordApi.subscribe.mockReturnValue(new Promise(() => {}))
      const source = createSource(recordApi)
      const controller = new AbortController()
      const load = settlement(
        source._sync.loadSubset({ signal: controller.signal } as never),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(load.state).toBe(`pending`)

      if (outcome === `aborted`) controller.abort()
      else await source.cleanup()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(load.state).toBe(
        outcome === `aborted` ? `rejected:AbortError` : `fulfilled`,
      )
      expect(recordApi.list).not.toHaveBeenCalled()
    },
  )

  // If the listener cannot start after the subscription resolves, the source
  // has failed. A waiting load rejects with that failure instead of fetching
  // rows that no listener would keep current.
  it(`a waiting load rejects when the listener cannot start`, async () => {
    const recordApi = new MockRecordApi<Data>()
    recordApi.list.mockResolvedValue(rows)
    const subscribe = createDeferred<ReadableStream<Event>>()
    recordApi.subscribe.mockReturnValue(subscribe.promise)
    const source = createSource(recordApi)
    const load = settlement(source._sync.loadSubset({}))
    await new Promise((resolve) => setTimeout(resolve, 0))

    const locked = new TransformStream<Event>().readable
    locked.getReader()
    subscribe.resolve(locked)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(source.status).toBe(`error`)
    expect(load.state).toMatch(/^rejected/)
    expect(recordApi.list).not.toHaveBeenCalled()
  })
})

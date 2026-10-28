// Hand-written TrailBase lifecycle controls: a load failure rejects readiness
// while stream cancellation is still pending, so a late cancellation cannot
// turn the failed startup into readiness; and fixed reload, on-demand reload,
// and aborted-load scenarios compare with hand-written or service rows. The
// law that the generated and fixed lifecycle histories check is owned by
// lifecycle-oracle.property.test.ts.
import { expect, it, vi } from 'vitest'
import { createCollection, createLiveQueryCollection } from '@tanstack/db'
import { trailBaseCollectionOptions } from '../src/trailbase'
import { MockRecordApi } from './mock-record-api'
import {
  deferred,
  failure,
  invalidValue,
  observe,
  sortedRows,
  source,
  turn,
} from './lifecycle-support'
import type { Event } from 'trailbase'
import type { RaceRow, Row } from './lifecycle-support'

it.each([`resolve`, `reject`] as const)(
  `rejects startup before stream cancellation can %s`,
  async (cancellation) => {
    const reports: Array<Array<unknown>> = []
    const unhandled: Array<unknown> = []
    const failures: Array<unknown> = []
    const onUnhandled = (error: unknown) => unhandled.push(error)
    const reported = vi
      .spyOn(console, `error`)
      .mockImplementation((...args) => {
        reports.push(args)
      })
    process.on(`unhandledRejection`, onUnhandled)
    const active = source()
    const cancelled = deferred<void>()
    active.cancel.mockImplementation(() => cancelled.promise)
    const api = new MockRecordApi<Row>()
    api.subscribe.mockResolvedValue(active.stream)
    api.list.mockImplementation(() => active.list.promise)
    const collection = createCollection(
      trailBaseCollectionOptions({
        recordApi: api,
        getKey: (row: Row) => row.id,
        syncMode: `eager`,
        parse: {
          value: () => {
            throw failure
          },
        },
        serialize: {},
      }),
    )
    const preload = observe(collection.preload())
    try {
      await turn()
      expect(api.list).toHaveBeenCalledOnce()
      active.controller.enqueue({ Insert: { id: 1, value: invalidValue } })
      await turn()
      expect(active.cancel).toHaveBeenCalledOnce()
      // Cleanup I/O is still pending, but it cannot postpone the load error.
      expect(preload.result).toBe(`rejected`)
      expect(preload.error).toBe(failure)
      expect(collection.status).toBe(`error`)
      active.list.resolve({ records: [] })
      await turn()
      expect(preload.result).toBe(`rejected`)
      expect(collection.status).toBe(`error`)
    } catch (error) {
      failures.push(error)
    } finally {
      if (cancellation === `resolve`) cancelled.resolve()
      else cancelled.reject(new Error(`cancel failure`))
      active.list.resolve({ records: [] })
      try {
        await collection.cleanup()
      } catch (error) {
        failures.push(error)
      }
      await turn()
      try {
        // Observe the final cancellation/list continuations before restoring
        // either recorder. Loading failure is reported through preload, not
        // console.error, and canceled transport errors must stay observed.
        expect(reports).toEqual([])
        expect(unhandled).toEqual([])
        expect(preload.result).toBe(`rejected`)
        expect(preload.error).toBe(failure)
        expect(active.stream.locked).toBe(false)
        expect(active.cancel).toHaveBeenCalledOnce()
        expect(collection.status).toBe(`cleaned-up`)
      } catch (error) {
        failures.push(error)
      } finally {
        process.off(`unhandledRejection`, onUnhandled)
        reported.mockRestore()
      }
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1)
      throw new AggregateError(failures, `Startup and cleanup checks failed`, {
        cause: failures[0],
      })
  },
)

/**
 * ## Does a reload recover a failed startup?
 *
 * Law (the error surface's reload contract): `reload()` runs `sync` again
 * while the Collection still shows `error`. The new run's own outcome decides
 * the reload: a subscription that listens makes it ready and the reload
 * resolves; a subscription that rejects fails the reload, and the status stays
 * `error`. The adapter cannot read Collection status to learn whether this run
 * is ready, because status still shows the failed run.
 *
 * Grammar (exhaustive, 2 histories): the first subscription rejects; the
 * reload's subscription listens or rejects. Checkpoints: after the reload
 * settles (or a bounded wait), compare its outcome, status, and subscribe
 * calls.
 */
it.each([`listens`, `rejects`] as const)(
  `a reload after a failed startup settles when the new subscription %s`,
  async (outcome) => {
    const stream = new ReadableStream<Event>({ start() {} })
    const api = new MockRecordApi<RaceRow>()
    api.subscribe
      .mockImplementationOnce(() => Promise.reject(failure))
      .mockImplementationOnce(() =>
        outcome === `listens`
          ? Promise.resolve(stream)
          : Promise.reject(new Error(`reload subscription failed`)),
      )
    api.list.mockImplementation(() => Promise.resolve({ records: [] }))
    const reported = vi.spyOn(console, `error`).mockImplementation(() => {})
    const collection = createCollection(
      trailBaseCollectionOptions({
        recordApi: api,
        getKey: (row: RaceRow) => row.id,
        startSync: true,
        parse: {},
        serialize: {},
      }),
    )
    try {
      await collection.preload().catch(() => undefined)
      expect(collection.status).toBe(`error`)
      const settled = await Promise.race([
        collection.reload().then(
          () => `resolved`,
          () => `rejected`,
        ),
        new Promise((resolve) => setTimeout(() => resolve(`pending`), 500)),
      ])
      expect(settled).toBe(outcome === `listens` ? `resolved` : `rejected`)
      expect(collection.status).toBe(outcome === `listens` ? `ready` : `error`)
      expect(api.subscribe).toHaveBeenCalledTimes(2)
    } finally {
      await collection.cleanup()
      reported.mockRestore()
    }
  },
)

/**
 * ## Does a reload of a ready Collection end with the service's rows?
 *
 * Law (the reload contract, maintainer decision F19): a reload keeps the rows
 * on screen until it completes. The new run's writes apply on the kept rows,
 * and only a snapshot or the run's own truncate replaces them; a run that
 * sends neither completes the reload at its `markReady()`. Once the reload
 * settles, an eager Collection holds the service's current rows, so a row
 * the service deleted between the runs is gone.
 *
 * Reference: the service is a key/value relation that `list` reads at the
 * moment it is called, in key order, 256 rows to a page with a cursor. The
 * expected rows never come from the adapter.
 *
 * Grammar (exhaustive, 10 histories): the service holds 3 rows (one page)
 * or 258 rows (two pages); between the runs it changes nothing, updates row
 * 1, deletes row 2, or inserts a new row; or, while the reload's last page
 * is held, it inserts a new row that page does not list and the listener
 * delivers its `Insert` event (`insert-event`). Checkpoints: while the
 * reload's last page is held, every row the Collection showed before the
 * reload that the service still has is still shown, and the reload has not
 * settled; after the page is released, the reload resolves, the status is
 * `ready`, and the rows equal the service's.
 */
it.each(
  [3, 258].flatMap((size) =>
    ([`none`, `update`, `delete`, `insert`, `insert-event`] as const).map(
      (change) => ({
        size,
        change,
      }),
    ),
  ),
)(
  `a reload of a ready eager Collection over $size rows ends with the service's rows after a $change`,
  async ({ size, change }) => {
    const service = new Map<number, RaceRow>()
    for (let id = 1; id <= size; id++) service.set(id, { id, data: `v1` })
    const api = new MockRecordApi<RaceRow>()
    let listener: WritableStreamDefaultWriter<Event> | undefined
    api.subscribe.mockImplementation(() => {
      const stream = new TransformStream<Event>()
      listener = stream.writable.getWriter()
      return Promise.resolve(stream.readable)
    })
    let holdLastPage: Promise<void> | undefined
    api.list.mockImplementation(async (options) => {
      const after = Number(options?.pagination?.cursor ?? 0)
      const records = [...service.values()]
        .sort((a, b) => a.id - b.id)
        .filter((row) => row.id > after)
        .slice(0, 256)
      if (records.length < 256) await holdLastPage
      return { records, cursor: String(records.at(-1)?.id ?? after) }
    })
    const collection = createCollection(
      trailBaseCollectionOptions({
        recordApi: api,
        getKey: (row: RaceRow) => row.id,
        startSync: true,
        parse: {},
        serialize: {},
      }),
    )
    try {
      await collection.preload()
      const before = sortedRows(collection.toArray)
      expect(before).toEqual(sortedRows(service.values()))

      if (change === `update`) service.set(1, { id: 1, data: `v2` })
      else if (change === `delete`) service.delete(2)
      else if (change === `insert`)
        service.set(size + 1, { id: size + 1, data: `v1` })

      let releaseLastPage!: () => void
      holdLastPage = new Promise((resolve) => (releaseLastPage = resolve))
      const reload = observe(collection.reload())
      await turn()
      if (change === `insert-event`) {
        const row = { id: size + 1, data: `v1` }
        service.set(row.id, row)
        await listener!.write({ Insert: row })
        await turn()
      }
      const shown = new Set(collection.toArray.map((row) => row.id))
      expect(
        before.filter((row) => service.has(row.id) && !shown.has(row.id)),
        `kept rows the service still has stay while the reload runs`,
      ).toEqual([])
      expect(reload.result).toBe(`pending`)

      releaseLastPage()
      for (let i = 0; i < 5 && reload.result === `pending`; i++) await turn()
      expect(reload.result).toBe(`fulfilled`)
      expect(collection.status).toBe(`ready`)
      expect(sortedRows(collection.toArray)).toEqual(
        sortedRows(service.values()),
      )
    } finally {
      await collection.cleanup()
    }
  },
)

/**
 * ## Does an unchanged row survive an on-demand reload?
 *
 * Law (maintainer decisions F19 and snapshot-api §8): an on-demand reload
 * keeps the rows; core replays the live query's demand through the new
 * run, and the replayed pages apply on the kept rows (every page row is a
 * full-row `update`, so a held key is never inserted). Core does not sweep
 * after a reload (issue #2269), and a page cannot say a row is gone, so a
 * row the service deleted while no stream listened stays: that is this
 * adapter's limit for on-demand reloads.
 *
 * Reference: the same service as the eager reload lane. Between the runs
 * the service updates row 1 and deletes row 2 with no change event; row 3
 * is untouched. Checkpoint: once the reload settles and the replayed load
 * has applied, row 1 shows its edit, row 3 survives, and row 2 keeps its
 * last value.
 */
it(`an unchanged row survives an on-demand reload`, async () => {
  const service = new Map<number, RaceRow>(
    [1, 2, 3].map((id) => [id, { id, data: `v1` }]),
  )
  const api = new MockRecordApi<RaceRow>()
  api.subscribe.mockImplementation(() =>
    Promise.resolve(new ReadableStream<Event>({ start() {} })),
  )
  api.list.mockImplementation((options) => {
    const after = Number(options?.pagination?.cursor ?? 0)
    const records = [...service.values()]
      .sort((a, b) => a.id - b.id)
      .filter((row) => row.id > after)
      .slice(0, 256)
    return Promise.resolve({
      records,
      cursor: String(records.at(-1)?.id ?? after),
    })
  })
  const collection = createCollection(
    trailBaseCollectionOptions({
      recordApi: api,
      getKey: (row: RaceRow) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      parse: {},
      serialize: {},
    }),
  )
  const live = createLiveQueryCollection({
    query: (q) => q.from({ row: collection }),
  })
  try {
    await live.preload()
    expect(sortedRows(collection.toArray)).toEqual(sortedRows(service.values()))

    service.set(1, { id: 1, data: `v2` })
    service.delete(2)
    await collection.reload()
    await vi.waitFor(() =>
      expect(sortedRows(collection.toArray)).toEqual(
        sortedRows([...service.values(), { id: 2, data: `v1` }]),
      ),
    )
    expect(collection.status).toBe(`ready`)
  } finally {
    await live.cleanup()
    await collection.cleanup()
  }
})

/**
 * ## Does an aborted load write no rows?
 *
 * Law (snapshot-api §8): an abort ends the load. Core stops listening to it
 * at once, and the adapter must honor the signal: stop the fetch and write
 * no rows for it. Reference: the service holds 3 rows; a subset load's list
 * is held, the caller aborts, then the list answers. Checkpoints: the load
 * rejects with `AbortError`, and after the late answer the Collection holds
 * no row, while a later load lists every row.
 */
it(`an aborted load writes no rows and its late result changes nothing`, async () => {
  const service = [1, 2, 3].map((id) => ({ id, data: `v1` }))
  const page = deferred<ListResponse<RaceRow>>()
  const api = new MockRecordApi<RaceRow>()
  api.subscribe.mockImplementation(() =>
    Promise.resolve(new ReadableStream<Event>({ start() {} })),
  )
  api.list
    .mockImplementationOnce(() => page.promise)
    .mockImplementation(() => Promise.resolve({ records: service }))
  const collection = createCollection(
    trailBaseCollectionOptions({
      recordApi: api,
      getKey: (row: RaceRow) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      parse: {},
      serialize: {},
    }),
  )
  try {
    await collection.preload()
    const abort = new AbortController()
    const load = observe(
      Promise.resolve(
        collection._sync.loadSubset({ limit: 10, signal: abort.signal }),
      ),
    )
    await vi.waitFor(() => expect(api.list).toHaveBeenCalledOnce())
    abort.abort()
    page.resolve({ records: service })
    await turn()
    expect(load.result).toBe(`rejected`)
    expect(load.error).toMatchObject({ name: `AbortError` })
    expect(collection.toArray).toEqual([])

    await collection._sync.loadSubset({ limit: 10 })
    expect(sortedRows(collection.toArray)).toEqual(sortedRows(service))
  } finally {
    await collection.cleanup()
  }
})

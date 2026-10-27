// Hand-written TrailBase startup control: a load failure rejects readiness
// while stream cancellation is still pending, so a late cancellation cannot
// turn the failed startup into readiness. The law that the generated and
// fixed lifecycle histories check is owned by lifecycle-oracle.property.test.ts.
import { expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { trailBaseCollectionOptions } from '../src/trailbase'
import { MockRecordApi } from './mock-record-api'
import {
  deferred,
  failure,
  invalidValue,
  observe,
  source,
  turn,
} from './lifecycle-support'
import type { Row } from './lifecycle-support'

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

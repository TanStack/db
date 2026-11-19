/**
 * The installed TrailBase SDK supplies filtered/ordered list responses over
 * its real JSON and SSE boundary. Holding or failing a list leaves the change
 * listener established, so the receiving history controls acquisition rather
 * than mistaking source-startup failure for a covered-demand fallback.
 *
 * Only authored rows returned by the SDK's actual list requests enter the
 * independent persistence model. Synthetic adapter transactions never enter
 * that source log. The list-decoding barrier is separate from public query
 * readiness and the shared recorder's applied-receipt observations.
 */
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { trailBaseCollectionOptions } from '../src/trailbase'
import { TrailBaseSdkService, sdkTurn } from './sdk-service'
import type {
  DemandReceivingFactory,
  DemandRow,
} from '../../db-adapter-conformance/tests/persisted-demand-receiving-types'
import type { SdkList } from './sdk-service'

export const trailBasePersistedDemandSource: DemandReceivingFactory = (
  input,
) => {
  const service = new TrailBaseSdkService<DemandRow>()
  service.holdLists = true
  const failure = new Error(`TrailBase demand source unavailable: ${input.id}`)
  let mode: `held` | `answer` | `reject` = `held`
  const pending = new Set<SdkList<DemandRow>>()
  const consuming: Array<Promise<unknown>> = []
  const list = service.api.list.bind(service.api)
  service.api.list = (...args) => {
    const result = list(...args)
    consuming.push(result)
    void result.catch(() => undefined)
    return result
  }
  const deliver = (request: SdkList<DemandRow>) => {
    pending.delete(request)
    if (mode === `reject`) request.reject(failure)
    else {
      const rows = service.select(request.url)
      input.events.push({
        type: `rows`,
        rows: rows.map((row) => [row.id, { ...row }]),
      })
      request.resolve(rows)
    }
  }
  service.onList = (request) => {
    if (mode === `held`) pending.add(request)
    else deliver(request)
  }

  const options = trailBaseCollectionOptions({
    id: input.id,
    recordApi: service.api,
    getKey: (row: DemandRow) => row.id,
    parse: {},
    serialize: {},
    syncMode: `on-demand`,
  })
  const persisted = persistedCollectionOptions({
    ...options,
    sync: input.wrapSync(options.sync),
    persistence: input.persistence,
    initialRender: {
      strategy: `network-first`,
      networkTimeoutMs: input.waitMs,
    },
  })
  const collection = createCollection({
    ...persisted,
    sync: input.wrapPersistedSync(persisted.sync),
  })
  const barrier = async () => {
    if (mode === `held`) {
      await sdkTurn()
      return
    }
    let consumed = 0
    for (;;) {
      await sdkTurn()
      const current = consuming.slice(consumed)
      consumed += current.length
      await Promise.allSettled(current)
      await sdkTurn()
      if (consumed === consuming.length) return
    }
  }
  return Promise.resolve({
    collection,
    answer: async (rows: ReadonlyArray<DemandRow>) => {
      service.rows = rows.map((row) => ({ ...row }))
      mode = `answer`
      for (const request of [...pending]) deliver(request)
      await barrier()
    },
    reject: async () => {
      mode = `reject`
      for (const request of [...pending]) deliver(request)
      await barrier()
    },
    requests: () => service.lists.length,
    barrier,
    dispose: async () => {
      mode = `reject`
      for (const request of [...pending]) deliver(request)
      await barrier()
      service.api.list = list
      service.dispose()
    },
  })
}

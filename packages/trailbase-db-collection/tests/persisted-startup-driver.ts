/**
 * TrailBase's eager list supplies every row; the shared startup oracle judges
 * its replacement of persisted rows. The controlled RecordApi holds the list
 * response and uses a native stream, as the lifecycle oracle does. No change
 * events occur during this initial replacement; their page fence has its own
 * oracle. Refresh is the public reload, which lists the same source again.
 */
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import {
  sortedStartupRows,
  startupRows,
} from '../../db-adapter-conformance/src/persisted-startup-oracle'
import { untilStartup } from '../../db-adapter-conformance/tests/persisted-startup-driver'
import { trailBaseCollectionOptions } from '../src/trailbase'
import type { Event, ListResponse, RecordApi } from 'trailbase'
import type {
  PersistedStartupHistory,
  StartupRow,
} from '../../db-adapter-conformance/src/persisted-startup-oracle'
import type { PersistedStartupAdapter } from '../../db-adapter-conformance/tests/persisted-startup-driver'

export const trailBaseStartupAdapter: PersistedStartupAdapter<PersistedStartupHistory> =
  {
    scope: `collection`,
    create(persistence, history, id) {
      let pending: ((result: ListResponse<StartupRow>) => void) | undefined
      let available = false
      const api = {
        subscribe: () => Promise.resolve(new ReadableStream<Event>()),
        list: () =>
          new Promise<ListResponse<StartupRow>>((resolve) => {
            pending = resolve
          }),
      } as unknown as RecordApi<StartupRow>
      const collection = createCollection(
        persistedCollectionOptions({
          ...trailBaseCollectionOptions<StartupRow, StartupRow, string>({
            id,
            recordApi: api,
            getKey: (row) => row.id,
            syncMode: `eager`,
            parse: {},
            serialize: {},
          }),
          persistence,
        }),
      )
      const deliver = async () => {
        await untilStartup(() => pending !== undefined)
        const respond = pending!
        pending = undefined
        respond({ records: startupRows(history.next, 2) })
        available = true
      }
      return {
        collection,
        snapshot: () => ({ rows: sortedStartupRows(collection.values()) }),
        deliver,
        responseAvailable: () => available,
        refresh: async () => {
          const reloaded = collection.reload()
          await deliver()
          await reloaded
        },
        dispose: async () => {
          pending?.({ records: [] })
          await collection.cleanup()
        },
      }
    },
  }

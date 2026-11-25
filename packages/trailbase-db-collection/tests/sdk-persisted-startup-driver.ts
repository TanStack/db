/**
 * The existing persisted startup law receives installed SDK JSON/SSE through
 * the public persistence wrapper. Storage hosts remain the shared controlled
 * persistence and actual Node SQLite; this receiver supplies no expected rows.
 */
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import {
  sortedStartupRows,
  startupRows,
} from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import {
  startupInitialRender,
  trackStartupSync,
} from '../../db-adapter-conformance/tests/persisted-startup-driver'
import { trailBaseCollectionOptions } from '../src/trailbase'
import { TrailBaseSdkService, untilSdk } from './sdk-service'
import type { PersistedStartupAdapter } from '../../db-adapter-conformance/tests/persisted-startup-driver'
import type {
  PersistedStartupHistory,
  StartupRow,
} from '../../db-adapter-conformance/tests/persisted-startup-oracle'

export const trailBaseSdkStartupAdapter: PersistedStartupAdapter<PersistedStartupHistory> =
  {
    scope: `collection`,
    create(persistence, history, id) {
      const service = new TrailBaseSdkService<StartupRow>()
      service.holdLists = true
      let answered = 0
      let available = false
      const options = trailBaseCollectionOptions({
        id,
        recordApi: service.api,
        getKey: (row: StartupRow) => row.id,
        parse: {},
        serialize: {},
      })
      const startup = trackStartupSync(options.sync)
      const collection = createCollection(
        persistedCollectionOptions({
          ...options,
          sync: startup.sync,
          ...startupInitialRender(history),
          persistence,
        }),
      )
      const deliver = async () => {
        await untilSdk(
          () => service.lists.length > answered,
          `persisted eager list requested`,
        )
        service.lists[answered++]!.resolve(startupRows(history.next, 2))
        available = true
      }
      return {
        collection,
        initialResult: startup.initialResult,
        firstSubmission: startup.firstSubmission,
        waitForRestore: startup.waitForRestore,
        snapshot: () => ({ rows: sortedStartupRows(collection.values()) }),
        deliver,
        responseAvailable: () => available,
        refresh: async () => {
          const pending = collection.reload()
          await deliver()
          await pending
        },
        dispose: async () => {
          for (const list of service.lists.slice(answered)) list.resolve([])
          await collection.cleanup()
          service.dispose()
        },
      }
    },
  }

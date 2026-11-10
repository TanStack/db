/** Complete-snapshot push receiving path for shared persistence conformance.
 * The real Convex adapter/client decode QueryUpdated messages over the shared
 * controlled socket. `select` maps the wire's numeric ID to the common row.
 * A single complete source owns the Collection, so independent peers do not
 * exist here. Both delivery/restore orders use the same shared comparison.
 */
import { createCollection } from '@tanstack/db'
import {
  startupInitialRender,
  trackStartupSync,
} from '../../db-adapter-conformance/tests/persisted-startup-driver'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { convexCollectionOptions } from '../src'
import {
  sortedStartupRows,
  startupRows,
} from '../../db-adapter-conformance/src/persisted-startup-oracle'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { ConvexProvider, rowsQuery } from './conformance-driver'
import type { PersistedStartupHistory } from '../../db-adapter-conformance/src/persisted-startup-oracle'
import type { PersistedStartupAdapter } from '../../db-adapter-conformance/tests/persisted-startup-driver'

export const convexStartupAdapter: PersistedStartupAdapter<PersistedStartupHistory> =
  {
    scope: `collection`,
    create(persistence, h, id) {
      const provider = new ConvexProvider(`javascript`)
      const options = convexCollectionOptions({
        id,
        client: provider.client,
        query: rowsQuery,
        queryArgs: {},
        select: (result) =>
          result.map((row) => ({
            id: String.fromCharCode(97 + row.id),
            value: row.value as number,
          })),
        getKey: (row) => row.id,
      })
      const startup = trackStartupSync(options.sync)
      const collection = createCollection(
        persistedCollectionOptions({
          ...options,
          sync: startup.sync,
          ...startupInitialRender(h),
          persistence,
        }),
      )
      let available = false
      const deliver = async () => {
        await provider.settle()
        provider.deliverSnapshot(
          startupRows(h.next, 2).map((row) => ({
            id: row.id.charCodeAt(0) - 97,
            title: row.id,
            value: row.value,
          })),
        )
        await provider.settle()
        available = true
      }
      return {
        collection,
        initialResult: startup.initialResult,
        snapshot: () => ({ rows: sortedStartupRows(collection.values()) }),
        deliver,
        responseAvailable: () => available,
        refresh: async () => {
          await deliver()
          await collection.utils.awaitSync()
        },
        dispose: () =>
          withOracleCleanup(async () => {}, [
            () => collection.cleanup(),
            provider.dispose,
          ]),
      }
    },
  }

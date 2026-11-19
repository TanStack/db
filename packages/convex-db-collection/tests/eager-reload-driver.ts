/**
 * Complete query results receive the shared reload judgment. The actual SDK
 * decodes every controlled Transition. A source result is staged while the
 * shared driver holds adapter entry; after entry it reaches the current query
 * listener. Neither retained Collection rows nor a persistence wrapper supply
 * the replacement. JavaScript, React and app-wrapper clients use one path.
 */
import { ConvexClient } from 'convex/browser'
import { convexCollectionOptions } from '../src'
import { ConvexProvider, rowsQuery } from './conformance-driver'
import type { EagerReloadAdapter } from '../../db-adapter-conformance/tests/eager-reload-driver'
import type { StartupRow } from '../../db-adapter-conformance/tests/persisted-startup-oracle'

export function convexEagerReloadAdapter(
  kind: `javascript` | `react` | `wrapped`,
): EagerReloadAdapter {
  return {
    async open(initial, id) {
      const provider = new ConvexProvider(kind)
      await provider.settle()
      let staged = structuredClone(initial)
      const pending = new Set<Promise<void>>()
      const options = convexCollectionOptions({
        id,
        client:
          kind === `wrapped` && provider.client instanceof ConvexClient
            ? { onUpdate: provider.client.onUpdate.bind(provider.client) }
            : provider.client,
        query: rowsQuery,
        queryArgs: {},
        select: (rows) =>
          rows.map((row) => ({
            id: String.fromCharCode(97 + row.id),
            value: row.value as number,
          })),
        getKey: (row) => row.id,
      })
      const source = options.sync.sync
      options.sync.sync = (params) => {
        const cleanup = source(params)
        const delivery = provider.settle().then(() => {
          provider.deliverSnapshot(
            staged.map((row) => ({
              id: row.id.charCodeAt(0) - 97,
              title: `a` as const,
              value: row.value,
            })),
          )
        })
        pending.add(delivery)
        void delivery.then(() => pending.delete(delivery))
        return cleanup
      }
      return {
        options,
        replace: async (rows: Array<StartupRow>) => {
          staged = structuredClone(rows)
          // Removal acknowledgments drop the previous SDK cache before the
          // gated new sync run subscribes. This is the missed-change premise.
          await provider.settle()
        },
        propagate: async () => {
          // deliverSnapshot returns after the real SDK's synchronous socket
          // Transition handler has consumed the complete result, even [].
          // Then drain its finite scheduled callbacks, without reading the
          // tested Collection or waiting for its readiness/applied receipts.
          await Promise.all(pending)
          await provider.settle()
        },
        dispose: async () => {
          await Promise.all(pending)
          await provider.dispose()
        },
      }
    },
  }
}

/** Real SDK reload receiver; provider rows change while source entry is held. */
import { realtimeCollectionOptions } from './vendor/collection-options'
import { NeonSDKProvider, neonSDKQuery } from './neon-sdk-driver'
import type { EagerReloadAdapter } from '../eager-reload-driver'
import type { StartupRow } from '../persisted-startup-oracle'

export const neonReloadAdapter: EagerReloadAdapter = {
  open(initial, id) {
    const provider = new NeonSDKProvider([
      { name: `id`, type_oid: 25, typmod: -1, codec: `pg_text` },
      { name: `value`, type_oid: 23, typmod: -1, codec: `pg_text` },
    ])
    let rows = initial
    const deliveries: Array<Promise<void>> = []
    const options = realtimeCollectionOptions({
      id,
      client: provider.client,
      query: neonSDKQuery<StartupRow>(),
      getKey: (row: StartupRow) => row.id,
    })
    const sync = options.sync.sync
    options.sync.sync = (params) => {
      const cleanup = sync(params)
      const delivery = provider.deliverWireRows(
        rows.map((row, index) => ({
          row_key: (index + 1).toString(16).padStart(64, `0`),
          values: [row.id, String(row.value)],
        })),
      )
      // Keep detached failures observed and surface them at fixture disposal.
      void delivery.catch(() => {})
      deliveries.push(delivery)
      return cleanup
    }
    return Promise.resolve({
      options,
      replace(next) {
        rows = next
        return Promise.resolve()
      },
      async propagate() {
        // Each delivery waits for the SDK's subscription admission, then the
        // real socket processes baseline_end synchronously, including an empty
        // baseline. This cut does not depend on Collection commits/readiness.
        await Promise.all(deliveries)
      },
      async dispose() {
        try {
          await Promise.all(deliveries)
        } finally {
          provider.dispose()
        }
      },
    })
  },
}

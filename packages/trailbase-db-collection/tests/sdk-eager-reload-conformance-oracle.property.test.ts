/**
 * TrailBase receives the shared complete-result judgment through real SDK list
 * decoding. The hostile receiver drops actual omission deletes at the source
 * sync boundary; it changes no provider rows or expected result.
 */
import { observeEagerReload } from '../../db-adapter-conformance/tests/eager-reload-driver'
import { registerEagerReloadConformance } from '../../db-adapter-conformance/tests/eager-reload-oracle-suite'
import { trailBaseSdkReloadAdapter } from './sdk-eager-reload-driver'

registerEagerReloadConformance(
  `adapter.trailbase.eager-reload.sdk`,
  trailBaseSdkReloadAdapter,
  {
    owns: [`src/trailbase.ts#trailBaseCollectionOptions`],
    replacement: `sweep`,
    receive: (history, id, omitSweep) =>
      observeEagerReload(
        {
          open: async (initial, collectionId) => {
            const receiver = await trailBaseSdkReloadAdapter.open(
              initial,
              collectionId,
            )
            if (!omitSweep) return receiver
            const upstream = receiver.options.sync
            return {
              ...receiver,
              options: {
                ...receiver.options,
                sync: {
                  ...upstream,
                  sync: (params) =>
                    upstream.sync({
                      ...params,
                      write: (message) => {
                        if (message.type !== `delete`) params.write(message)
                      },
                    }),
                },
              },
            }
          },
        },
        history,
        id,
      ),
  },
)

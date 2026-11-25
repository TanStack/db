/**
 * Fresh QueryFailed transitions receive the shared eager initial-gate judgment
 * on preload and reload. Convex's cached-error admission decision deliberately
 * requires a new server result, so this grammar excludes a cached-only join:
 * that is a different premise, covered by the eager source cached-error owner.
 * Both direct SDKs and an application's onUpdate-only wrapper receive identical
 * model/checker results. No provider-wide terminal stream policy is inferred.
 */
import { ConvexClient } from 'convex/browser'
import { convexCollectionOptions } from '../src'
import { registerEagerGateFailureConformance } from '../../db-adapter-conformance/tests/eager-reload-oracle-suite'
import { ConvexProvider, rowsQuery } from './conformance-driver'
import type { EagerGateAdapter } from '../../db-adapter-conformance/tests/eager-reload-driver'
import type { StartupRow } from '../../db-adapter-conformance/tests/persisted-startup-oracle'

for (const kind of [`javascript`, `react`, `wrapped`] as const) {
  const adapter: EagerGateAdapter = {
    sources: [kind],
    async open() {
      const provider = new ConvexProvider(kind)
      await provider.settle()
      let failures = 0
      let recovery: Array<StartupRow> | undefined
      const deliver = async (rows: Array<StartupRow>) => {
        await provider.settle()
        provider.deliverSnapshot(
          rows.map((row) => ({
            id: row.id.charCodeAt(0) - 97,
            title: `a` as const,
            value: row.value,
          })),
        )
        await provider.settle()
      }
      return {
        options: (id) => {
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
            onError: () => failures++,
          })
          const source = options.sync.sync
          let run = 0
          options.sync.sync = (params) => {
            if (++run === 1) return source(params)
            // Reload may accept an SDK-cached valid result at once. This
            // receiver instead controls a legal gap after old-run retirement:
            // its real QueryRemoved acknowledgment clears that cache before
            // new adapter entry, so QueryFailed is the first fresh result.
            let active = true
            let actual: ReturnType<typeof source>
            const entry = new Promise<void>((resolve) =>
              setTimeout(resolve, 0),
            ).then(() => {
              if (active) actual = source(params)
            })
            return async () => {
              active = false
              await entry
              if (typeof actual === `function`) await actual()
              else await actual?.cleanup?.()
            }
          }
          return options
        },
        hold: () => {},
        deliver,
        reject: async (message) => {
          await provider.settle()
          provider.fail(new Error(message))
          await provider.settle()
        },
        propagate: async () => {
          await provider.settle()
          if (recovery) {
            const rows = recovery
            recovery = undefined
            await deliver(rows)
          }
        },
        terminalEntries: () => failures,
        prepareRecovery: (rows) => {
          recovery = rows
          return Promise.resolve()
        },
        matchesFailure: (error, message) =>
          error instanceof Error && error.message.includes(message),
        dispose: provider.dispose,
      }
    },
  }
  registerEagerGateFailureConformance(
    `adapter.convex.eager-gate.${kind}`,
    adapter,
    {
      entries: [`fresh`, `reload`],
      owns: [
        `src/options.ts#createConvexOptions`,
        `src/subscription.ts#subscribeQuery`,
      ],
    },
  )
}

/**
 * Convex's query is complete within its authored arguments. Its fresh and
 * reloaded results therefore receive the shared complete-result judgment,
 * including empty replacement and an optimistic mutation held at acceptance.
 * No complete-table union or stream ownership rule is inferred. The shared
 * registration owns the model, grammar, reach and corrupted-observation checks.
 */
import { registerEagerReloadConformance } from '../../db-adapter-conformance/tests/eager-reload-oracle-suite'
import { convexEagerReloadAdapter } from './eager-reload-driver'

for (const client of [`javascript`, `react`, `wrapped`] as const) {
  registerEagerReloadConformance(
    `adapter.convex.eager-reload.${client}`,
    convexEagerReloadAdapter(client),
    {
      owns: [
        `src/options.ts#createConvexOptions`,
        `src/subscription.ts#subscribeQuery`,
      ],
      replacement: `truncate`,
    },
  )
}

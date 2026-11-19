/**
 * Neon receives the shared complete eager-reload law through its installed
 * SDK. No persistence wrapper can supply a missing replacement declaration.
 * The shared model, grammar, fulfillment cut and checker supply all judgments.
 */
import { registerEagerReloadConformance } from './eager-reload-oracle-suite'
import { neonReloadAdapter } from './neon/neon-reload-driver'

registerEagerReloadConformance(
  `adapter.neon.eager-reload.sdk`,
  neonReloadAdapter,
  {
    owns: [`tests/neon/vendor/collection-options.ts`],
    replacement: `truncate`,
  },
)

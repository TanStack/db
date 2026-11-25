/** One actual SDK client receives the exact-query shared lifetime judgment. */
import { registerNeonSharedClient } from './neon/neon-shared-client-oracle-suite'
import { observeNeonSharedClient } from './neon/neon-shared-client-driver'

registerNeonSharedClient(
  `adapter.neon.shared-client.sdk`,
  observeNeonSharedClient,
  { owns: [`tests/neon/vendor/collection-options.ts`] },
)

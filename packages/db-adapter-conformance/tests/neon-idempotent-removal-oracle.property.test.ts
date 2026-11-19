/** Both native hosts share the installed-SDK removal model and judgment. */
import { registerNeonIdempotentRemoval } from './neon/neon-idempotent-removal-oracle'
import { observeNeonIdempotentRemoval } from './neon/neon-idempotent-removal-driver'

registerNeonIdempotentRemoval(
  `adapter.neon.idempotent-removal.sdk`,
  observeNeonIdempotentRemoval,
)

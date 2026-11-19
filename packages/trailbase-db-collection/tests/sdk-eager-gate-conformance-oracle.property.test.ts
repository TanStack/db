/** Installed SDK list/subscription failures receive the shared initial gate law. */
import { registerEagerGateFailureConformance } from '../../db-adapter-conformance/tests/eager-reload-oracle-suite'
import { trailBaseSdkGateAdapter } from './sdk-eager-reload-driver'

registerEagerGateFailureConformance(
  `adapter.trailbase.eager-gate.sdk`,
  trailBaseSdkGateAdapter,
  {
    owns: [`src/trailbase.ts#trailBaseCollectionOptions`],
  },
)

/** Installed Electric SDK receives the existing complete-result judgment. */
import { registerEagerReloadConformance } from '../../db-adapter-conformance/tests/eager-reload-oracle-suite'
import { crossElectricReloadAdapter } from './cross-adapter-reload-driver'

registerEagerReloadConformance(
  `adapter.electric.eager-reload`,
  crossElectricReloadAdapter,
  {
    owns: [`src/electric.ts#electricCollectionOptions`],
    replacement: `truncate`,
  },
)

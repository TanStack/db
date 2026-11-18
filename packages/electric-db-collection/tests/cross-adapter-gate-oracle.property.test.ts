/**
 * Electric receives fresh and reload terminal-gate judgment through the real
 * ShapeStream. A peer's failed cached subscription does not transfer: Electric
 * Collections open independent shapes. The common model/check remain intact.
 */
import { registerEagerGateFailureConformance } from '../../db-adapter-conformance/tests/eager-reload-oracle-suite'
import { crossElectricGateAdapter } from './cross-adapter-gate-driver'

registerEagerGateFailureConformance(
  `adapter.electric.eager-gate-failure`,
  crossElectricGateAdapter,
  {
    owns: [`src/electric.ts#electricCollectionOptions`],
    entries: [`fresh`, `reload`],
  },
)

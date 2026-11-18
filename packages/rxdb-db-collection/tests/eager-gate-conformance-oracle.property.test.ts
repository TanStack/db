/** Real RxDB query and change stream boundaries receive the shared gate law. */
import { registerEagerGateFailureConformance } from '../../db-adapter-conformance/tests/eager-reload-oracle-suite'
import { rxdbEagerGateAdapter } from './eager-gate-driver'

registerEagerGateFailureConformance(
  `adapter.rxdb.eager-gate`,
  rxdbEagerGateAdapter,
  {
    entries: [`fresh`, `reload`],
    owns: [`src/rxdb.ts#rxdbCollectionOptions`],
  },
)

/** RxDB receives complete eager reload replacement through its real local SDK. */
import { declareOracle } from '../../db/tests/oracle-declaration'
import { eagerReloadHistoryArb } from '../../db-adapter-conformance/tests/eager-reload-oracle'
import { registerEagerReloadConformance } from '../../db-adapter-conformance/tests/eager-reload-oracle-suite'
import { rxdbEagerReloadAdapter } from './eager-reload-driver'

declareOracle({
  owns: [`src/rxdb.ts#rxdbCollectionOptions`],
  grammar: [eagerReloadHistoryArb],
})
registerEagerReloadConformance(
  `adapter.rxdb.eager-reload`,
  rxdbEagerReloadAdapter,
)

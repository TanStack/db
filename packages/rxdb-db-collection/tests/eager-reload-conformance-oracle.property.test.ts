/** RxDB receives complete eager reload replacement through its real local SDK. */
import { registerEagerReloadConformance } from '../../db-adapter-conformance/tests/eager-reload-oracle-suite'
import { rxdbEagerReloadAdapter } from './eager-reload-driver'

registerEagerReloadConformance(
  `adapter.rxdb.eager-reload`,
  rxdbEagerReloadAdapter,
  {
    owns: [`src/rxdb.ts#rxdbCollectionOptions`],
  },
)

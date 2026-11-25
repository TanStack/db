/**
 * Fresh and reloaded complete LocalStorage snapshots receive the shared eager
 * reload judgment. The shared owner supplies all expected rows, generated
 * histories, reach obligations and hostile replacement controls. This Node
 * receiver exercises the documented custom Storage API; native Storage has a
 * separate receiving registration using the same owner and driver.
 */
import { registerEagerReloadConformance } from '../../db-adapter-conformance/tests/eager-reload-oracle-suite'
import { localStorageEagerReloadAdapter } from './local-storage-eager-reload-driver'

registerEagerReloadConformance(
  `adapter.local-storage.eager-reload.node`,
  localStorageEagerReloadAdapter(),
  { owns: [`src/local-storage.ts#localStorageCollectionOptions`] },
)

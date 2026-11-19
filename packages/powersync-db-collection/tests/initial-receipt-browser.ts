/** Browser SDK source and real persisted storage share the Node receipt law. */
import { powerSyncBrowserEagerReloadAdapter } from './eager-reload-browser'
import { observePowerSyncInitialReceipt } from './initial-receipt-common'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'
import type { HeldCall } from '../../db-sqlite-persistence-core/tests/reload-class-oracle'
import type { InitialReceiptHistory } from '../../powersync-direct-collection/tests/initial-receipt-oracle'

export function observeBrowserPowerSyncInitialReceipt(
  history: InitialReceiptHistory,
  persistence: PersistedCollectionPersistence,
  holdBaseline: (id: string) => HeldCall,
  id: string,
  detachedErrors: Array<string>,
) {
  return observePowerSyncInitialReceipt(
    powerSyncBrowserEagerReloadAdapter,
    history,
    persistence,
    holdBaseline,
    id,
    detachedErrors,
  )
}

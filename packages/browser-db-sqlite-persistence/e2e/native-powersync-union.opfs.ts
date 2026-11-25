/** The installed browser PowerSync SDK supplies actual source SQLite. */
import { observeDemandUnion } from '../../powersync-db-collection/tests/demand-union-driver'
import { openBrowserReceivingDatabase } from '../../powersync-db-collection/tests/native-receiving-browser'
import type { UnionHistory } from '../../powersync-db-collection/tests/demand-union-oracle'

const runNativePowerSyncUnion = (history: UnionHistory, id: string) =>
  observeDemandUnion(openBrowserReceivingDatabase, history, id)
declare global {
  interface Window {
    runNativePowerSyncUnion: typeof runNativePowerSyncUnion
  }
}
window.runNativePowerSyncUnion = runNativePowerSyncUnion

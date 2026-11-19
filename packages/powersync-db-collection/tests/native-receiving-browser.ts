/** The installed browser SDK supplies source SQLite for native receiving laws. */
import { PowerSyncDatabase } from '@powersync/web'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import type { Schema } from '@powersync/common'

let sequence = 0
export function openBrowserReceivingDatabase(schema: Schema) {
  const database = new PowerSyncDatabase({
    schema,
    database: { dbFilename: `native-powersync-receiving-${sequence++}.sqlite` },
  })
  return Promise.resolve({
    database,
    dispose: () =>
      withOracleCleanup(
        () => database.disconnectAndClear(),
        [() => database.close()],
      ),
  })
}

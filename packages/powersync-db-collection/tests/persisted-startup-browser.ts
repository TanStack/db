// Browser PowerSync SDK receiving path. Its SQLite database is separate from
// the wrapper's worker/OPFS database; both execute their real storage engines.
import { PowerSyncDatabase } from '@powersync/web'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { powerSyncStartupAdapterFor } from './persisted-startup-common'

let sequence = 0
export const powerSyncBrowserStartupAdapter = powerSyncStartupAdapterFor(
  async (schema) => {
    const database = new PowerSyncDatabase({
      schema,
      database: { dbFilename: `powersync-startup-${sequence++}.sqlite` },
    })
    return {
      database,
      dispose: () =>
        withOracleCleanup(
          () => database.disconnectAndClear(),
          [() => database.close()],
        ),
    }
  },
)

import { PowerSyncDatabase } from '@powersync/web'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { powerSyncEagerReloadAdapterFor } from './eager-reload-common'

let sequence = 0
export const powerSyncBrowserEagerReloadAdapter =
  powerSyncEagerReloadAdapterFor((schema) => {
    const database = new PowerSyncDatabase({
      schema,
      database: { dbFilename: `powersync-eager-reload-${sequence++}.sqlite` },
    })
    return Promise.resolve({
      database,
      dispose: () =>
        withOracleCleanup(
          () => database.disconnectAndClear(),
          [() => database.close()],
        ),
    })
  })

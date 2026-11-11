import { PowerSyncDatabase } from '@powersync/web'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { powerSyncBaselineLifecycleAdapterFor } from './persisted-baseline-lifecycle-common'

export const powerSyncBrowserBaselineLifecycleAdapter =
  powerSyncBaselineLifecycleAdapterFor((schema) => {
    const database = new PowerSyncDatabase({
      schema,
      database: { dbFilename: `powersync-baseline-lifecycle.sqlite` },
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

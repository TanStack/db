import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PowerSyncDatabase } from '@powersync/node'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { powerSyncBaselineLifecycleAdapterFor } from './persisted-baseline-lifecycle-common'
import { TEST_DATABASE_IMPLEMENTATION } from './test-db-implementation'

export const powerSyncBaselineLifecycleAdapter =
  powerSyncBaselineLifecycleAdapterFor(async (schema) => {
    if (!TEST_DATABASE_IMPLEMENTATION)
      throw new Error(`No PowerSync SQLite implementation`)
    const directory = await mkdtemp(
      join(tmpdir(), `powersync-baseline-lifecycle-`),
    )
    const database = new PowerSyncDatabase({
      schema,
      database: {
        dbFilename: `source.sqlite`,
        dbLocation: directory,
        implementation: TEST_DATABASE_IMPLEMENTATION,
      },
    })
    return {
      database,
      dispose: () =>
        withOracleCleanup(
          () => database.disconnectAndClear(),
          [
            () => database.close(),
            () => rm(directory, { recursive: true, force: true }),
          ],
        ),
    }
  })

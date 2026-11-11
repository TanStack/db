import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PowerSyncDatabase } from '@powersync/node'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { powerSyncEagerReloadAdapterFor } from './eager-reload-common'
import { TEST_DATABASE_IMPLEMENTATION } from './test-db-implementation'

export const powerSyncEagerReloadAdapter = powerSyncEagerReloadAdapterFor(
  async (schema) => {
    if (!TEST_DATABASE_IMPLEMENTATION)
      throw new Error(`No PowerSync SQLite implementation available`)
    const directory = await mkdtemp(join(tmpdir(), `powersync-reload-`))
    const database = new PowerSyncDatabase({
      database: {
        dbFilename: `source.sqlite`,
        dbLocation: directory,
        implementation: TEST_DATABASE_IMPLEMENTATION,
      },
      schema,
    })
    return {
      database,
      dispose: () =>
        withOracleCleanup(
          () => database.disconnectAndClear(),
          [
            () => database.close(),
            () => rm(directory, { force: true, recursive: true }),
          ],
        ),
    }
  },
)

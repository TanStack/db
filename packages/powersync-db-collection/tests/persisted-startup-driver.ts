// Node PowerSync SDK receiving path for the shared startup composition.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PowerSyncDatabase } from '@powersync/node'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { powerSyncStartupAdapterFor } from './persisted-startup-common'
import { TEST_DATABASE_IMPLEMENTATION } from './test-db-implementation'

export const powerSyncStartupAdapter = powerSyncStartupAdapterFor(
  async (schema) => {
    if (!TEST_DATABASE_IMPLEMENTATION)
      throw new Error(`No PowerSync SQLite implementation available`)
    const directory = await mkdtemp(join(tmpdir(), `powersync-startup-`))
    const file = `source.sqlite`
    const database = new PowerSyncDatabase({
      database: {
        dbFilename: file,
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

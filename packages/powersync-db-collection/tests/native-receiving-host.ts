/** Native SDK SQLite factory shared by the package's receiving instruments. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PowerSyncDatabase } from '@powersync/node'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { TEST_DATABASE_IMPLEMENTATION } from './test-db-implementation'
import type { Schema } from '@powersync/common'

export async function openNativeReceivingDatabase(schema: Schema) {
  if (!TEST_DATABASE_IMPLEMENTATION)
    throw new Error(`No native PowerSync SQLite implementation available`)
  const directory = await mkdtemp(join(tmpdir(), `powersync-receiving-`))
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
          () => rm(directory, { force: true, recursive: true }),
        ],
      ),
  }
}

/** Disk-backed Node receiving path for the primary exact cursor coverage law. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createSQLiteCorePersistenceAdapter } from '../../db-sqlite-persistence-core/src'
import { createSerializedNodeSqliteDriver } from '../../db-sqlite-persistence-core/tests/helpers/node-sqlite-driver'
import {
  observeCursorPersistedDemand,
  retainCursorDemandCleanup,
} from './cursor-persisted-demand-driver'
import { registerCursorPersistedDemand } from './cursor-persisted-demand-oracle-suite'

registerCursorPersistedDemand(
  `adapter.powersync-direct.persisted-cursor.node-sqlite`,
  async (history, id) => {
    const directory = await mkdtemp(join(tmpdir(), `ps-direct-cursor-`))
    return retainCursorDemandCleanup(
      () =>
        observeCursorPersistedDemand(history, id, () => {
          const database = new DatabaseSync(join(directory, `saved.sqlite`))
          return {
            persistence: {
              adapter: createSQLiteCorePersistenceAdapter({
                driver: createSerializedNodeSqliteDriver(database),
              }),
            },
            close: () => database.close(),
          }
        }),
      [() => rm(directory, { recursive: true, force: true })],
    )
  },
  {
    owns: [
      `src/index.ts#powerSyncCollectionOptions`,
      `src/subsets.ts#createSubsetHandlers`,
      `../db-sqlite-persistence-core/src/persisted.ts`,
    ],
    receivingPath: `Installed SDK on Node 26 over controlled HTTP and closed/reopened disk-backed node:sqlite connections.`,
  },
)

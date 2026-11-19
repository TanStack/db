/** Disk-backed node:sqlite receiving path; every session opens a fresh connection. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createSQLiteCorePersistenceAdapter } from '../../db-sqlite-persistence-core/src'
import { createSerializedNodeSqliteDriver } from '../../db-sqlite-persistence-core/tests/helpers/node-sqlite-driver'
import {
  observeDirectPersistedDemand,
  retainDirectDemandCleanup,
} from './persisted-demand-driver'
import { registerDirectPersistedDemand } from './persisted-demand-oracle-suite'

registerDirectPersistedDemand(
  `adapter.powersync-direct.persisted-demand.node-sqlite`,
  async (history, id) => {
    const directory = await mkdtemp(join(tmpdir(), `ps-direct-demand-`))
    return retainDirectDemandCleanup(
      () =>
        observeDirectPersistedDemand(history, id, () => {
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
    receivingPath: `Installed PowerSync standalone SDK over controlled HTTP and real disk-backed node:sqlite connections. Node 26 runs the SDK's native iterator API; this does not claim supported older Node compatibility.`,
  },
)

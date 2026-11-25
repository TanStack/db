/** Actual Convex SDK and fresh file-backed SQLite connections in each sync run. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createSQLiteCorePersistenceAdapter } from '../../db-sqlite-persistence-core/src'
import { createSerializedNodeSqliteDriver } from '../../db-sqlite-persistence-core/tests/helpers/node-sqlite-driver'
import { convexPersistedDemandSource } from '../../convex-db-collection/tests/persisted-demand-source'
import { retainOracleCleanupObservation } from '../../db/tests/oracle-cleanup'
import { observePersistedDemandPeer } from './persisted-demand-peer-driver'
import { registerPersistedDemandPeer } from './persisted-demand-peer-oracle-suite'

registerPersistedDemandPeer(
  `adapter.convex.persisted-demand-peer.node-sqlite`,
  async (history, id) => {
    const directory = await mkdtemp(join(tmpdir(), `convex-saved-peer-`))
    return retainOracleCleanupObservation(
      () =>
        observePersistedDemandPeer(
          history,
          id,
          convexPersistedDemandSource,
          () => {
            const database = new DatabaseSync(join(directory, `saved.sqlite`))
            return {
              persistence: {
                adapter: createSQLiteCorePersistenceAdapter({
                  driver: createSerializedNodeSqliteDriver(database),
                }),
              },
              close: () => database.close(),
            }
          },
        ),
      [() => rm(directory, { recursive: true, force: true })],
    )
  },
  {
    owns: [
      `../convex-db-collection/src/options.ts#createConvexOptions`,
      `../db-sqlite-persistence-core/src/persisted.ts`,
    ],
    path: `Actual Convex SDK over controlled WebSocket input and closed/reopened file-backed node:sqlite`,
  },
)

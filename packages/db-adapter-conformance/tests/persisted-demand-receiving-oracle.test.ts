/** Each session opens a new file-backed SQLite connection and a fresh SDK. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createSQLiteCorePersistenceAdapter } from '../../db-sqlite-persistence-core/src'
import { createSerializedNodeSqliteDriver } from '../../db-sqlite-persistence-core/tests/helpers/node-sqlite-driver'
import { retainOracleCleanupObservation } from '../../db/tests/oracle-cleanup'
import { createQueryPersistedDemandSource } from '../../query-db-collection/tests/persisted-demand-source'
import { createElectricPersistedDemandSource } from '../../electric-db-collection/tests/persisted-demand-source'
import { nativePowerSyncPersistedDemandSource } from '../../powersync-db-collection/tests/persisted-demand-source'
import { openNativeReceivingDatabase } from '../../powersync-db-collection/tests/native-receiving-host'
import { trailBasePersistedDemandSource } from '../../trailbase-db-collection/tests/persisted-demand-source'
import { convexPersistedDemandSource } from '../../convex-db-collection/tests/persisted-demand-source'
import { observePersistedDemandReceiving } from './persisted-demand-receiving-driver'
import { registerPersistedDemandReceiving } from './persisted-demand-receiving-oracle-suite'

const factories = {
  'adapter.query.persisted-demand.node-sqlite':
    createQueryPersistedDemandSource,
  'adapter.electric.persisted-demand.node-sqlite':
    createElectricPersistedDemandSource,
  'adapter.powersync.persisted-demand.node-sqlite':
    nativePowerSyncPersistedDemandSource(openNativeReceivingDatabase),
  'adapter.trailbase.persisted-demand.node-sqlite':
    trailBasePersistedDemandSource,
  'adapter.convex.persisted-demand.node-sqlite': convexPersistedDemandSource,
}
for (const [property, factory] of Object.entries(factories)) {
  registerPersistedDemandReceiving(
    property,
    async (history, id) => {
      const directory = await mkdtemp(join(tmpdir(), `adapter-saved-demand-`))
      return retainOracleCleanupObservation(
        () =>
          observePersistedDemandReceiving(history, id, factory, () => {
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
        `../query-db-collection/src/query.ts#queryCollectionOptions`,
        `../electric-db-collection/src/electric.ts#electricCollectionOptions`,
        `../powersync-db-collection/src/powersync.ts#powerSyncCollectionOptions`,
        `../trailbase-db-collection/src/trailbase.ts#trailBaseCollectionOptions`,
        `../convex-db-collection/src/options.ts#createConvexOptions`,
        `../db-sqlite-persistence-core/src/persisted.ts`,
      ],
      path: `${property}: actual SDK over controlled provider input; fresh file-backed node:sqlite connections`,
    },
  )
}

// @vitest-environment node
/** Installed SDK and real Node SQLite receive the shared acceptance judgment. */
import { DatabaseSync } from 'node:sqlite'
import { createSQLiteCorePersistenceAdapter } from '../../db-sqlite-persistence-core/src'
import { createSerializedNodeSqliteDriver } from '../../db-sqlite-persistence-core/tests/helpers/node-sqlite-driver'
import { observePersistedAcceptance } from './lazy-persisted-acceptance-driver'
import { registerPersistedAcceptance } from './lazy-persisted-acceptance-oracle-suite'

registerPersistedAcceptance(
  `convex.lazy-persisted-acceptance.node-sqlite`,
  (history, id) =>
    observePersistedAcceptance(history, id, () => {
      const database = new DatabaseSync(`:memory:`)
      return {
        persistence: {
          adapter: createSQLiteCorePersistenceAdapter({
            driver: createSerializedNodeSqliteDriver(database),
          }),
        },
        close: () => database.close(),
      }
    }),
  {
    owns: [
      `src/options.ts#createConvexOptions`,
      `../db-sqlite-persistence-core/src/persisted.ts`,
    ],
    path: `Installed Convex SDK over controlled WebSocket transitions and Node SQLite`,
  },
)

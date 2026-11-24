// @vitest-environment node
/** Real Node SQLite supplies the same FIFO read/write gates and shared judgment. */
import { DatabaseSync } from 'node:sqlite'
import { describe } from 'vitest'
import {
  SQLiteCorePersistenceAdapter,
  eagerStorageTarget,
  managedStorageTarget,
} from '../src'
import { registerSourceFifoOrderingOracle } from './persisted-source-fifo-oracle'
import { createMetadataSQLiteDriver } from './sync-metadata-sqlite-driver'
import type { OpenSourceFifoStore } from './persisted-source-fifo-oracle'
import type { Todo } from './persisted-support'

const openSQLite: OpenSourceFifoStore = async (id, rows, metadata) => {
  const database = new DatabaseSync(`:memory:`)
  const { driver, dispose } = createMetadataSQLiteDriver(database)
  const adapter = new SQLiteCorePersistenceAdapter({ driver })
  const claim = await adapter.claimCacheGeneration(id)
  const managed = managedStorageTarget(claim.storageCollectionId, claim.claimId)
  // Eager and on-demand histories use separate storage targets. Seed both with
  // the authored older baseline; the wrapper chooses its ordinary target.
  for (const target of [eagerStorageTarget(id), managed])
    await adapter.applyCommittedTx(target, {
      txId: `baseline-${target.kind}`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: rows.map((row) => ({
        type: `insert` as const,
        key: row.id,
        value: row,
      })),
      rowMetadataMutations:
        metadata === undefined
          ? []
          : [{ type: `set`, key: `shared`, value: metadata }],
    })
  let latestTarget = eagerStorageTarget(id)
  const apply = adapter.applyCommittedTx.bind(adapter)
  adapter.applyCommittedTx = (target, tx) => {
    latestTarget = target
    return apply(target, tx)
  }
  // Scoped scheduler loans call their own adapter, so also capture the actual
  // target at admission. This records identity, not expected row contents.
  const hydrate = adapter.runInHydrationScope.bind(adapter)
  adapter.runInHydrationScope = (task) =>
    hydrate((scope) =>
      task({
        ...scope,
        loadSubset: (target, ...args) => {
          latestTarget = target
          return scope.loadSubset(target, ...args)
        },
      }),
    )
  return {
    adapter,
    read: async () => {
      const snapshot = await adapter.loadResumeSnapshot(latestTarget, {
        includeRows: true,
      })
      return {
        rows: snapshot.rows.map((row) => row.value as Todo),
        metadata: snapshot.rows.find((row) => row.key === `shared`)?.metadata,
      }
    },
    close: async () => {
      try {
        await adapter.releaseCacheGenerationClaim(claim.claimId)
      } finally {
        await dispose()
        database.close()
      }
    },
  }
}
describe(`source FIFO over SQLite`, () =>
  registerSourceFifoOrderingOracle({
    property: `sqlite-persistence.source-fifo-order.node-sqlite`,
    owns: [`src/persisted.ts`, `src/sqlite-core-adapter.ts`],
    receivingPath: `Node 22 node:sqlite over the real SQLite adapter and its scoped scheduler loans.`,
    open: openSQLite,
  }))

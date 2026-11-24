/** Worker/OPFS supplies storage; the shared FIFO driver records every cut. */
import {
  eagerStorageTarget,
  managedStorageTarget,
} from '../../db-sqlite-persistence-core/src'
import { runSourceFifoHistory } from '../../db-sqlite-persistence-core/tests/persisted-source-fifo-driver'
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../src'
import {
  describeOracleCleanupError,
  retainOracleCleanupObservation,
  withOracleCleanup,
} from '../../db/tests/oracle-cleanup'
import {
  removeStartupOPFSArtifacts,
  startupOPFSArtifacts,
} from './persisted-startup-opfs-cleanup'
import { removeClosedArtifacts } from './query-rejected-write-cutoff-cleanup'
import type { OpenSourceFifoStore } from '../../db-sqlite-persistence-core/tests/persisted-source-fifo-driver'
import type { SourceFifoOrderingHistory } from '../../db-sqlite-persistence-core/tests/persisted-durability-model-oracle'
import type { Todo } from '../../db-sqlite-persistence-core/tests/persisted-support'
import type { ResumeRowProjectionInput } from '../../db-sqlite-persistence-core/tests/resume-row-projection-oracle'

let sequence = 0
const openOPFS: OpenSourceFifoStore = async (id, rows, metadata) => {
  const databaseName = `ps-source-fifo-${sequence++}.sqlite`
  await removeStartupOPFSArtifacts(databaseName)
  const database = await openBrowserWASQLiteOPFSDatabase({ databaseName })
  let releaseClaim: () => unknown = () => undefined
  const close = async () => {
    await withOracleCleanup(releaseClaim, [
      () => database.close?.(),
      () =>
        removeClosedArtifacts(
          () => removeStartupOPFSArtifacts(databaseName),
          (cut, value) => console.info(`source-fifo.opfs ${cut}`, value),
        ),
    ])
  }
  try {
    const { adapter } = createBrowserWASQLitePersistence({ database })
    const claim = await adapter.claimCacheGeneration!(id)
    releaseClaim = () => adapter.releaseCacheGenerationClaim!(claim.claimId)
    const managed = managedStorageTarget(
      claim.storageCollectionId,
      claim.claimId,
    )
    // The production wrapper chooses its own target. Both begin with the same
    // authored older rows; the fixture supplies no source-order judgment.
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
    const hydrate = adapter.runInHydrationScope!.bind(adapter)
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
      close,
    }
  } catch (error) {
    return withOracleCleanup(() => {
      throw error
    }, [close])
  }
}

async function runPersistedSourceFifo(history: SourceFifoOrderingHistory) {
  // The registrar has not compared these raw rows yet. Keep resource failures
  // beside them so a retained file cannot hide an earlier row/receipt mismatch.
  const recorded = await retainOracleCleanupObservation(
    async () => ({
      results: await runSourceFifoHistory(history, openOPFS),
      cleanupErrors: [] as Array<string>,
    }),
    [
      async () => {
        const artifacts = await startupOPFSArtifacts()
        if (artifacts.length)
          throw new Error(
            `Source FIFO fixture retained OPFS files: ${artifacts.join(`, `)}`,
          )
      },
    ],
  )
  recorded.results.at(-1)?.cleanupErrors.push(...recorded.cleanupErrors)
  return recorded.results
}

Object.assign(window, { runPersistedSourceFifo })

/** The projection owner supplies the judgment; this page supplies worker SQL. */
async function runResumeRowProjections(
  storedRows: ResumeRowProjectionInput[`storedRows`],
  requests: Array<{
    name: string
    includeRows: boolean
    rowKeys?: Array<string | number>
  }>,
  fault?: `full-row-then-read-error`,
) {
  const databaseName = `ps-resume-projection-${sequence++}.sqlite`
  await removeStartupOPFSArtifacts(databaseName)
  const database = await openBrowserWASQLiteOPFSDatabase({ databaseName })
  return retainOracleCleanupObservation(async () => {
    const { adapter } = createBrowserWASQLitePersistence({ database })
    const target = eagerStorageTarget(databaseName)
    let materialized: number | undefined
    const execute = database.execute.bind(database)
    database.execute = async <T>(
      sql: string,
      params?: ReadonlyArray<unknown>,
    ) => {
      const rows = await execute<T>(sql, params)
      if (
        materialized !== undefined &&
        /^\s*SELECT\s+key,\s*value,\s*metadata,\s*row_version\s+FROM\s/i.test(
          sql,
        )
      )
        materialized += rows.length
      return rows
    }
    await adapter.applyCommittedTx(target, {
      txId: `authored-projection-rows`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: storedRows.map(({ key, value }) => ({
        type: `insert` as const,
        key,
        value,
      })),
      rowMetadataMutations: storedRows.flatMap(({ key, metadata }) =>
        metadata === undefined
          ? []
          : [{ type: `set` as const, key, value: metadata }],
      ),
      collectionMetadataMutations: [
        { type: `set`, key: `source`, value: `unchanged resume facts` },
      ],
    })
    const full = await adapter.loadResumeSnapshot(target, { includeRows: true })
    if (fault && full.rows.length)
      full.rows[0] = {
        ...full.rows[0]!,
        value: {
          ...full.rows[0]!.value,
          title: `calibrated completed row corruption`,
        },
      }
    const snapshots = []
    let executionError: string | undefined
    for (const request of requests) {
      try {
        if (fault && request.name === `empty`)
          throw new Error(`calibrated later projection read failure`)
        materialized = 0
        const projected = await adapter.loadResumeSnapshot(target, request)
        snapshots.push({
          name: request.name,
          projected,
          materializedRows: materialized,
        })
      } catch (error) {
        executionError = describeOracleCleanupError(error)
        break
      } finally {
        materialized = undefined
      }
    }
    return {
      full,
      snapshots,
      executionError,
      cleanupErrors: [] as Array<string>,
    }
  }, [
    () => database.close?.(),
    () =>
      removeClosedArtifacts(
        () => removeStartupOPFSArtifacts(databaseName),
        (cut, value) => console.info(`resume-projection.opfs ${cut}`, value),
      ),
  ])
}

Object.assign(window, { runResumeRowProjections })

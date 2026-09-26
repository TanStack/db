import { AsyncLocalStorage } from 'node:async_hooks'
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fc } from '@fast-check/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { IR, createCollection } from '@tanstack/db'
import {
  SQLiteCorePersistenceAdapter,
  createPersistedTableName,
  persistedCollectionOptions,
} from '../src'
import { harnessScope } from './contracts/harness-scope'
import type {
  PersistenceAdapter,
  SQLiteDriver,
  SQLitePullSinceResult,
} from '../src'
import type { SyncConfig } from '@tanstack/db'

type Todo = {
  id: string
  title: string
  createdAt: string
  score: number
}

const execFileAsync = promisify(execFile)

function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return `NULL`
  }

  if (typeof value === `number`) {
    return Number.isFinite(value) ? String(value) : `NULL`
  }

  if (typeof value === `boolean`) {
    return value ? `1` : `0`
  }

  if (typeof value === `bigint`) {
    return value.toString()
  }

  const textValue = typeof value === `string` ? value : String(value)
  return `'${textValue.replace(/'/g, `''`)}'`
}

function interpolateSql(sql: string, params: ReadonlyArray<unknown>): string {
  let parameterIndex = 0
  const renderedSql = sql.replace(/\?/g, () => {
    const currentParam = params[parameterIndex]
    parameterIndex++
    return toSqlLiteral(currentParam)
  })

  if (parameterIndex !== params.length) {
    throw new Error(
      `SQL interpolation mismatch: used ${parameterIndex} params, received ${params.length}`,
    )
  }

  return renderedSql
}

export class SqliteCliDriver implements SQLiteDriver {
  private readonly transactionDbPath = new AsyncLocalStorage<string>()
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly dbPath: string) {}

  async exec(sql: string): Promise<void> {
    const activeDbPath = this.transactionDbPath.getStore()
    if (activeDbPath) {
      await execFileAsync(`sqlite3`, [activeDbPath, sql])
      return
    }

    await this.enqueue(async () => {
      await execFileAsync(`sqlite3`, [this.dbPath, sql])
    })
  }

  async query<T>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<ReadonlyArray<T>> {
    const activeDbPath = this.transactionDbPath.getStore()
    const renderedSql = interpolateSql(sql, params ?? [])
    const queryActiveDbPath = activeDbPath ?? this.dbPath

    const runQuery = async () => {
      const { stdout } = await execFileAsync(`sqlite3`, [
        `-json`,
        queryActiveDbPath,
        renderedSql,
      ])
      const trimmedOutput = stdout.trim()
      if (!trimmedOutput) {
        return []
      }
      return JSON.parse(trimmedOutput) as Array<T>
    }

    if (activeDbPath) {
      return runQuery()
    }

    return this.enqueue(async () => runQuery())
  }

  async run(sql: string, params?: ReadonlyArray<unknown>): Promise<void> {
    const activeDbPath = this.transactionDbPath.getStore()
    const renderedSql = interpolateSql(sql, params ?? [])
    const runActiveDbPath = activeDbPath ?? this.dbPath

    if (activeDbPath) {
      await execFileAsync(`sqlite3`, [runActiveDbPath, renderedSql])
      return
    }

    await this.enqueue(async () => {
      await execFileAsync(`sqlite3`, [runActiveDbPath, renderedSql])
    })
  }

  async transaction<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    if (fn.length === 0) {
      throw new Error(
        `SQLiteDriver.transaction callback must accept the transaction driver argument`,
      )
    }

    const activeDbPath = this.transactionDbPath.getStore()
    if (activeDbPath) {
      return fn(this)
    }

    return this.enqueue(async () => {
      const txDirectory = mkdtempSync(join(tmpdir(), `db-sqlite-core-tx-`))
      const txDbPath = join(txDirectory, `state.sqlite`)

      if (existsSync(this.dbPath)) {
        copyFileSync(this.dbPath, txDbPath)
      }

      try {
        const txResult = await this.transactionDbPath.run(txDbPath, async () =>
          fn(this),
        )

        if (existsSync(txDbPath)) {
          copyFileSync(txDbPath, this.dbPath)
        }
        return txResult
      } finally {
        rmSync(txDirectory, { recursive: true, force: true })
      }
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const queuedOperation = this.queue.then(operation, operation)
    this.queue = queuedOperation.then(
      () => undefined,
      () => undefined,
    )
    return queuedOperation
  }
}

type AdapterHarness = {
  adapter: SQLiteCorePersistenceAdapter
  driver: SqliteCliDriver
  dbPath: string
  cleanup: () => void | Promise<void>
}

export type SQLiteCoreAdapterContractHarness = {
  adapter: PersistenceAdapter & {
    pullSince: (
      collectionId: string,
      fromRowVersion: number,
    ) => Promise<SQLitePullSinceResult<string | number>>
  }
  driver: SQLiteDriver
  cleanup: () => void | Promise<void>
}

function createHarness(
  options?: Omit<
    ConstructorParameters<typeof SQLiteCorePersistenceAdapter>[0],
    `driver`
  >,
): AdapterHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-sqlite-core-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const driver = new SqliteCliDriver(dbPath)
  const adapter = new SQLiteCorePersistenceAdapter({
    driver,
    ...options,
  })

  return {
    adapter,
    driver,
    dbPath,
    cleanup: () => {
      rmSync(tempDirectory, { recursive: true, force: true })
    },
  }
}

type ResetResumeHistory = {
  fromSchemaVersion: number
  rows: Array<Todo>
  resumeKind: `none` | `reset` | `resume`
  transition:
    | `compatible-reopen`
    | `schema-reset`
    | `partial-restore`
    | `external-row-loss`
  reopensBeforeTransition: number
  reopensAfterTransition: number
  unrelatedMetadataKeys: Array<string>
}

type ResetResumeObservation = {
  checkpoint: `after-persistence-transition-restart`
  resetEpoch: number
  schemaVersion: number
  durableRows: ReadonlyArray<unknown>
  tombstones: ReadonlyArray<{ key: string; rowVersion: number }>
  appliedTransactions: ReadonlyArray<{ txId: string; rowVersion: number }>
  latestRowVersion: number
  metadataKeys: ReadonlyArray<string>
  resumeState: unknown
}

type ResetResumeExpectation = {
  metadataKeys: ReadonlyArray<string>
  resumeKind: unknown
}

function destroysPersistedBaseline(history: ResetResumeHistory): boolean {
  return (
    history.transition === `schema-reset` ||
    history.transition === `partial-restore`
  )
}

function expectedResetResumeMetadata(
  history: ResetResumeHistory,
): ResetResumeExpectation {
  if (destroysPersistedBaseline(history)) {
    return { metadataKeys: [], resumeKind: undefined }
  }

  return {
    metadataKeys: [
      ...(history.resumeKind === `none` ? [] : [`electric:resume`]),
      ...history.unrelatedMetadataKeys.map((key) => `oracle:${key}`),
    ].sort(),
    resumeKind: history.resumeKind === `none` ? undefined : history.resumeKind,
  }
}

class ResetResumeOracleViolation extends Error {
  readonly law: string = `reset-resume.baseline-lineage`
  readonly discriminant: string
  readonly history: ResetResumeHistory
  readonly observation: ResetResumeObservation
  readonly cleanupEvidence: string
  readonly expected: ResetResumeExpectation
  readonly actual: ResetResumeExpectation

  constructor(
    history: ResetResumeHistory,
    observation: ResetResumeObservation,
    cleanupEvidence: string,
    cause: unknown,
  ) {
    super(
      `A persisted-baseline transition violated collection-metadata lineage at the ` +
        `${observation.checkpoint}. ` +
        `history=${JSON.stringify(history)} ` +
        `observation=${JSON.stringify(observation)} ` +
        `cleanup=${cleanupEvidence}`,
      { cause },
    )
    this.name = `ResetResumeOracleViolation`
    this.history = structuredClone(history)
    this.observation = structuredClone(observation)
    this.cleanupEvidence = cleanupEvidence
    this.expected = expectedResetResumeMetadata(history)
    this.actual = {
      metadataKeys: [...observation.metadataKeys],
      resumeKind: resumeKindOf(observation.resumeState),
    }
    this.discriminant = destroysPersistedBaseline(history)
      ? `reset-retained-metadata`
      : `non-reset-metadata-changed`
  }
}

function hasSameResetResumeFailure(
  left: ResetResumeOracleViolation,
  right: ResetResumeOracleViolation,
): boolean {
  const signature = (failure: ResetResumeOracleViolation): string =>
    JSON.stringify({
      law: String(failure.law),
      discriminant: String(failure.discriminant),
      checkpoint: String(failure.observation.checkpoint),
      expectedMetadataClass:
        failure.expected.metadataKeys.length === 0 ? `empty` : `nonempty`,
      actualMetadataClass:
        failure.actual.metadataKeys.length === 0 ? `empty` : `nonempty`,
    })
  return signature(left) === signature(right)
}

function resumeKindOf(value: unknown): unknown {
  return value && typeof value === `object`
    ? (value as Record<string, unknown>).kind
    : undefined
}

function expectResetResumeLaw(
  history: ResetResumeHistory,
  observation: ResetResumeObservation,
): void {
  // The core adapter owns the reset transaction: it must clear every metadata
  // record coupled to the destroyed baseline. Compatible reopen and raw
  // external row loss do not give this generic layer authority to interpret an
  // Electric cursor, so they preserve the metadata exactly at this checkpoint.
  expect(
    {
      metadataKeys: observation.metadataKeys,
      resumeKind: resumeKindOf(observation.resumeState),
    },
    `reset clears all collection metadata; non-reset core transitions preserve it`,
  ).toEqual(expectedResetResumeMetadata(history))
}

function attachResetResumeCleanupDiagnostics(
  primary: unknown,
  cleanupEvidence: string,
  cleanupFailure: unknown,
): Error {
  const error =
    primary instanceof Error
      ? primary
      : new Error(`Reset/resume oracle failed with a non-Error value`, {
          cause: primary,
        })
  if (!(`cleanupEvidence` in error)) {
    Object.defineProperty(error, `cleanupEvidence`, {
      value: cleanupEvidence,
      enumerable: true,
    })
  }
  if (cleanupFailure !== undefined) {
    Object.defineProperty(error, `cleanupFailure`, {
      value: cleanupFailure,
      enumerable: true,
    })
  }
  return error
}

async function observeResetResumeHistory(
  history: ResetResumeHistory,
  harnessFactory: SQLiteCoreAdapterHarnessFactory,
): Promise<ResetResumeObservation> {
  let harness: ReturnType<SQLiteCoreAdapterHarnessFactory> | undefined
  const collectionId = `reset-resume-oracle`
  let observation!: ResetResumeObservation
  let primaryFailure: unknown
  let cleanupFailure: unknown
  let failurePhase: `setup` | `reach` | `law` | undefined
  let cleanupEvidence = `not-run`
  const expectedRows = structuredClone(history.rows)
  const seedRows = structuredClone(history.rows)
  const restoreRows = structuredClone(history.rows)

  try {
    harness = harnessFactory({ schemaVersion: history.fromSchemaVersion })
    await harness.adapter.applyCommittedTx(collectionId, {
      txId: `seed-baseline`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [
        ...seedRows.map((row) => ({
          type: `insert` as const,
          key: row.id,
          value: structuredClone(row),
        })),
        {
          type: `delete` as const,
          key: `deleted-before-baseline`,
          value: {
            id: `deleted-before-baseline`,
            title: `baseline tombstone`,
            createdAt: `2026-01-01T00:00:00.000Z`,
            score: -1,
          },
        },
      ],
      collectionMetadataMutations: [
        ...(history.resumeKind === `none`
          ? []
          : [
              {
                type: `set` as const,
                key: `electric:resume`,
                value:
                  history.resumeKind === `reset`
                    ? { kind: `reset`, updatedAt: 1 }
                    : {
                        kind: `resume`,
                        offset: `10_0`,
                        handle: `handle-before-reset`,
                        shapeId: `shape-before-reset`,
                        updatedAt: 1,
                      },
              },
            ]),
        ...history.unrelatedMetadataKeys.map((key, index) => ({
          type: `set` as const,
          key: `oracle:${key}`,
          value: { index },
        })),
      ],
    })

    for (let index = 0; index < history.reopensBeforeTransition; index++) {
      const reopened = new SQLiteCorePersistenceAdapter({
        driver: harness.driver,
        schemaVersion: history.fromSchemaVersion,
      })
      await reopened.loadSubset(collectionId, {})
      await reopened.loadCollectionMetadata(collectionId)
    }

    const usesSchemaReset = destroysPersistedBaseline(history)
    const nextSchemaVersion = usesSchemaReset
      ? history.fromSchemaVersion + 1
      : history.fromSchemaVersion
    let restarted = new SQLiteCorePersistenceAdapter({
      driver: harness.driver,
      schemaVersion: nextSchemaVersion,
      schemaMismatchPolicy: `sync-present-reset`,
    })
    await restarted.loadSubset(collectionId, {})

    if (history.transition === `partial-restore`) {
      await restarted.applyCommittedTx(collectionId, {
        txId: `partial-restore`,
        term: 2,
        seq: 1,
        rowVersion: 2,
        mutations: restoreRows.slice(0, -1).map((row) => ({
          type: `insert` as const,
          key: row.id,
          value: structuredClone(row),
        })),
      })
    } else if (history.transition === `external-row-loss`) {
      const collectionTable = createPersistedTableName(collectionId, `c`)
      await harness.driver.run(
        `DELETE FROM "${collectionTable}" WHERE json_extract(value, '$.id') = ?`,
        [history.rows[0]!.id],
      )
    }

    for (let index = 0; index < history.reopensAfterTransition; index++) {
      restarted = new SQLiteCorePersistenceAdapter({
        driver: harness.driver,
        schemaVersion: nextSchemaVersion,
        schemaMismatchPolicy: `sync-present-reset`,
      })
      await restarted.loadSubset(collectionId, {})
    }

    const metadata = await restarted.loadCollectionMetadata(collectionId)
    const resetEpochRows = await harness.driver.query<{ reset_epoch: number }>(
      `SELECT reset_epoch FROM collection_reset_epoch WHERE collection_id = ?`,
      [collectionId],
    )
    const registryRows = await harness.driver.query<{ schema_version: number }>(
      `SELECT schema_version FROM collection_registry WHERE collection_id = ?`,
      [collectionId],
    )
    const tombstoneTable = createPersistedTableName(collectionId, `t`)
    const tombstones = await harness.driver.query<{
      key: string
      row_version: number
    }>(`SELECT key, row_version FROM "${tombstoneTable}" ORDER BY key`)
    const appliedTransactions = await harness.driver.query<{
      tx_id: string
      row_version: number
    }>(
      `SELECT tx_id, row_version FROM applied_tx WHERE collection_id = ? ORDER BY term, seq`,
      [collectionId],
    )
    const versionRows = await harness.driver.query<{
      latest_row_version: number
    }>(
      `SELECT latest_row_version FROM collection_version WHERE collection_id = ?`,
      [collectionId],
    )
    observation = {
      checkpoint: `after-persistence-transition-restart`,
      resetEpoch: resetEpochRows[0]?.reset_epoch ?? -1,
      schemaVersion: registryRows[0]?.schema_version ?? -1,
      durableRows: (await restarted.loadSubset(collectionId, {})).sort((a, b) =>
        String(a.key).localeCompare(String(b.key)),
      ),
      tombstones: tombstones.map(({ key, row_version }) => ({
        key,
        rowVersion: row_version,
      })),
      appliedTransactions: appliedTransactions.map(
        ({ tx_id, row_version }) => ({
          txId: tx_id,
          rowVersion: row_version,
        }),
      ),
      latestRowVersion: versionRows[0]?.latest_row_version ?? -1,
      metadataKeys: metadata.map(({ key }) => key).sort(),
      resumeState: metadata.find(({ key }) => key === `electric:resume`)?.value,
    }

    try {
      // Positive reach evidence is separate from the semantic accusation.
      expect(observation.schemaVersion).toBe(nextSchemaVersion)
      expect(observation.resetEpoch).toBe(usesSchemaReset ? 1 : 0)
      expect(observation.durableRows).toEqual(
        (history.transition === `schema-reset`
          ? []
          : history.transition === `partial-restore`
            ? expectedRows.slice(0, -1)
            : history.transition === `external-row-loss`
              ? expectedRows.slice(1)
              : expectedRows
        )
          .map((value) => ({ key: value.id, value }))
          .sort((a, b) => String(a.key).localeCompare(String(b.key))),
      )
      expect(observation.tombstones).toEqual(
        usesSchemaReset
          ? []
          : [{ key: `s:deleted-before-baseline`, rowVersion: 1 }],
      )
      expect(observation.appliedTransactions).toEqual(
        history.transition === `schema-reset`
          ? []
          : history.transition === `partial-restore`
            ? [{ txId: `partial-restore`, rowVersion: 2 }]
            : [{ txId: `seed-baseline`, rowVersion: 1 }],
      )
      expect(observation.latestRowVersion).toBe(
        history.transition === `schema-reset`
          ? 0
          : history.transition === `partial-restore`
            ? 2
            : 1,
      )
    } catch (error) {
      failurePhase = `reach`
      primaryFailure = error
    }

    if (primaryFailure === undefined) {
      try {
        expectResetResumeLaw(history, observation)
      } catch (error) {
        failurePhase = `law`
        primaryFailure = error
      }
    }
  } catch (error) {
    if (primaryFailure === undefined) {
      failurePhase = `setup`
      primaryFailure = error
    }
  } finally {
    if (harness) {
      try {
        await harness.cleanup()
        cleanupEvidence =
          `dbPath` in harness && typeof harness.dbPath === `string`
            ? existsSync(harness.dbPath)
              ? `failed: SQLite file still exists`
              : `passed: SQLite file removed after captured checkpoint`
            : `passed: registered harness cleanup completed after captured checkpoint`
      } catch (cleanupError) {
        cleanupEvidence = `failed: ${String(cleanupError)}`
        cleanupFailure = cleanupError
      }
    }
  }

  if (primaryFailure !== undefined) {
    const failure =
      failurePhase === `law`
        ? new ResetResumeOracleViolation(
            history,
            observation,
            cleanupEvidence,
            primaryFailure,
          )
        : primaryFailure
    throw attachResetResumeCleanupDiagnostics(
      failure,
      cleanupEvidence,
      cleanupFailure,
    )
  }
  if (cleanupFailure !== undefined) throw cleanupFailure
  if (!cleanupEvidence.startsWith(`passed:`)) {
    throw new Error(cleanupEvidence)
  }
  return observation
}

export type SQLiteCoreAdapterHarnessFactory = (
  options?: Omit<
    ConstructorParameters<typeof SQLiteCorePersistenceAdapter>[0],
    `driver`
  >,
) => SQLiteCoreAdapterContractHarness

function holdAndRejectFirstSubsetLoad(
  adapter: PersistenceAdapter,
  failure: Error,
): { entered: Promise<void>; release: () => void } {
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let loadCalls = 0
  const intercept =
    (loadSubset: PersistenceAdapter[`loadSubset`]) =>
    async (...args: Parameters<PersistenceAdapter[`loadSubset`]>) => {
      loadCalls++
      if (loadCalls === 1) {
        enter()
        await held
        throw failure
      }
      return loadSubset(...args)
    }

  const runInHydrationScope = adapter.runInHydrationScope?.bind(adapter)
  if (runInHydrationScope) {
    adapter.runInHydrationScope = (task) =>
      runInHydrationScope((scopedAdapter) =>
        task({
          ...scopedAdapter,
          loadSubset: intercept(scopedAdapter.loadSubset),
        }),
      )
  } else {
    adapter.loadSubset = intercept(adapter.loadSubset.bind(adapter))
  }

  return { entered, release }
}

export function runSQLiteCoreAdapterContractSuite(
  suiteName: string = `SQLiteCorePersistenceAdapter`,
  harnessFactory: SQLiteCoreAdapterHarnessFactory = createHarness,
): void {
  const scope = harnessScope(harnessFactory)
  const registerContractHarness = scope.create

  describe(suiteName, () => {
    afterEach(scope.cleanup)
    it(`applies transactions idempotently with row versions and tombstones`, async () => {
      const { adapter, driver } = registerContractHarness()
      const collectionId = `todos`

      await adapter.applyCommittedTx(collectionId, {
        txId: `tx-1`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              title: `Initial`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 10,
            },
          },
        ],
      })
      await adapter.applyCommittedTx(collectionId, {
        txId: `tx-1-replay`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              title: `Initial`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 10,
            },
          },
        ],
      })

      const txRows = await driver.query<{ count: number }>(
        `SELECT COUNT(*) AS count
       FROM applied_tx
       WHERE collection_id = ?`,
        [collectionId],
      )
      expect(txRows[0]?.count).toBe(1)

      await adapter.applyCommittedTx(collectionId, {
        txId: `tx-2`,
        term: 1,
        seq: 2,
        rowVersion: 2,
        mutations: [
          {
            type: `update`,
            key: `1`,
            value: {
              id: `1`,
              title: `Updated`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 11,
            },
          },
        ],
      })

      const updated = await adapter.loadSubset(collectionId, {
        where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(`1`)]),
      })
      expect(updated).toEqual([
        {
          key: `1`,
          value: {
            id: `1`,
            title: `Updated`,
            createdAt: `2026-01-01T00:00:00.000Z`,
            score: 11,
          },
        },
      ])

      await adapter.applyCommittedTx(collectionId, {
        txId: `tx-3`,
        term: 1,
        seq: 3,
        rowVersion: 3,
        mutations: [
          {
            type: `delete`,
            key: `1`,
            value: {
              id: `1`,
              title: `Updated`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 11,
            },
          },
        ],
      })

      const remainingRows = await adapter.loadSubset(collectionId, {})
      expect(remainingRows).toEqual([])

      const tombstoneTable = createPersistedTableName(collectionId, `t`)
      const tombstoneRows = await driver.query<{
        key: string
        row_version: number
      }>(`SELECT key, row_version FROM "${tombstoneTable}"`)
      expect(tombstoneRows).toHaveLength(1)
      expect(tombstoneRows[0]?.row_version).toBe(3)
    })

    it(`reconstructs a seeded baseline before releasing a partial source update after subset failure`, async () => {
      const { adapter } = registerContractHarness()
      const collectionId = `partial-source-after-subset-failure`
      const baseline: Todo = {
        id: `1`,
        title: `Persisted baseline`,
        createdAt: `2026-01-01T00:00:00.000Z`,
        score: 10,
      }
      const expected: Todo = { ...baseline, title: `Source update` }
      await adapter.applyCommittedTx(collectionId, {
        txId: `seed-partial-source-baseline`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [{ type: `insert`, key: baseline.id, value: baseline }],
      })

      const loadSubset = adapter.loadSubset.bind(adapter)
      const subsetFailure = new Error(`controlled incremental subset failure`)
      const subsetLoad = holdAndRejectFirstSubsetLoad(adapter, subsetFailure)

      let source!: Parameters<SyncConfig<Todo, string>[`sync`]>[0]
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: collectionId,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          sync: {
            rowUpdateMode: `partial`,
            sync: (params) => {
              source = params
              params.markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter },
        }),
      )
      const project = (row: Todo | undefined) =>
        row && {
          id: row.id,
          title: row.title,
          createdAt: row.createdAt,
          score: row.score,
        }

      let load: Promise<void> | undefined
      let receipt: Promise<void> | undefined
      try {
        await collection.stateWhenReady()
        load = Promise.resolve(collection._sync.loadSubset({ limit: 1 })).then(
          () => undefined,
        )
        void load.catch(() => undefined)
        await subsetLoad.entered

        source.begin()
        source.write({
          type: `update`,
          value: { id: baseline.id, title: expected.title } as Todo,
        })
        receipt = Promise.resolve(source.commit()).then(() => undefined)
        let receiptStatus: `pending` | `fulfilled` | `rejected` = `pending`
        void receipt.then(
          () => {
            receiptStatus = `fulfilled`
          },
          () => {
            receiptStatus = `rejected`
          },
        )
        expect(receiptStatus).toBe(`pending`)

        subsetLoad.release()
        await expect(load).rejects.toBe(subsetFailure)
        await receipt
        const durableBeforeRetry = await loadSubset(collectionId, {})
        expect({
          receiptStatus,
          status: collection.status,
          publicError: collection._lifecycle.getSyncError(),
          publicBeforeRetry: project(collection.get(baseline.id)),
          durableBeforeRetry: durableBeforeRetry.map(({ value }) => value),
        }).toEqual({
          receiptStatus: `fulfilled`,
          status: `ready`,
          publicError: undefined,
          publicBeforeRetry: expected,
          durableBeforeRetry: [expected],
        })

        await collection._sync.loadSubset({ limit: 1 })
        expect({
          publicAfterRetry: project(collection.get(baseline.id)),
          status: collection.status,
          publicError: collection._lifecycle.getSyncError(),
        }).toEqual({
          publicAfterRetry: expected,
          status: `ready`,
          publicError: undefined,
        })
      } finally {
        subsetLoad.release()
        await load?.catch(() => undefined)
        await receipt?.catch(() => undefined)
        await collection.cleanup()
      }
    })

    it.each([`delete`, `insert`] as const)(
      `settles a buffered complete %s across subset failure and retry`,
      async (operation) => {
        const { adapter } = registerContractHarness()
        const collectionId = `complete-${operation}-after-subset-failure`
        const row: Todo = {
          id: `1`,
          title: `${operation} row`,
          createdAt: `2026-01-02T00:00:00.000Z`,
          score: 11,
        }
        if (operation === `delete`) {
          await adapter.applyCommittedTx(collectionId, {
            txId: `seed-delete-baseline`,
            term: 1,
            seq: 1,
            rowVersion: 1,
            mutations: [{ type: `insert`, key: row.id, value: row }],
          })
        }

        const loadSubset = adapter.loadSubset.bind(adapter)
        const subsetFailure = new Error(
          `controlled ${operation} subset failure`,
        )
        const subsetLoad = holdAndRejectFirstSubsetLoad(adapter, subsetFailure)

        let source!: Parameters<SyncConfig<Todo, string>[`sync`]>[0]
        const collection = createCollection(
          persistedCollectionOptions<Todo, string>({
            id: collectionId,
            getKey: (value) => value.id,
            syncMode: `on-demand`,
            sync: {
              rowUpdateMode: `partial`,
              sync: (params) => {
                source = params
                params.markReady()
                return { loadSubset: () => true }
              },
            },
            persistence: { adapter },
          }),
        )

        let load: Promise<void> | undefined
        let receipt: Promise<void> | undefined
        try {
          await collection.stateWhenReady()
          load = Promise.resolve(
            collection._sync.loadSubset({ limit: 1 }),
          ).then(() => undefined)
          void load.catch(() => undefined)
          await subsetLoad.entered

          source.begin()
          source.write(
            operation === `delete`
              ? { type: `delete`, key: row.id }
              : { type: `insert`, value: row },
          )
          receipt = Promise.resolve(source.commit()).then(() => undefined)
          let receiptStatus: `pending` | `fulfilled` | `rejected` = `pending`
          void receipt.then(
            () => {
              receiptStatus = `fulfilled`
            },
            () => {
              receiptStatus = `rejected`
            },
          )
          expect(receiptStatus).toBe(`pending`)

          subsetLoad.release()
          await expect(load).rejects.toBe(subsetFailure)
          await receipt
          const expectedRows = operation === `delete` ? [] : [row]
          expect({
            receiptStatus,
            publicRows: [...collection.values()].map((value) => ({
              id: value.id,
              title: value.title,
              createdAt: value.createdAt,
              score: value.score,
            })),
            durableRows: (await loadSubset(collectionId, {})).map(
              ({ value }) => value,
            ),
            status: collection.status,
            publicError: collection._lifecycle.getSyncError(),
          }).toEqual({
            receiptStatus: `fulfilled`,
            publicRows: expectedRows,
            durableRows: expectedRows,
            status: `ready`,
            publicError: undefined,
          })

          await collection._sync.loadSubset({ limit: 1 })
          expect({
            publicRows: [...collection.values()].map((value) => ({
              id: value.id,
              title: value.title,
              createdAt: value.createdAt,
              score: value.score,
            })),
            status: collection.status,
            publicError: collection._lifecycle.getSyncError(),
          }).toEqual({
            publicRows: expectedRows,
            status: `ready`,
            publicError: undefined,
          })
        } finally {
          subsetLoad.release()
          await load?.catch(() => undefined)
          await receipt?.catch(() => undefined)
          await collection.cleanup()
        }
      },
    )

    it(`rolls back partially applied mutations when transaction fails`, async () => {
      const { adapter, driver } = registerContractHarness()
      const collectionId = `atomicity`

      await expect(
        adapter.applyCommittedTx(collectionId, {
          txId: `atomicity-1`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `1`,
              value: {
                id: `1`,
                title: `First`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 1,
              },
            },
            {
              type: `insert`,
              key: `2`,
              value: {
                id: `2`,
                title: `Second`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 2,
                // Trigger serialization failure after the first mutation executes.
                unsafeDate: new Date(Number.NaN),
              } as unknown as Todo,
            },
          ],
        }),
      ).rejects.toThrow()

      const rows = await adapter.loadSubset(collectionId, {})
      expect(rows).toEqual([])

      const txRows = await driver.query<{ count: number }>(
        `SELECT COUNT(*) AS count
       FROM applied_tx
       WHERE collection_id = ?`,
        [collectionId],
      )
      expect(txRows[0]?.count).toBe(0)
    })

    it(`persists row metadata and collection metadata atomically`, async () => {
      const { adapter, driver } = registerContractHarness()
      const collectionId = `metadata-roundtrip`

      await adapter.applyCommittedTx(collectionId, {
        txId: `metadata-1`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              title: `Tracked`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 1,
            },
            metadata: {
              queryCollection: {
                owners: {
                  q1: true,
                },
              },
            },
            metadataChanged: true,
          },
        ],
        collectionMetadataMutations: [
          {
            type: `set`,
            key: `electric:resume`,
            value: {
              kind: `resume`,
              offset: `10_0`,
              handle: `handle-1`,
              shapeId: `shape-1`,
              updatedAt: 1,
            },
          },
        ],
      })

      const rows = await adapter.loadSubset(collectionId, {})
      expect(rows).toEqual([
        {
          key: `1`,
          value: {
            id: `1`,
            title: `Tracked`,
            createdAt: `2026-01-01T00:00:00.000Z`,
            score: 1,
          },
          metadata: {
            queryCollection: {
              owners: {
                q1: true,
              },
            },
          },
        },
      ])

      const collectionMetadata =
        await adapter.loadCollectionMetadata?.(collectionId)
      expect(collectionMetadata).toEqual([
        {
          key: `electric:resume`,
          value: {
            kind: `resume`,
            offset: `10_0`,
            handle: `handle-1`,
            shapeId: `shape-1`,
            updatedAt: 1,
          },
        },
      ])

      await expect(
        adapter.applyCommittedTx(collectionId, {
          txId: `metadata-2`,
          term: 1,
          seq: 2,
          rowVersion: 2,
          mutations: [
            {
              type: `insert`,
              key: `2`,
              value: {
                id: `2`,
                title: `Bad`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 2,
              },
            },
          ],
          collectionMetadataMutations: [
            {
              type: `set`,
              key: `broken`,
              value: {
                invalid: new Date(Number.NaN),
              },
            },
          ],
        }),
      ).rejects.toThrow()

      const rowsAfterFailure = await adapter.loadSubset(collectionId, {})
      expect(rowsAfterFailure).toEqual(rows)

      const metadataRows = await driver.query<{ key: string }>(
        `SELECT key
         FROM collection_metadata
         WHERE collection_id = ?`,
        [collectionId],
      )
      expect(metadataRows).toEqual([{ key: `electric:resume` }])
    })

    it(`persists truncate transactions while preserving explicit collection metadata`, async () => {
      const { adapter } = registerContractHarness()
      const collectionId = `truncate-metadata-roundtrip`

      await adapter.applyCommittedTx(collectionId, {
        txId: `seed-1`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              title: `Before truncate`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 1,
            },
            metadata: {
              owner: `before`,
            },
            metadataChanged: true,
          },
        ],
        collectionMetadataMutations: [
          {
            type: `set`,
            key: `electric:resume`,
            value: {
              kind: `resume`,
              offset: `10_0`,
              handle: `handle-1`,
              shapeId: `shape-1`,
              updatedAt: 1,
            },
          },
        ],
      })

      await adapter.applyCommittedTx(collectionId, {
        txId: `truncate-2`,
        term: 1,
        seq: 2,
        rowVersion: 2,
        truncate: true,
        mutations: [
          {
            type: `insert`,
            key: `2`,
            value: {
              id: `2`,
              title: `After truncate`,
              createdAt: `2026-01-02T00:00:00.000Z`,
              score: 2,
            },
            metadata: {
              owner: `after`,
            },
            metadataChanged: true,
          },
        ],
        collectionMetadataMutations: [
          {
            type: `set`,
            key: `electric:resume`,
            value: {
              kind: `reset`,
              updatedAt: 2,
            },
          },
        ],
      })

      expect(await adapter.loadSubset(collectionId, {})).toEqual([
        {
          key: `2`,
          value: {
            id: `2`,
            title: `After truncate`,
            createdAt: `2026-01-02T00:00:00.000Z`,
            score: 2,
          },
          metadata: {
            owner: `after`,
          },
        },
      ])

      expect(await adapter.loadCollectionMetadata?.(collectionId)).toEqual([
        {
          key: `electric:resume`,
          value: {
            kind: `reset`,
            updatedAt: 2,
          },
        },
      ])
    })

    it(`supports pushdown operators with correctness-preserving fallback`, async () => {
      const { adapter } = registerContractHarness()
      const collectionId = `todos`

      const rows: Array<Todo> = [
        {
          id: `1`,
          title: `Task Alpha`,
          createdAt: `2026-01-01T00:00:00.000Z`,
          score: 10,
        },
        {
          id: `2`,
          title: `Task Beta`,
          createdAt: `2026-01-02T00:00:00.000Z`,
          score: 20,
        },
        {
          id: `3`,
          title: `Other`,
          createdAt: `2026-01-03T00:00:00.000Z`,
          score: 15,
        },
        {
          id: `4`,
          title: `Task Gamma`,
          createdAt: `2026-01-04T00:00:00.000Z`,
          score: 25,
        },
      ]

      await adapter.applyCommittedTx(collectionId, {
        txId: `seed-1`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: rows.map((row) => ({
          type: `insert` as const,
          key: row.id,
          value: row,
        })),
      })

      const filtered = await adapter.loadSubset(collectionId, {
        where: new IR.Func(`and`, [
          new IR.Func(`or`, [
            new IR.Func(`like`, [
              new IR.PropRef([`title`]),
              new IR.Value(`%Task%`),
            ]),
            new IR.Func(`in`, [new IR.PropRef([`id`]), new IR.Value([`3`])]),
          ]),
          new IR.Func(`eq`, [
            new IR.Func(`date`, [new IR.PropRef([`createdAt`])]),
            new IR.Value(`2026-01-02`),
          ]),
        ]),
        orderBy: [
          {
            expression: new IR.PropRef([`score`]),
            compareOptions: {
              direction: `desc`,
              nulls: `last`,
            },
          },
        ],
      })

      expect(filtered).toEqual([
        {
          key: `2`,
          value: {
            id: `2`,
            title: `Task Beta`,
            createdAt: `2026-01-02T00:00:00.000Z`,
            score: 20,
          },
        },
      ])

      const withInEmpty = await adapter.loadSubset(collectionId, {
        where: new IR.Func(`in`, [
          new IR.PropRef([`id`]),
          new IR.Value([] as Array<string>),
        ]),
      })
      expect(withInEmpty).toEqual([])
    })

    it(`supports datetime/strftime predicate compilation for ISO date fields`, async () => {
      const { adapter } = registerContractHarness()
      const collectionId = `date-pushdown`

      await adapter.applyCommittedTx(collectionId, {
        txId: `seed-date`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              title: `Start`,
              createdAt: `2026-01-02T00:00:00.000Z`,
              score: 1,
            },
          },
          {
            type: `insert`,
            key: `2`,
            value: {
              id: `2`,
              title: `Other`,
              createdAt: `2026-01-03T00:00:00.000Z`,
              score: 2,
            },
          },
        ],
      })

      const rows = await adapter.loadSubset(collectionId, {
        where: new IR.Func(`and`, [
          new IR.Func(`eq`, [
            new IR.Func(`strftime`, [
              new IR.Value(`%Y-%m-%d`),
              new IR.Func(`datetime`, [new IR.PropRef([`createdAt`])]),
            ]),
            new IR.Value(`2026-01-02`),
          ]),
          new IR.Func(`eq`, [
            new IR.Func(`date`, [new IR.PropRef([`createdAt`])]),
            new IR.Value(`2026-01-02`),
          ]),
        ]),
      })

      expect(rows.map((row) => row.key)).toEqual([`1`])
    })

    it(`persists bigint/date values and evaluates typed predicates`, async () => {
      const { adapter } = registerContractHarness()
      const typedAdapter = adapter as unknown as PersistenceAdapter
      const collectionId = `typed-values`
      const firstBigInt = BigInt(`9007199254740992`)
      const secondBigInt = BigInt(`9007199254740997`)

      await typedAdapter.applyCommittedTx(collectionId, {
        txId: `seed-typed-values`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              title: `Alpha`,
              createdAt: new Date(`2026-01-02T00:00:00.000Z`),
              largeViewCount: firstBigInt,
            },
          },
          {
            type: `insert`,
            key: `2`,
            value: {
              id: `2`,
              title: `Beta`,
              createdAt: new Date(`2026-01-03T00:00:00.000Z`),
              largeViewCount: secondBigInt,
            },
          },
        ],
      })

      const bigintRows = await typedAdapter.loadSubset(collectionId, {
        where: new IR.Func(`gt`, [
          new IR.PropRef([`largeViewCount`]),
          new IR.Value(BigInt(`9007199254740993`)),
        ]),
      })
      expect(bigintRows.map((row) => row.key)).toEqual([`2`])

      const dateRows = await typedAdapter.loadSubset(collectionId, {
        where: new IR.Func(`gt`, [
          new IR.PropRef([`createdAt`]),
          new IR.Value(new Date(`2026-01-02T12:00:00.000Z`)),
        ]),
      })
      expect(dateRows.map((row) => row.key)).toEqual([`2`])

      const restoredRows = await typedAdapter.loadSubset(collectionId, {
        where: new IR.Func(`eq`, [
          new IR.Func(`date`, [new IR.PropRef([`createdAt`])]),
          new IR.Value(`2026-01-02`),
        ]),
      })
      const firstRow = restoredRows[0]?.value
      expect(firstRow?.createdAt).toBeInstanceOf(Date)
      expect(firstRow?.largeViewCount).toBe(firstBigInt)
    })

    it(`handles cursor whereCurrent/whereFrom requests`, async () => {
      const { adapter } = registerContractHarness()
      const collectionId = `todos`

      await adapter.applyCommittedTx(collectionId, {
        txId: `seed-cursor`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `a`,
            value: {
              id: `a`,
              title: `A`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 10,
            },
          },
          {
            type: `insert`,
            key: `b`,
            value: {
              id: `b`,
              title: `B`,
              createdAt: `2026-01-02T00:00:00.000Z`,
              score: 10,
            },
          },
          {
            type: `insert`,
            key: `c`,
            value: {
              id: `c`,
              title: `C`,
              createdAt: `2026-01-03T00:00:00.000Z`,
              score: 12,
            },
          },
          {
            type: `insert`,
            key: `d`,
            value: {
              id: `d`,
              title: `D`,
              createdAt: `2026-01-04T00:00:00.000Z`,
              score: 13,
            },
          },
        ],
      })

      const rows = await adapter.loadSubset(collectionId, {
        orderBy: [
          {
            expression: new IR.PropRef([`score`]),
            compareOptions: {
              direction: `asc`,
              nulls: `last`,
            },
          },
        ],
        limit: 1,
        cursor: {
          whereCurrent: new IR.Func(`eq`, [
            new IR.PropRef([`score`]),
            new IR.Value(10),
          ]),
          whereFrom: new IR.Func(`gt`, [
            new IR.PropRef([`score`]),
            new IR.Value(10),
          ]),
        },
      })

      expect(rows.map((row) => row.key)).toEqual([`a`, `b`, `c`])
    })

    it(`ensures and removes persisted indexes with registry tracking`, async () => {
      const { adapter, driver } = registerContractHarness()
      const collectionId = `todos`
      const signature = `idx-title`

      await adapter.ensureIndex(collectionId, signature, {
        expressionSql: [`json_extract(value, '$.title')`],
      })
      await adapter.ensureIndex(collectionId, signature, {
        expressionSql: [`json_extract(value, '$.title')`],
      })

      const registryRows = await driver.query<{
        removed: number
        index_name: string
      }>(
        `SELECT removed, index_name
       FROM persisted_index_registry
       WHERE collection_id = ? AND signature = ?`,
        [collectionId, signature],
      )
      expect(registryRows).toHaveLength(1)
      expect(registryRows[0]?.removed).toBe(0)

      const createdIndexName = registryRows[0]?.index_name
      const sqliteMasterBefore = await driver.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
        [createdIndexName],
      )
      expect(sqliteMasterBefore).toHaveLength(1)

      if (!adapter.markIndexRemoved) {
        throw new Error(
          `Adapter must implement markIndexRemoved for this contract suite`,
        )
      }
      await adapter.markIndexRemoved(collectionId, signature)

      const registryRowsAfter = await driver.query<{ removed: number }>(
        `SELECT removed
       FROM persisted_index_registry
       WHERE collection_id = ? AND signature = ?`,
        [collectionId, signature],
      )
      expect(registryRowsAfter[0]?.removed).toBe(1)

      const sqliteMasterAfter = await driver.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
        [createdIndexName],
      )
      expect(sqliteMasterAfter).toHaveLength(0)
    })

    it(`rebuilds a physical index when the normalized spec changes`, async () => {
      const { adapter, driver } = registerContractHarness()
      const collectionId = `todos`
      const signature = `idx-upgraded-expression`

      await adapter.ensureIndex(collectionId, signature, {
        expressionSql: [`json_extract(value, '$.title')`],
      })

      const registryRows = await driver.query<{ index_name: string }>(
        `SELECT index_name
         FROM persisted_index_registry
         WHERE collection_id = ? AND signature = ?`,
        [collectionId, signature],
      )
      const indexName = registryRows[0]?.index_name
      expect(indexName).toBeTruthy()

      await adapter.ensureIndex(collectionId, signature, {
        expressionSql: [`json_extract(value, '$.score')`],
      })

      const sqliteMasterRows = await driver.query<{ sql: string }>(
        `SELECT sql
         FROM sqlite_master
         WHERE type = 'index' AND name = ?`,
        [indexName],
      )
      expect(sqliteMasterRows).toHaveLength(1)
      expect(sqliteMasterRows[0]?.sql).toContain(
        `json_extract(value, '$.score')`,
      )
      expect(sqliteMasterRows[0]?.sql).not.toContain(
        `json_extract(value, '$.title')`,
      )
    })

    it(`enforces schema mismatch policies`, async () => {
      const baseHarness = registerContractHarness({
        schemaVersion: 1,
        schemaMismatchPolicy: `reset`,
      })
      const collectionId = `todos`
      await baseHarness.adapter.applyCommittedTx(collectionId, {
        txId: `seed-schema`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              title: `Before mismatch`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 1,
            },
          },
        ],
      })

      const strictAdapter = new SQLiteCorePersistenceAdapter({
        driver: baseHarness.driver,
        schemaVersion: 2,
        schemaMismatchPolicy: `sync-absent-error`,
      })
      await expect(strictAdapter.loadSubset(collectionId, {})).rejects.toThrow(
        /Schema version mismatch/,
      )

      const resetAdapter = new SQLiteCorePersistenceAdapter({
        driver: baseHarness.driver,
        schemaVersion: 2,
        schemaMismatchPolicy: `sync-present-reset`,
      })
      const resetRows = await resetAdapter.loadSubset(collectionId, {})
      expect(resetRows).toEqual([])
    })

    /**
     * Reset/resume oracle card
     *
     * Law and source: a destructive schema reset creates a new persisted
     * baseline and clears every collection-metadata record in that reset
     * transaction. Same-schema restarts preserve metadata, including for a
     * genuinely empty baseline. The production reset policy above and the
     * independently reproduced history in
     * https://github.com/TanStack/db/issues/1589 establish this narrow law.
     *
     * Domain and legal histories: zero-to-four committed rows; absent, reset,
     * or non-initial resume metadata; same-schema restart, vN -> vN+1
     * sync-present-reset, a partial restore after reset, or out-of-band row
     * loss; restarts on either side; unrelated metadata.
     *
     * Reference: a two-generation lineage relation. Same-schema reopen and raw
     * external loss keep the core generation/metadata record; schema reset
     * replaces the generation and starts with no metadata. This model does not
     * inspect the adapter's SQL branches or infer compatibility from row
     * cardinality.
     *
     * Production path and checkpoint: SQLiteCorePersistenceAdapter commits a
     * real SQLite baseline, then a new adapter instance reaches
     * ensureCollectionReady/handleSchemaMismatch. At the
     * after-persistence-transition-restart checkpoint we inspect registry
     * version, reset epoch/generation, complete durable rows, tombstones,
     * applied transactions, and collection metadata.
     *
     * Observed result and known omissions: exact settled rows, exact metadata
     * keys, and whether the durable Electric state is absent/reset/resume. The
     * external-loss lane proves the generic adapter leaves metadata reachable;
     * only the persisted+Electric suite judges whether that cursor is safe to
     * consume. The injected loss is not a claim that arbitrary SQL is a
     * supported public API. Partial resumed updates and SDK framing retain
     * their executable owners in the Electric recovery and framing suites.
     *
     * Trust: reset_epoch and schema_version prove reach; retained metadata
     * after reset is the whole-path fault control, while compatible and
     * external-loss histories calibrate preservation. Every generated database
     * is removed after evidence capture. The failure reports first and reduced
     * histories plus a verified fast-check seed/path replay.
     */
    it(`resets collection metadata with its persisted baseline across generated restart histories`, async () => {
      const historyArbitrary = fc
        .constantFrom<
          ResetResumeHistory[`transition`]
        >(`compatible-reopen`, `schema-reset`, `partial-restore`, `external-row-loss`)
        .chain((transition) =>
          fc.record<ResetResumeHistory>({
            fromSchemaVersion: fc.integer({ min: 1, max: 4 }),
            rows: fc
              .uniqueArray(fc.integer({ min: 0, max: 20 }), {
                minLength:
                  transition === `partial-restore`
                    ? 2
                    : transition === `external-row-loss`
                      ? 1
                      : 0,
                maxLength: 4,
              })
              .map((ids) =>
                ids
                  .sort((left, right) => left - right)
                  .map((id) => ({
                    id: String(id),
                    title: `row-${id}`,
                    createdAt: `2026-01-01T00:00:00.000Z`,
                    score: id,
                  })),
              ),
            resumeKind: fc.constantFrom(`none`, `reset`, `resume`),
            transition: fc.constant(transition),
            reopensBeforeTransition: fc.integer({ min: 0, max: 2 }),
            reopensAfterTransition: fc.integer({ min: 0, max: 2 }),
            unrelatedMetadataKeys: fc.uniqueArray(
              fc.constantFrom(`gc`, `provider`, `custom`),
              { maxLength: 3 },
            ),
          }),
        )

      const seedText =
        process.env.TANSTACK_DB_SQLITE_ORACLE_SEED ?? String(1659)
      const seed = Number(seedText)
      const path = process.env.TANSTACK_DB_SQLITE_ORACLE_PATH
      const runsText = process.env.TANSTACK_DB_SQLITE_ORACLE_RUNS ?? String(24)
      const numRuns = Number(runsText)
      if (!Number.isSafeInteger(seed)) {
        throw new Error(`TANSTACK_DB_SQLITE_ORACLE_SEED must be an integer`)
      }
      if (!Number.isSafeInteger(numRuns) || numRuns < 1) {
        throw new Error(`TANSTACK_DB_SQLITE_ORACLE_RUNS must be positive`)
      }
      if (path !== undefined && !/^\d+(?::\d+)*$/.test(path)) {
        throw new Error(
          `TANSTACK_DB_SQLITE_ORACLE_PATH must be a numeric shrink path`,
        )
      }

      let originalFailure: ResetResumeOracleViolation | undefined
      const property = fc.asyncProperty(historyArbitrary, async (history) => {
        try {
          await observeResetResumeHistory(history, harnessFactory)
        } catch (error) {
          if (
            originalFailure === undefined &&
            error instanceof ResetResumeOracleViolation
          ) {
            originalFailure = error
          }
          throw error
        }
      })
      const failure = await fc.check(property, {
        seed,
        numRuns,
        ...(path === undefined ? {} : { path, endOnFailure: true }),
      })
      if (!failure.failed) return
      if (
        !(failure.errorInstance instanceof ResetResumeOracleViolation) ||
        originalFailure === undefined ||
        failure.counterexamplePath === null
      ) {
        throw failure.errorInstance
      }
      if (!hasSameResetResumeFailure(originalFailure, failure.errorInstance)) {
        throw new Error(
          `Shrinking changed the reset/resume law or observation checkpoint`,
        )
      }

      const replay = await fc.check(
        fc.asyncProperty(historyArbitrary, async (history) => {
          await observeResetResumeHistory(history, harnessFactory)
        }),
        {
          seed: failure.seed,
          path: failure.counterexamplePath,
          endOnFailure: true,
        },
      )
      if (
        !replay.failed ||
        !(replay.errorInstance instanceof ResetResumeOracleViolation) ||
        JSON.stringify(replay.counterexample) !==
          JSON.stringify(failure.counterexample) ||
        !hasSameResetResumeFailure(failure.errorInstance, replay.errorInstance)
      ) {
        throw new Error(
          `Reset/resume oracle replay did not reproduce the intended violation`,
        )
      }

      const reducedFailure = failure.errorInstance
      throw new Error(
        `Reset/resume baseline-lineage violation. ` +
          `seed=${failure.seed} path=${failure.counterexamplePath} ` +
          `law=${reducedFailure.law} ` +
          `discriminant=${reducedFailure.discriminant} ` +
          `checkpoint=${reducedFailure.observation.checkpoint} ` +
          `originalTrace=${JSON.stringify(originalFailure.history)} ` +
          `reducedTrace=${JSON.stringify(reducedFailure.history)} ` +
          `expected=${JSON.stringify(reducedFailure.expected)} ` +
          `actual=${JSON.stringify(reducedFailure.actual)} ` +
          `observation=${JSON.stringify(reducedFailure.observation)} ` +
          `replay=verified ` +
          `cleanup=${reducedFailure.cleanupEvidence}`,
        { cause: reducedFailure },
      )
    }, 120_000)

    it(`leaves externally inconsistent metadata reachable for consumer validation`, async () => {
      const observation = await observeResetResumeHistory(
        {
          fromSchemaVersion: 1,
          rows: [
            {
              id: `1`,
              title: `lost externally`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 1,
            },
            {
              id: `2`,
              title: `survives`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 2,
            },
          ],
          resumeKind: `resume`,
          transition: `external-row-loss`,
          reopensBeforeTransition: 1,
          reopensAfterTransition: 1,
          unrelatedMetadataKeys: [`provider`],
        },
        harnessFactory,
      )

      expect(observation.metadataKeys).toEqual([
        `electric:resume`,
        `oracle:provider`,
      ])
      expect(resumeKindOf(observation.resumeState)).toBe(`resume`)
    }, 30_000)

    it(`requires complete metadata reset while preserving non-reset metadata`, () => {
      const compatibleEmpty: ResetResumeHistory = {
        fromSchemaVersion: 1,
        rows: [],
        resumeKind: `resume`,
        transition: `compatible-reopen`,
        reopensBeforeTransition: 0,
        reopensAfterTransition: 1,
        unrelatedMetadataKeys: [`provider`],
      }
      const observation: ResetResumeObservation = {
        checkpoint: `after-persistence-transition-restart`,
        resetEpoch: 0,
        schemaVersion: 1,
        durableRows: [],
        tombstones: [],
        appliedTransactions: [],
        latestRowVersion: 1,
        metadataKeys: [`electric:resume`, `oracle:provider`],
        resumeState: { kind: `resume`, offset: `10_0` },
      }
      expect(() =>
        expectResetResumeLaw(compatibleEmpty, observation),
      ).not.toThrow()
      expect(() =>
        expectResetResumeLaw(
          { ...compatibleEmpty, transition: `external-row-loss` },
          observation,
        ),
      ).not.toThrow()
      expect(() =>
        expectResetResumeLaw(
          { ...compatibleEmpty, transition: `schema-reset` },
          { ...observation, resetEpoch: 1, schemaVersion: 2 },
        ),
      ).toThrowError(expect.objectContaining({ name: `AssertionError` }))
      expect(() =>
        expectResetResumeLaw(
          { ...compatibleEmpty, transition: `schema-reset` },
          {
            ...observation,
            resetEpoch: 1,
            schemaVersion: 2,
            metadataKeys: [`oracle:provider`],
            resumeState: undefined,
          },
        ),
      ).toThrowError(expect.objectContaining({ name: `AssertionError` }))
      expect(() =>
        expectResetResumeLaw(
          { ...compatibleEmpty, transition: `schema-reset` },
          {
            ...observation,
            resetEpoch: 1,
            schemaVersion: 2,
            metadataKeys: [],
            resumeState: undefined,
          },
        ),
      ).not.toThrow()
    })

    it(`returns pullSince deltas and requiresFullReload when threshold is exceeded`, async () => {
      const { adapter } = registerContractHarness({
        pullSinceReloadThreshold: 1,
      })
      const collectionId = `todos`

      await adapter.applyCommittedTx(collectionId, {
        txId: `seed-pull`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              title: `One`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 1,
            },
          },
          {
            type: `insert`,
            key: `2`,
            value: {
              id: `2`,
              title: `Two`,
              createdAt: `2026-01-02T00:00:00.000Z`,
              score: 2,
            },
          },
        ],
      })
      await adapter.applyCommittedTx(collectionId, {
        txId: `seed-pull-2`,
        term: 1,
        seq: 2,
        rowVersion: 2,
        mutations: [
          {
            type: `delete`,
            key: `1`,
            value: {
              id: `1`,
              title: `One`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 1,
            },
          },
        ],
      })

      const delta = await adapter.pullSince(collectionId, 1)
      if (delta.requiresFullReload) {
        throw new Error(`Expected key-level delta, received full reload`)
      }
      expect(delta.changedKeys).toEqual([])
      expect(delta.deletedKeys).toEqual([`1`])
      expect(delta.deltas).toEqual([
        {
          txId: `seed-pull-2`,
          latestRowVersion: 2,
          changedRows: [],
          deletedKeys: [`1`],
          rowMetadataMutations: [],
          collectionMetadataMutations: [],
        },
      ])

      const fullReload = await adapter.pullSince(collectionId, 0)
      expect(fullReload.requiresFullReload).toBe(true)
    })

    it(`scans persisted rows with metadata and replays metadata-only deltas`, async () => {
      const { adapter } = registerContractHarness()
      const collectionId = `scan-and-replay`

      await adapter.applyCommittedTx(collectionId, {
        txId: `scan-seed-1`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              title: `Tracked`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 1,
            },
            metadata: {
              queryCollection: {
                owners: {
                  q1: true,
                },
              },
            },
            metadataChanged: true,
          },
        ],
      })

      const scannedRows = await adapter.scanRows?.(collectionId, {
        metadataOnly: true,
      })
      expect(scannedRows).toEqual([
        {
          key: `1`,
          value: {
            id: `1`,
            title: `Tracked`,
            createdAt: `2026-01-01T00:00:00.000Z`,
            score: 1,
          },
          metadata: {
            queryCollection: {
              owners: {
                q1: true,
              },
            },
          },
        },
      ])

      await adapter.applyCommittedTx(collectionId, {
        txId: `scan-seed-2`,
        term: 1,
        seq: 2,
        rowVersion: 2,
        mutations: [],
        rowMetadataMutations: [
          {
            type: `set`,
            key: `1`,
            value: {
              queryCollection: {
                owners: {
                  q2: true,
                },
              },
            },
          },
        ],
        collectionMetadataMutations: [
          {
            type: `set`,
            key: `electric:resume`,
            value: {
              kind: `reset`,
              updatedAt: 2,
            },
          },
        ],
      })

      const replayDelta = await adapter.pullSince(collectionId, 1)
      if (replayDelta.requiresFullReload) {
        throw new Error(`Expected replay delta, received full reload`)
      }

      expect(replayDelta.deltas).toEqual([
        {
          txId: `scan-seed-2`,
          latestRowVersion: 2,
          changedRows: [],
          deletedKeys: [],
          rowMetadataMutations: [
            {
              type: `set`,
              key: `1`,
              value: {
                queryCollection: {
                  owners: {
                    q2: true,
                  },
                },
              },
            },
          ],
          collectionMetadataMutations: [
            {
              type: `set`,
              key: `electric:resume`,
              value: {
                kind: `reset`,
                updatedAt: 2,
              },
            },
          ],
        },
      ])
    })

    it(`keeps numeric and string keys distinct in storage`, async () => {
      const { driver } = registerContractHarness()
      const adapter = new SQLiteCorePersistenceAdapter({
        driver,
      })
      const collectionId = `mixed-keys`

      await adapter.applyCommittedTx(collectionId, {
        txId: `mixed-1`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: 1,
            value: {
              id: 1,
              title: `Numeric`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 1,
            },
          },
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              title: `String`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 2,
            },
          },
        ],
      })

      const rows = await adapter.loadSubset(collectionId, {})
      expect(rows).toHaveLength(2)
      expect(rows.some((row) => row.key === 1)).toBe(true)
      expect(rows.some((row) => row.key === `1`)).toBe(true)
    })

    it(`stores hostile collection ids safely via deterministic table mapping`, async () => {
      const { adapter, driver } = registerContractHarness()
      const hostileCollectionId = `todos"; DROP TABLE applied_tx; --`

      await adapter.applyCommittedTx(hostileCollectionId, {
        txId: `hostile-1`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `safe`,
            value: {
              id: `safe`,
              title: `Safe`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 1,
            },
          },
        ],
      })

      const registryRows = await driver.query<{ table_name: string }>(
        `SELECT table_name
       FROM collection_registry
       WHERE collection_id = ?`,
        [hostileCollectionId],
      )
      expect(registryRows).toHaveLength(1)
      expect(registryRows[0]?.table_name).toMatch(/^c_[a-z2-7]+_[0-9a-z]+$/)

      const loadedRows = await adapter.loadSubset(hostileCollectionId, {})
      expect(loadedRows).toHaveLength(1)
      expect(loadedRows[0]?.key).toBe(`safe`)
    })

    it(`deduplicates concurrent ensureCollectionReady calls for the same collection`, async () => {
      const { adapter } = registerContractHarness()
      const collectionId = `concurrent-startup`

      const [rowsA, rowsB] = await Promise.all([
        adapter.loadSubset(collectionId, {}),
        adapter.loadSubset(collectionId, {}),
      ])

      expect(rowsA).toEqual([])
      expect(rowsB).toEqual([])

      await adapter.applyCommittedTx(collectionId, {
        txId: `concurrent-startup-seed`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              title: `Seeded`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 1,
            },
          },
        ],
      })

      const loadedRows = await adapter.loadSubset(collectionId, {})
      expect(loadedRows).toHaveLength(1)
      expect(loadedRows[0]?.key).toBe(`1`)
    })

    it(`prunes applied_tx rows by sequence threshold`, async () => {
      const { adapter, driver } = registerContractHarness({
        appliedTxPruneMaxRows: 2,
      })
      const collectionId = `pruning`

      for (let seq = 1; seq <= 4; seq++) {
        await adapter.applyCommittedTx(collectionId, {
          txId: `prune-${seq}`,
          term: 1,
          seq,
          rowVersion: seq,
          mutations: [
            {
              type: `insert`,
              key: `k-${seq}`,
              value: {
                id: `k-${seq}`,
                title: `Row ${seq}`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: seq,
              },
            },
          ],
        })
      }

      const appliedRows = await driver.query<{ seq: number }>(
        `SELECT seq
       FROM applied_tx
       WHERE collection_id = ?
       ORDER BY seq ASC`,
        [collectionId],
      )
      expect(appliedRows.map((row) => row.seq)).toEqual([3, 4])
    })

    it(`prunes applied_tx rows by age threshold when configured`, async () => {
      const { adapter, driver } = registerContractHarness({
        appliedTxPruneMaxAgeSeconds: 1,
      })
      const collectionId = `pruning-by-age`

      await adapter.applyCommittedTx(collectionId, {
        txId: `age-1`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `old`,
            value: {
              id: `old`,
              title: `Old`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 1,
            },
          },
        ],
      })

      await driver.run(
        `UPDATE applied_tx
       SET applied_at = 0
       WHERE collection_id = ? AND seq = 1`,
        [collectionId],
      )

      await adapter.applyCommittedTx(collectionId, {
        txId: `age-2`,
        term: 1,
        seq: 2,
        rowVersion: 2,
        mutations: [
          {
            type: `insert`,
            key: `new`,
            value: {
              id: `new`,
              title: `New`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 2,
            },
          },
        ],
      })

      const appliedRows = await driver.query<{ seq: number }>(
        `SELECT seq
       FROM applied_tx
       WHERE collection_id = ?
       ORDER BY seq ASC`,
        [collectionId],
      )
      expect(appliedRows.map((row) => row.seq)).toEqual([2])
    })

    it(`supports large IN lists via batching`, async () => {
      const { adapter } = registerContractHarness()
      const collectionId = `large-in`

      await adapter.applyCommittedTx(collectionId, {
        txId: `seed-large-in`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `2`,
            value: {
              id: `2`,
              title: `Two`,
              createdAt: `2026-01-02T00:00:00.000Z`,
              score: 2,
            },
          },
          {
            type: `insert`,
            key: `4`,
            value: {
              id: `4`,
              title: `Four`,
              createdAt: `2026-01-04T00:00:00.000Z`,
              score: 4,
            },
          },
        ],
      })

      const largeIds = Array.from(
        { length: 1200 },
        (_value, index) => `miss-${index}`,
      )
      largeIds[100] = `2`
      largeIds[1100] = `4`

      const rows = await adapter.loadSubset(collectionId, {
        where: new IR.Func(`in`, [
          new IR.PropRef([`id`]),
          new IR.Value(largeIds),
        ]),
        orderBy: [
          {
            expression: new IR.PropRef([`id`]),
            compareOptions: {
              direction: `asc`,
              nulls: `last`,
            },
          },
        ],
      })

      expect(rows.map((row) => row.key)).toEqual([`2`, `4`])
    })

    it(`falls back to in-memory filtering when SQL json path pushdown is unsupported`, async () => {
      const { driver } = registerContractHarness()
      const adapter = new SQLiteCorePersistenceAdapter({
        driver,
      })
      const collectionId = `fallback-where`

      await adapter.applyCommittedTx(collectionId, {
        txId: `seed-fallback`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              title: `Keep`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 1,
              [`meta-field`]: `alpha`,
            },
          },
          {
            type: `insert`,
            key: `2`,
            value: {
              id: `2`,
              title: `Drop`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 2,
              [`meta-field`]: `beta`,
            },
          },
        ],
      })

      const rows = await adapter.loadSubset(collectionId, {
        where: new IR.Func(`eq`, [
          new IR.PropRef([`meta-field`]),
          new IR.Value(`alpha`),
        ]),
      })

      expect(rows.map((row) => row.key)).toEqual([`1`])
    })

    it(`supports alias-qualified refs during in-memory fallback filtering`, async () => {
      const { driver } = registerContractHarness()
      const adapter = new SQLiteCorePersistenceAdapter({
        driver,
      })
      const collectionId = `fallback-alias-qualified-ref`

      await adapter.applyCommittedTx(collectionId, {
        txId: `seed-alias-fallback`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              title: `Keep`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 1,
              [`meta-field`]: `alpha`,
            },
          },
          {
            type: `insert`,
            key: `2`,
            value: {
              id: `2`,
              title: `Drop`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 2,
              [`meta-field`]: `beta`,
            },
          },
        ],
      })

      // `meta-field` makes SQL pushdown unsupported, so filter correctness comes
      // from the in-memory evaluator. The explicit source alias is the only
      // signal that the leading `todos` segment is qualification.
      const rows = await adapter.loadSubset(collectionId, {
        where: new IR.Func(`eq`, [
          new IR.PropRef([`todos`, `meta-field`], `todos`),
          new IR.Value(`alpha`),
        ]),
      })

      expect(rows.map((row) => row.key)).toEqual([`1`])
    })

    it(`does not guess that a legacy fallback path is an alias`, async () => {
      const { driver } = registerContractHarness()
      const adapter = new SQLiteCorePersistenceAdapter({ driver })
      const collectionId = `fallback-legacy-nested-ref`

      await adapter.applyCommittedTx(collectionId, {
        txId: `seed-legacy-nested-fallback`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `nested-match`,
            value: {
              profile: { [`meta-field`]: `alpha` },
              [`meta-field`]: `flat-other`,
            },
          },
          {
            type: `insert`,
            key: `flat-only`,
            value: { [`meta-field`]: `alpha` },
          },
        ],
      })

      const rows = await adapter.loadSubset(collectionId, {
        where: new IR.Func(`eq`, [
          new IR.PropRef([`profile`, `meta-field`]),
          new IR.Value(`alpha`),
        ]),
      })

      expect(rows.map((row) => row.key)).toEqual([`nested-match`])
    })

    it(`compiles serialized expression index specs used by phase-2 metadata`, async () => {
      const { adapter, driver } = registerContractHarness()
      const collectionId = `serialized-index`
      const signature = `serialized-title`

      await adapter.ensureIndex(collectionId, signature, {
        expressionSql: [
          JSON.stringify({
            type: `ref`,
            path: [`title`],
          }),
        ],
      })

      const registryRows = await driver.query<{ index_name: string }>(
        `SELECT index_name
       FROM persisted_index_registry
       WHERE collection_id = ? AND signature = ?`,
        [collectionId, signature],
      )
      const indexName = registryRows[0]?.index_name
      expect(indexName).toBeTruthy()

      const sqliteMasterRows = await driver.query<{ sql: string }>(
        `SELECT sql
       FROM sqlite_master
       WHERE type = 'index' AND name = ?`,
        [indexName],
      )
      expect(sqliteMasterRows).toHaveLength(1)
      expect(sqliteMasterRows[0]?.sql).toContain(
        `json_extract(value, '$.title')`,
      )
    })

    it(`rejects unsafe raw SQL fragments in index specs`, async () => {
      const { adapter } = registerContractHarness()

      await expect(
        adapter.ensureIndex(`unsafe-index`, `unsafe`, {
          expressionSql: [
            `json_extract(value, '$.title'); DROP TABLE applied_tx`,
          ],
        }),
      ).rejects.toThrow(/Invalid persisted index SQL fragment/)
    })
  })
}

import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { DatabaseSync } from 'node:sqlite'
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspect, promisify } from 'node:util'
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
  checkpoint: `after-persistence-transition-reopen`
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
    let reopened = new SQLiteCorePersistenceAdapter({
      driver: harness.driver,
      schemaVersion: nextSchemaVersion,
      schemaMismatchPolicy: `sync-present-reset`,
    })
    await reopened.loadSubset(collectionId, {})

    if (history.transition === `partial-restore`) {
      await reopened.applyCommittedTx(collectionId, {
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
      reopened = new SQLiteCorePersistenceAdapter({
        driver: harness.driver,
        schemaVersion: nextSchemaVersion,
        schemaMismatchPolicy: `sync-present-reset`,
      })
      await reopened.loadSubset(collectionId, {})
    }

    const metadata = await reopened.loadCollectionMetadata(collectionId)
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
      checkpoint: `after-persistence-transition-reopen`,
      resetEpoch: resetEpochRows[0]?.reset_epoch ?? -1,
      schemaVersion: registryRows[0]?.schema_version ?? -1,
      durableRows: (await reopened.loadSubset(collectionId, {})).sort((a, b) =>
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

    // At loadSubset completion, persisted fallback ordering must use the exact
    // custom comparator, then direction and public-key tie order. A lexical
    // fallback fails every cell below.
    it.each([
      {
        case: `ascending`,
        direction: `asc` as const,
        compare: (left: string, right: string) => right.localeCompare(left),
        expected: [`zeta`, `middle`, `alpha`],
      },
      {
        case: `descending`,
        direction: `desc` as const,
        compare: (left: string, right: string) => right.localeCompare(left),
        expected: [`alpha`, `middle`, `zeta`],
      },
      {
        case: `comparator-equal key order`,
        direction: `asc` as const,
        compare: () => 0,
        expected: [`zeta`, `alpha`, `middle`],
      },
    ])(
      `applies custom string collation during persisted subset ordering ($case)`,
      async ({ case: caseName, direction, compare, expected }) => {
        const { adapter } = registerContractHarness()
        const collectionId = `custom-collation-order-${caseName}`

        await adapter.applyCommittedTx(collectionId, {
          txId: `seed-custom-collation`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [`zeta`, `alpha`, `middle`].map((title, index) => ({
            type: `insert` as const,
            key: String(index),
            value: { id: String(index), title, createdAt: ``, score: index },
          })),
        })

        const rows = await adapter.loadSubset(collectionId, {
          orderBy: [
            {
              expression: new IR.PropRef([`title`]),
              compareOptions: {
                direction,
                nulls: `last`,
                stringSort: `custom`,
                compare,
              },
            },
          ],
        })

        expect(rows.map(({ value }) => value.title)).toEqual(expected)
      },
    )

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
     * transaction. Same-schema adapter reopens preserve metadata, including
     * for a genuinely empty baseline. The production reset policy above and the
     * independently reproduced history in
     * https://github.com/TanStack/db/issues/1589 establish this narrow law.
     *
     * Domain and legal histories: zero-to-four committed rows; absent, reset,
     * or non-initial resume metadata; same-schema adapter reopen, vN -> vN+1
     * sync-present-reset, a partial restore after reset, or out-of-band row
     * loss; adapter reopens on either side; unrelated metadata.
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
     * after-persistence-transition-reopen checkpoint we inspect registry
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
    it(`resets collection metadata with its persisted baseline across generated adapter reopen histories`, async () => {
      const historyArbitrary = fc
        .constantFrom<ResetResumeHistory[`transition`]>(
          `compatible-reopen`,
          `schema-reset`,
          `partial-restore`,
          `external-row-loss`,
        )
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
        checkpoint: `after-persistence-transition-reopen`,
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

    it(`supports large IN lists within the driver's binding cap`, async () => {
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

/**
 * # Can a SQLite subset predicate exceed the connection's binding capacity?
 *
 * Contract: `SQLiteCorePersistenceAdapter.loadSubset` accepts supported `IN`,
 * `and`, `or`, and scalar predicates. The core owner's 1,200-value case at
 * `packages/db-sqlite-persistence-core/tests/sqlite-core-adapter.test.ts:2459`
 * promises large-list support. Issue #1993 requests a total statement bound.
 * On a connection with a declared variable limit, a valid request must return
 * exactly its matching persisted rows without asking SQLite to prepare a
 * statement above that limit, even if its transaction driver omits the limit.
 *
 * Scope: finite primitive values; one or two list predicates, including an
 * empty list, and up to one scalar equality; a fixed 100/101-scalar conjunction;
 * two or three persisted rows; one cursor route. Null, nonfinite,
 * container values, unsupported expressions, and concurrency remain outside.
 * Index DDL has a separate literal-expression context. This Node `node:sqlite`
 * witness does not prove browser, mobile, or Tauri execution, multi-process WAL,
 * or host-specific availability of JSON functions.
 *
 * Model: compute each row's result directly from the declared `and`/`or` clauses
 * using typed equality. The model does not read SQL, compiler fragments, or
 * SQLite results. A `specification case` below is model-only input data; each
 * clause maps to one IR predicate in the production driver.
 *
 * History grammar: seed three rows, choose one/two list clauses and optionally
 * one scalar clause, choose string/number/boolean/date/bigint values, choose
 * list lengths near 999 and above it, then call `loadSubset` once. Fixed cases
 * reconstruct reported one-large, two-small, and two-large forms. Generated
 * cases vary list counts, lengths, connective, and type. Nulls,
 * >signed-64-bit bigint, unsupported fields, and index DDL with runtime
 * bindings are outside the domain. A scalar clause without one value is an
 * invalid model input. Removing any list-count or length axis loses one of
 * the three capacity forms. Kind and connective challenge value preservation.
 * The 998/999/1000 margins distinguish a misplaced cap; 499+500 versus
 * 500+500 distinguishes statement-wide counting. A distinct transaction
 * driver without a cap crosses a 100/101-variable host boundary.
 *
 * Production driver: use the real core adapter with prepared SQLite statements.
 * Newer Node versions apply `variableNumber: 999` or `100` natively; older
 * versions use a driver boundary that rejects over-cap bindings before prepare.
 * Record every attempted driver statement, including a capacity failure.
 * The observation cut is `loadSubset` fulfillment/rejection, typed returned
 * values, ordered keys when requested, and attempted statement bind counts.
 *
 * Refinement: require the exact rows, reached predicate SELECTs, no
 * SQLite error, and no statement above its declared binding cap. The original 900-item
 * OR-chunk lowering is the hostile design: it reaches the intended SELECT and
 * fails the public result/binding comparison. The legacy CLI test interpolates
 * literals, so it cannot exercise this boundary.
 *
 * Replay: pass `TANSTACK_DB_SQLITE_BINDING_SEED` and
 * `TANSTACK_DB_SQLITE_BINDING_PATH` together and select this test by
 * name. The normal package test runs fixed and random campaigns.
 */
const BINDING_CAP = 999
const BINDING_FIXED_SEED = 1_993_999
const BINDING_RUNS = 12
type Kind = 'string' | 'number' | 'boolean' | 'date' | 'bigint'
type Scalar = string | number | boolean | Date | bigint
type Clause = {
  field: 'a' | 'b'
  kind: 'in' | 'eq'
  values: ReadonlyArray<Scalar>
}
type Spec = {
  label: string
  valueKind: Kind
  connective: 'and' | 'or'
  clauses: ReadonlyArray<Clause>
  nested?: boolean
  ordered?: boolean
  rows?: ReadonlyArray<Row>
}
type Row = { key: string; value: { a: Scalar; b: Scalar } }
type Attempt = {
  method: 'exec' | 'query' | 'run'
  sql: string
  bindings: number
  error?: string
}

function target(kind: Kind): Scalar {
  switch (kind) {
    case 'string':
      return 'target'
    case 'number':
      return 123_456
    case 'boolean':
      return true
    case 'date':
      return new Date('2026-01-01T00:00:00.000Z')
    case 'bigint':
      return 9_007_199_254_740_993n
  }
}
function miss(kind: Kind, ordinal: number): Scalar {
  switch (kind) {
    case 'string':
      return `miss-${ordinal}`
    case 'number':
      return ordinal
    case 'boolean':
      return false
    case 'date':
      return new Date(Date.UTC(2020, 0, 1 + ordinal))
    case 'bigint':
      return 9_007_199_254_751_000n + BigInt(ordinal)
  }
}
function values(kind: Kind, length: number): Array<Scalar> {
  const result = Array.from({ length }, (_, index) => miss(kind, index))
  if (length) result[Math.floor(length / 2)] = target(kind)
  return result
}
function same(left: Scalar, right: Scalar): boolean {
  return left instanceof Date && right instanceof Date
    ? left.getTime() === right.getTime()
    : left === right
}
function expectedBindingRows(
  spec: Spec,
  rows: ReadonlyArray<Row>,
): Array<string> {
  return rows
    .filter((row) => {
      const decisions = spec.clauses.map((clause) => {
        const field = row.value[clause.field]
        return clause.kind === 'eq'
          ? same(field, clause.values[0]!)
          : clause.values.some((candidate) => same(field, candidate))
      })
      if (spec.nested) return (decisions[0] || decisions[1]) && decisions[2]
      return spec.connective === 'and'
        ? decisions.every(Boolean)
        : decisions.some(Boolean)
    })
    .sort((a, b) =>
      spec.ordered
        ? String(a.value.a).localeCompare(String(b.value.a))
        : a.key.localeCompare(b.key),
    )
    .map((row) => row.key)
}
function predicate(spec: Spec): IR.BasicExpression<boolean> {
  const clauses = spec.clauses.map(
    (clause) =>
      new IR.Func(clause.kind, [
        new IR.PropRef([clause.field]),
        new IR.Value(
          clause.kind === 'eq' ? clause.values[0] : [...clause.values],
        ),
      ]),
  )
  if (spec.nested)
    return new IR.Func('and', [
      new IR.Func('or', [clauses[0]!, clauses[1]!]),
      clauses[2]!,
    ])
  return clauses.length === 1
    ? clauses[0]!
    : new IR.Func(spec.connective, clauses)
}

function preparedDriver(
  db: DatabaseSync,
  attempts: Array<Attempt>,
  withDriver = false,
  cap = BINDING_CAP,
  omitTransactionCap = false,
  forceControlledCap = false,
) {
  let record = false
  let nextSavepoint = 0
  const nativeCap = (
    db as DatabaseSync & { limits?: { variableNumber: number } }
  ).limits?.variableNumber
  const controlledCap = forceControlledCap || nativeCap === undefined
  function checkCapacity(bindings: number): void {
    if (controlledCap && bindings > cap)
      throw new RangeError(`host parameter limit exceeded: ${bindings} > ${cap}`)
  }
  const driver: SQLiteDriver & { startObservation: () => void } = {
    maxBoundParameters: cap,
    startObservation() {
      record = true
    },
    exec(sql: string): Promise<void> {
      const attempt: Attempt = { method: 'exec', sql, bindings: 0 }
      if (record) attempts.push(attempt)
      try {
        db.exec(sql)
        return Promise.resolve()
      } catch (error) {
        attempt.error = String(error)
        return Promise.reject(error)
      }
    },
    query<T>(
      sql: string,
      params: ReadonlyArray<unknown> = [],
    ): Promise<ReadonlyArray<T>> {
      const attempt: Attempt = { method: 'query', sql, bindings: params.length }
      if (record) attempts.push(attempt)
      try {
        checkCapacity(params.length)
        return Promise.resolve(
          db
            .prepare(sql)
            .all(
              ...(params as Array<null | number | bigint | string>),
            ) as Array<T>,
        )
      } catch (error) {
        attempt.error = String(error)
        return Promise.reject(error)
      }
    },
    run(sql: string, params: ReadonlyArray<unknown> = []): Promise<void> {
      const attempt: Attempt = { method: 'run', sql, bindings: params.length }
      if (record) attempts.push(attempt)
      try {
        checkCapacity(params.length)
        db.prepare(sql).run(
          ...(params as Array<null | number | bigint | string>),
        )
        return Promise.resolve()
      } catch (error) {
        attempt.error = String(error)
        return Promise.reject(error)
      }
    },
    async transaction<T>(
      fn: (transactionDriver: SQLiteDriver) => Promise<T>,
    ): Promise<T> {
      const savepoint = `oracle_${++nextSavepoint}`
      db.exec(`SAVEPOINT ${savepoint}`)
      try {
        const result = await fn(driver)
        db.exec(`RELEASE ${savepoint}`)
        return result
      } catch (error) {
        db.exec(`ROLLBACK TO ${savepoint}`)
        db.exec(`RELEASE ${savepoint}`)
        throw error
      }
    },
  }
  if (withDriver) {
    driver.transactionWithDriver = omitTransactionCap
      ? (fn) =>
          driver.transaction(() =>
            fn({
              exec: driver.exec,
              query: driver.query,
              run: driver.run,
              transaction: driver.transaction,
            }),
          )
      : driver.transaction
  }
  return driver
}

function limitedDatabase(cap = BINDING_CAP): DatabaseSync {
  // Older Node versions ignore this option; preparedDriver then enforces the cap.
  const options = { limits: { variableNumber: cap } }
  const db = new DatabaseSync(
    ':memory:',
    options as unknown as NonNullable<
      ConstructorParameters<typeof DatabaseSync>[1]
    >,
  )
  const nativeCap = (
    db as DatabaseSync & { limits?: { variableNumber: number } }
  ).limits?.variableNumber
  if (nativeCap !== undefined)
    assert.equal(nativeCap, cap, 'SQLite did not apply the requested variable limit')
  return db
}

type Observation = {
  expected: Array<string>
  expectedValues: Array<{ key: string; value: Row['value'] }>
  actual?: Array<string>
  actualValues?: Array<{ key: string; value: Row['value'] }>
  attempts: Array<Attempt>
  error?: string
  cleanupError?: string
}
async function observe(
  spec: Spec,
  withDriver = false,
  cap = BINDING_CAP,
  omitTransactionCap = false,
): Promise<Observation> {
  const db = limitedDatabase(cap)
  const attempts: Array<Attempt> = []
  let observation: Observation | undefined
  try {
    const driver = preparedDriver(
      db,
      attempts,
      withDriver,
      cap,
      omitTransactionCap,
    )
    const adapter = new SQLiteCorePersistenceAdapter({ driver })
    const rows: Array<Row> = spec.rows
      ? [...spec.rows]
      : [
          {
            key: 'target',
            value: { a: target(spec.valueKind), b: target(spec.valueKind) },
          },
          {
            key: 'partial',
            value: {
              a: target(spec.valueKind),
              b: miss(spec.valueKind, 10_000),
            },
          },
          {
            key: 'miss',
            value: {
              a: miss(spec.valueKind, 10_001),
              b: miss(spec.valueKind, 10_002),
            },
          },
        ]
    const expected = expectedBindingRows(spec, rows)
    const expectedValues = expected.map((key) => {
      const row = rows.find((candidate) => candidate.key === key)!
      return { key, value: row.value }
    })
    await adapter.applyCommittedTx('oracle-1993', {
      txId: 'seed',
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: rows.map((row) => ({
        type: 'insert' as const,
        key: row.key,
        value: row.value,
      })),
    })
    driver.startObservation()
    try {
      const result = await adapter.loadSubset('oracle-1993', {
        where: predicate(spec),
        ...(spec.ordered
          ? {
              orderBy: [
                {
                  expression: new IR.PropRef(['a']),
                  compareOptions: {
                    direction: 'asc' as const,
                    nulls: 'last' as const,
                  },
                },
              ],
            }
          : {}),
      })
      const actualValues = result.map((row) => ({
        key: String(row.key),
        value: row.value as Row['value'],
      }))
      if (!spec.ordered) actualValues.sort((a, b) => a.key.localeCompare(b.key))
      observation = {
        expected,
        expectedValues,
        actual: actualValues.map((row) => row.key),
        actualValues,
        attempts,
      }
    } catch (error) {
      observation = { expected, expectedValues, attempts, error: String(error) }
    }
  } finally {
    try {
      db.close()
    } catch (cleanupError) {
      observation ??= {
        expected: [],
        expectedValues: [],
        attempts,
        error: 'setup failed',
      }
      observation.cleanupError = String(cleanupError)
    }
  }
  return observation
}

type Violation = {
  kind: 'reach' | 'capacity' | 'error' | 'rows' | 'cleanup'
  checkpoint: string
  message: string
}
function violation(
  spec: Spec,
  observation: Observation,
  cap = BINDING_CAP,
): Violation | undefined {
  const predicateSelects = observation.attempts.filter(
    (entry) =>
      entry.method === 'query' &&
      entry.sql.startsWith('SELECT key, value, metadata, row_version'),
  )
  if (predicateSelects.length !== 1)
    return {
      kind: 'reach',
      checkpoint: 'driver-query',
      message: `predicate SELECT reach=${predicateSelects.length}`,
    }
  const over = observation.attempts.filter((entry) => entry.bindings > cap)
  if (over.length)
    return {
      kind: 'capacity',
      checkpoint: over.some((entry) => predicateSelects.includes(entry))
        ? 'predicate-select'
        : 'other-statement',
      message: `binding cap exceeded: ${over.map((entry) => entry.bindings)}; error=${observation.error ?? 'none'}`,
    }
  if (observation.error)
    return {
      kind: 'error',
      checkpoint: 'loadSubset-settlement',
      message: `loadSubset rejected ${observation.error}`,
    }
  try {
    assert.deepEqual(observation.actual, observation.expected)
    assert.deepEqual(observation.actualValues, observation.expectedValues)
  } catch {
    return {
      kind: 'rows',
      checkpoint: 'loadSubset-fulfillment',
      message: `rows ${inspect(observation.actualValues)} != ${inspect(observation.expectedValues)}`,
    }
  }
  if (observation.cleanupError)
    return {
      kind: 'cleanup',
      checkpoint: 'cleanup',
      message: `cleanup failed: ${observation.cleanupError}`,
    }
  return undefined
}

function single(kind: Kind, count: number): Spec {
  return {
    label: `single-${kind}-${count}`,
    valueKind: kind,
    connective: 'or',
    clauses: [{ field: 'a', kind: 'in', values: values(kind, count) }],
  }
}
function dual(
  kind: Kind,
  a: number,
  b: number,
  connective: 'and' | 'or',
): Spec {
  return {
    label: `dual-${kind}-${a}-${b}-${connective}`,
    valueKind: kind,
    connective,
    clauses: [
      { field: 'a', kind: 'in', values: values(kind, a) },
      { field: 'b', kind: 'in', values: values(kind, b) },
    ],
  }
}
function mixed(kind: Kind, count: number): Spec {
  return {
    label: `mixed-${kind}-${count}+1`,
    valueKind: kind,
    connective: 'and',
    clauses: [
      { field: 'a', kind: 'in', values: values(kind, count) },
      { field: 'b', kind: 'eq', values: [target(kind)] },
    ],
  }
}
function nested(kind: Kind, a: number, b: number): Spec {
  return {
    label: `nested-${kind}-${a}-${b}+1`,
    valueKind: kind,
    connective: 'and',
    nested: true,
    clauses: [
      { field: 'a', kind: 'in', values: values(kind, a) },
      { field: 'b', kind: 'in', values: values(kind, b) },
      { field: 'b', kind: 'eq', values: [target(kind)] },
    ],
  }
}
function chunkBoundary(): Spec {
  const list = Array.from({ length: 1200 }, (_, i) => `miss-${i}`)
  list[100] = 'early'
  list[1100] = 'late'
  return {
    label: 'two-hits-across-900',
    valueKind: 'string',
    connective: 'or',
    ordered: true,
    clauses: [{ field: 'a', kind: 'in', values: list }],
    rows: [
      { key: 'late', value: { a: 'late', b: 'none' } },
      { key: 'miss', value: { a: 'other', b: 'none' } },
      { key: 'early', value: { a: 'early', b: 'none' } },
    ],
  }
}
function escapedStringCase(): Spec {
  const escaped = `quote' newline\n snowman☃ null\u0000`
  return {
    label: `escaped-string-list`,
    valueKind: `string`,
    connective: `or`,
    clauses: [{ field: `a`, kind: `in`, values: [escaped, `different`] }],
    rows: [
      { key: `target`, value: { a: escaped, b: `other` } },
      { key: `miss`, value: { a: `another`, b: `other` } },
    ],
  }
}
function bigintBoundary(value: bigint, label: string): Spec {
  return {
    label,
    valueKind: 'bigint',
    connective: 'or',
    clauses: [{ field: 'a', kind: 'in', values: [value] }],
    rows: [
      { key: 'target', value: { a: value, b: value } },
      { key: 'miss', value: { a: 0n, b: 0n } },
    ],
  }
}
function legalSpec(spec: Spec): boolean {
  return (
    spec.clauses.length >= 1 &&
    spec.clauses.length <= 3 &&
    (!spec.nested || spec.clauses.length === 3) &&
    spec.clauses.every(
      (clause) => clause.kind === 'in' || clause.values.length === 1,
    )
  )
}

const fixed: Array<Spec> = [
  single('string', 0),
  single('string', 998),
  single('string', 999),
  single('string', 1000),
  single('string', 1200),
  chunkBoundary(),
  escapedStringCase(),
  dual('string', 499, 500, 'or'),
  dual('string', 500, 500, 'or'),
  dual('string', 600, 600, 'and'),
  dual('string', 1000, 1000, 'or'),
  mixed('string', 998),
  mixed('string', 999),
  nested('string', 500, 500),
  single('number', 2),
  single('boolean', 2),
  single('date', 2),
  single('bigint', 2),
  bigintBoundary(-9_223_372_036_854_775_808n, 'bigint-signed-min'),
  bigintBoundary(9_223_372_036_854_775_807n, 'bigint-signed-max'),
  single('bigint', 1000),
]
assert.ok(fixed.every(legalSpec))
assert.equal(
  legalSpec({
    label: 'invalid-empty-eq',
    valueKind: 'string',
    connective: 'and',
    clauses: [{ field: 'a', kind: 'eq', values: [] }],
  }),
  false,
)

const kindArbitrary = fc.constantFrom<Kind>(
  'string',
  'number',
  'boolean',
  'date',
  'bigint',
)
const lengthArbitrary = fc.constantFrom(
  498,
  499,
  500,
  600,
  998,
  999,
  1000,
  1200,
)
const secondLengthArbitrary = fc.constantFrom(499, 500, 600, 1000)
const generated = fc.oneof(
  fc
    .tuple(kindArbitrary, lengthArbitrary)
    .map(([kind, length]) => single(kind, length)),
  fc
    .tuple(
      kindArbitrary,
      lengthArbitrary,
      secondLengthArbitrary,
      fc.constantFrom<'and' | 'or'>('and', 'or'),
    )
    .map(([kind, a, b, connective]) => dual(kind, a, b, connective)),
  fc
    .tuple(kindArbitrary, lengthArbitrary)
    .map(([kind, length]) => mixed(kind, length)),
  fc
    .tuple(kindArbitrary, lengthArbitrary, secondLengthArbitrary)
    .map(([kind, a, b]) => nested(kind, a, b)),
)

async function runIndexContext() {
  const db = limitedDatabase()
  const attempts: Array<Attempt> = []
  try {
    const driver = preparedDriver(db, attempts)
    const adapter = new SQLiteCorePersistenceAdapter({ driver })
    await adapter.applyCommittedTx('oracle-index', {
      txId: 'seed',
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [
        { type: 'insert', key: 'target', value: { a: 'target', b: 'target' } },
      ],
    })
    driver.startObservation()
    await adapter.ensureIndex('oracle-index', 'small-in-partial', {
      expressionSql: [JSON.stringify({ type: 'ref', path: ['a'] })],
      whereSql: JSON.stringify({
        type: 'func',
        name: 'in',
        args: [
          { type: 'ref', path: ['b'] },
          { type: 'val', value: ['target', 'other'] },
        ],
      }),
    })
    await adapter.ensureIndex('oracle-index', 'small-in-expression', {
      expressionSql: [
        JSON.stringify({
          type: 'func',
          name: 'in',
          args: [
            { type: 'ref', path: ['a'] },
            { type: 'val', value: ['target', 'other'] },
          ],
        }),
      ],
    })
    const ddl = attempts.filter(
      (entry) => entry.method === 'exec' && entry.sql.includes('CREATE INDEX'),
    )
    assert.equal(ddl.length, 2, 'both index-definition paths reached')
    for (const entry of ddl) {
      assert.ok(
        !entry.sql.includes('json_each') && !entry.sql.includes('?'),
        'index DDL must use literal values',
      )
      assert.ok(entry.sql.includes(`'target'`) && entry.sql.includes(`'other'`))
    }
  } finally {
    db.close()
  }
}

async function runCursorContext(): Promise<string | undefined> {
  const db = limitedDatabase()
  const attempts: Array<Attempt> = []
  let error: string | undefined
  let actual: Array<string> | undefined
  try {
    const driver = preparedDriver(db, attempts, true)
    const adapter = new SQLiteCorePersistenceAdapter({ driver })
    await adapter.applyCommittedTx('oracle-cursor', {
      txId: 'seed',
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [
        { type: 'insert', key: 'target', value: { a: 'target', b: 'target' } },
      ],
    })
    driver.startObservation()
    try {
      const rows = await adapter.loadSubset('oracle-cursor', {
        where: predicate(single('string', 999)),
        cursor: {
          whereCurrent: new IR.Func('eq', [
            new IR.PropRef(['a']),
            new IR.Value('target'),
          ]),
          whereFrom: new IR.Func('eq', [
            new IR.PropRef(['b']),
            new IR.Value('target'),
          ]),
        },
      })
      actual = rows.map((row) => String(row.key))
    } catch (cause) {
      error = String(cause)
    }
  } finally {
    db.close()
  }
  const reads = attempts.filter(
    (entry) =>
      entry.method === 'query' &&
      entry.sql.startsWith('SELECT key, value, metadata, row_version'),
  )
  const counts = reads.map((entry) => entry.bindings)
  const problem =
    reads.length !== 2
      ? `expected two cursor SELECTs, got ${reads.length}`
      : counts.some((count) => count > BINDING_CAP)
        ? `two cursor SELECTs bind=${counts}; error=${error ?? 'none'}`
        : error
          ? `cursor load rejected ${error}`
          : actual?.join(',') !== 'target'
            ? `cursor rows=${actual}`
            : undefined
  return problem
}

const bindingReplaySeed = process.env.TANSTACK_DB_SQLITE_BINDING_SEED
const bindingReplayPath = process.env.TANSTACK_DB_SQLITE_BINDING_PATH
const bindingReplay =
  bindingReplaySeed !== undefined && bindingReplayPath !== undefined
if ((bindingReplaySeed === undefined) !== (bindingReplayPath === undefined)) {
  throw new Error(`Binding oracle replay requires both seed and path`)
}
if (
  bindingReplaySeed !== undefined &&
  !Number.isSafeInteger(Number(bindingReplaySeed))
) {
  throw new Error(`Binding oracle replay seed must be an integer`)
}
if (
  bindingReplayPath !== undefined &&
  !/^\d+(?::\d+)*$/.test(bindingReplayPath)
) {
  throw new Error(`Binding oracle replay path must be numeric`)
}

const bindingFixedIt = bindingReplay ? it.skip : it

export function runSQLiteBindingCapacityOracleSuite(): void {
  describe(`SQLite subset binding-capacity oracle`, () => {
    bindingFixedIt(
      `rejects over-cap bindings at the controlled driver boundary`,
      async () => {
        const db = limitedDatabase(100)
        try {
          const driver = preparedDriver(db, [], false, 100, false, true)
          const sql = `SELECT ${Array(101).fill('?').join(' + ')}`
          await expect(driver.query(sql, Array(101).fill(1))).rejects.toThrow(
            /host parameter limit exceeded: 101 > 100/,
          )
        } finally {
          db.close()
        }
      },
    )

    bindingFixedIt(
      `returns exact rows at single-list, statement-total, and typed boundaries`,
      async () => {
        const failures: Array<string> = []
        for (const spec of fixed) {
          const observation = await observe(spec)
          const problem = violation(spec, observation)
          if (problem)
            failures.push(
              `${spec.label}: ${problem.kind}@${problem.checkpoint}: ${problem.message}`,
            )
        }
        expect(failures).toEqual([])
      },
    )

    bindingFixedIt(
      `honors total capacity through transactionWithDriver`,
      async () => {
        const failures: Array<string> = []
        for (const spec of [
          single(`string`, 999),
          single(`string`, 1000),
          dual(`string`, 500, 500, `or`),
          single(`bigint`, 1000),
        ]) {
          const observation = await observe(spec, true)
          const problem = violation(spec, observation)
          if (problem)
            failures.push(
              `${spec.label}: ${problem.kind}@${problem.checkpoint}: ${problem.message}`,
            )
        }
        expect(failures).toEqual([])
      },
    )

    bindingFixedIt(
      `honors the root connection limit when a distinct transaction driver omits it`,
      async () => {
        for (const count of [100, 101]) {
          const spec: Spec = {
            label: `${count}-scalar-conjunction`,
            valueKind: `string`,
            connective: `and`,
            clauses: Array.from({ length: count }, () => ({
              field: `a`,
              kind: `eq`,
              values: [`target`],
            })),
          }
          const observation = await observe(spec, true, 100, true)
          expect(violation(spec, observation, 100)).toBeUndefined()
          const predicateReads = observation.attempts.filter((entry) =>
            entry.sql.startsWith(`SELECT key, value, metadata, row_version`),
          )
          expect(predicateReads).toHaveLength(1)
          expect(predicateReads[0]?.bindings).toBe(count === 100 ? 100 : 0)
        }
      },
    )

    bindingFixedIt(`honors total capacity in each cursor SELECT`, async () => {
      expect(await runCursorContext()).toBeUndefined()
    })

    bindingFixedIt(
      `never submits an over-capacity statement with many scalar predicates`,
      async () => {
        const scalarStress: Spec = {
          label: `1000-scalar-conjunction`,
          valueKind: `string`,
          connective: `and`,
          clauses: Array.from({ length: 1000 }, () => ({
            field: `a`,
            kind: `eq`,
            values: [`target`],
          })),
        }
        const observation = await observe(scalarStress)
        expect(violation(scalarStress, observation)).toBeUndefined()
        const predicateReads = observation.attempts.filter((entry) =>
          entry.sql.startsWith(`SELECT key, value, metadata, row_version`),
        )
        expect(predicateReads).toHaveLength(1)
        expect(predicateReads[0]?.bindings).toBe(0)
      },
    )

    bindingFixedIt(
      `keeps IN values literal in both index-definition contexts`,
      async () => {
        await runIndexContext()
      },
    )

    async function campaign(
      label: string,
      parameters: { seed?: number; path?: string },
    ) {
      let firstFailure: Violation | undefined
      const property = fc.asyncProperty(generated, async (spec) => {
        assert.ok(legalSpec(spec))
        const observation = await observe(spec)
        const problem = violation(spec, observation)
        if (problem) {
          firstFailure ??= problem
          throw new Error(
            `${spec.label}: ${problem.kind}@${problem.checkpoint}: ${problem.message}${observation.cleanupError ? `; cleanup=${observation.cleanupError}` : ``}`,
          )
        }
      })
      const details = await fc.check(property, {
        numRuns: BINDING_RUNS,
        ...parameters,
      })
      const reduced = details.counterexample?.[0]
      const reducedProblem = reduced
        ? violation(reduced, await observe(reduced))
        : undefined
      const sameViolation =
        !details.failed ||
        Boolean(
          firstFailure &&
          reducedProblem &&
          firstFailure.kind === reducedProblem.kind &&
          firstFailure.checkpoint === reducedProblem.checkpoint,
        )
      expect(
        details.failed,
        `${label}: seed=${details.seed} path=${details.counterexamplePath ?? ``} first=${firstFailure?.kind ?? ``}@${firstFailure?.checkpoint ?? ``} reduced=${reducedProblem?.kind ?? ``}@${reducedProblem?.checkpoint ?? ``} sameViolation=${sameViolation}; ${details.error ?? ``}`,
      ).toBe(false)
    }

    if (bindingReplay) {
      it(`replays the requested binding history directly`, async () => {
        await campaign(`direct replay`, {
          seed: Number(bindingReplaySeed),
          path: bindingReplayPath,
        })
      })
    } else {
      it(`preserves exact rows across fixed-seed binding histories`, async () => {
        await campaign(`fixed seed`, { seed: BINDING_FIXED_SEED })
      })
      it(`preserves exact rows across random-seed binding histories`, async () => {
        await campaign(`random seed`, {})
      })
    }
  })
}

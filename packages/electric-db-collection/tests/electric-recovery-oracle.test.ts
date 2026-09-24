import { DatabaseSync } from 'node:sqlite'
import { isDeepStrictEqual } from 'node:util'
import { fc, test as fcTest } from '@fast-check/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import { oraclePropertyOptions, oracleRuns } from '../../db/tests/oracle-config'
import {
  SQLiteCorePersistenceAdapter,
  createPersistedTableName,
  persistedCollectionOptions,
} from '../../db-sqlite-persistence-core/src'
import { electricCollectionOptions } from '../src/electric'
import type { Message, Row } from '@electric-sql/client'
import type {
  PersistedCollectionCoordinator,
  PersistedTx,
  PersistenceAdapter,
  ProtocolEnvelope,
  SQLiteDriver,
} from '../../db-sqlite-persistence-core/src'
import type { ElectricCollectionUtils, ElectricSyncMode } from '../src/electric'

/**
 * # What remains visible while a persisted Electric replica repairs itself?
 *
 * Hydrated rows and resume metadata provide the last complete public snapshot.
 * A must-refetch starts a private replacement. Until that replacement is fully
 * applied, readers may see an earlier permitted snapshot but never a torn mix.
 * Failure keeps the old public rows and records repair debt; later success may
 * replace them atomically.
 *
 * A plain persisted row Map and metadata Map form the reference snapshots. The
 * driver controls hydration, SDK callbacks, applied receipts, cleanup, restart,
 * and eager or progressive mode through the real persistence coordinator and
 * Electric adapter. It records every exposed cut, not only the final rows.
 *
 * Legal histories vary sync mode, hydration and restart timing, reset cause,
 * peer publication, stream delta, deletion, and full reload. At each recorded
 * publication cut, the complete public rows must refine one permitted snapshot;
 * durable rows and resume metadata are compared again after the applied or
 * post-restart up-to-date checkpoint. Stale/missing canonical-row controls and
 * the repaired-intermediate trace challenge the checker; generated failures
 * retain fast-check's seed and shrink path.
 *
 * The fixture does not establish live HTTP delivery, native SQLite host
 * behavior, or callback multiplicity beyond the observations named below.
 */

type Item = Row & { id: number; name: string; stable: string }
type Subscriber = (messages: Array<Message<Item>>) => void
type Exposure = { cut: string; rows: Array<Item> }

function persistedResumeKind(value: unknown): unknown {
  return value && typeof value === `object`
    ? (value as Record<string, unknown>).kind
    : undefined
}

function toSqliteBinding(value: unknown): string | number | bigint | null {
  if (value === null || value === undefined) return null
  if (typeof value === `boolean`) return value ? 1 : 0
  if (
    typeof value === `string` ||
    typeof value === `number` ||
    typeof value === `bigint`
  ) {
    return value
  }
  return String(value)
}

function nodeSqliteDriver(database: DatabaseSync): SQLiteDriver {
  const driver: SQLiteDriver = {
    exec: (sql) => {
      database.exec(sql)
      return Promise.resolve()
    },
    query: (sql, params = []) =>
      Promise.resolve(
        database
          .prepare(sql)
          .all(...params.map(toSqliteBinding))
          .map((row) => ({ ...row })) as Array<never>,
      ),
    run: (sql, params = []) => {
      database.prepare(sql).run(...params.map(toSqliteBinding))
      return Promise.resolve()
    },
    transaction: async (transaction) => {
      database.exec(`BEGIN IMMEDIATE`)
      try {
        const result = await transaction(driver)
        database.exec(`COMMIT`)
        return result
      } catch (error) {
        database.exec(`ROLLBACK`)
        throw error
      }
    },
  }
  return driver
}

function expectWholeRecoveryTrace(
  entries: Array<Exposure>,
  allowed: Array<Array<Item>>,
) {
  let position = 0
  for (const entry of entries) {
    while (
      position < allowed.length &&
      !isDeepStrictEqual(entry.rows, allowed[position])
    )
      position++
    expect(position, JSON.stringify({ entry, allowed, entries })).toBeLessThan(
      allowed.length,
    )
  }
}
const subscribers: Array<Subscriber> = []
const mockSubscribe = vi.fn((callback: Subscriber) => {
  subscribers.push(callback)
  return vi.fn()
})

vi.mock(`@electric-sql/client`, async () => ({
  ...(await vi.importActual(`@electric-sql/client`)),
  ShapeStream: vi.fn(() => ({
    subscribe: mockSubscribe,
    requestSnapshot: vi.fn().mockResolvedValue(undefined),
    fetchSnapshot: vi.fn().mockResolvedValue({ metadata: {}, data: [] }),
    forceDisconnectAndRefresh: vi.fn().mockResolvedValue(undefined),
    isUpToDate: false,
    shapeHandle: `shape-current`,
    lastOffset: `20_0`,
  })),
}))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

const oldRow: Item = { id: 1, name: `old`, stable: `stable-1` }
const otherOldRow: Item = { id: 3, name: `other-old`, stable: `stable-3` }
const freshRow: Item = { id: 2, name: `fresh`, stable: `stable-2` }
const upToDate: Message<Item> = { headers: { control: `up-to-date` } }

function change(
  operation: `insert` | `update` | `delete`,
  value: Partial<Item>,
): Message<Item> {
  return { key: String(value.id), value: value as Item, headers: { operation } }
}

function fixture(
  syncMode: ElectricSyncMode,
  coordinator?: PersistedCollectionCoordinator,
) {
  const rows = new Map<string | number, Item>([[oldRow.id, { ...oldRow }]])
  const metadata = new Map<string, unknown>([
    [
      `electric:resume`,
      {
        kind: `resume`,
        requiresTagState: false,
        offset: `10_0`,
        handle: `shape-old`,
        shapeId: `{"params":{"table":"test_table"},"url":"http://test-url"}`,
        updatedAt: 1,
      },
    ],
  ])
  let hydrationGate = Promise.resolve()
  const commits: Array<PersistedTx> = []
  let latestTerm = 0
  let latestSeq = 0
  let latestRowVersion = 0
  let resetEpoch = 0
  let subsetLoads = 0
  const adapter: PersistenceAdapter = {
    loadSubset: () => {
      subsetLoads++
      const snapshot = Array.from(rows, ([key, value]) => ({
        key,
        value: { ...value },
      }))
      return hydrationGate.then(() => snapshot)
    },
    loadResumeSnapshot: async (_collectionId, ctx) => {
      if (ctx?.includeRows !== false) await hydrationGate
      return {
        rows:
          ctx?.includeRows === false
            ? []
            : Array.from(rows, ([key, value]) => ({
                key,
                value: { ...value },
              })),
        keySet: { status: `consistent` },
        collectionMetadata: Array.from(metadata, ([key, value]) => ({
          key,
          value: structuredClone(value),
        })),
        latestTerm,
        latestSeq,
        latestRowVersion,
        resetEpoch,
      }
    },
    loadCollectionMetadata: () =>
      Promise.resolve(
        Array.from(metadata, ([key, value]) => ({
          key,
          value: structuredClone(value),
        })),
      ),
    applyCommittedTx: (_collectionId, tx) => {
      for (const mutation of tx.collectionMetadataMutations ?? []) {
        if (mutation.type === `delete`) metadata.delete(mutation.key)
        else metadata.set(mutation.key, structuredClone(mutation.value))
      }
      if (tx.truncate) {
        rows.clear()
        resetEpoch++
      }
      for (const mutation of tx.mutations) {
        if (mutation.type === `delete`) rows.delete(mutation.key)
        else {
          rows.set(mutation.key, {
            ...rows.get(mutation.key),
            ...structuredClone(mutation.value),
          } as Item)
        }
      }
      latestTerm = tx.term
      latestSeq = tx.seq
      latestRowVersion = tx.rowVersion
      commits.push(structuredClone(tx))
      return Promise.resolve()
    },
    ensureIndex: () => Promise.resolve(),
  }
  const collection = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      ElectricCollectionUtils<Item>
    >({
      ...electricCollectionOptions<Item>({
        id: `persisted-recovery-${syncMode}`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode,
        getKey: (row) => row.id,
        startSync: false,
      }),
      persistence: { adapter, coordinator },
    }),
  )
  const publicRows = () =>
    Array.from(collection.values(), ({ id, name, stable }) => ({
      id,
      name,
      stable,
    })).sort((a, b) => a.id - b.id)
  const durableRows = () =>
    structuredClone([...rows.values()].sort((a, b) => a.id - b.id))
  const exposures: Array<Exposure> = []
  const record = (cut: string) => {
    exposures.push({ cut, rows: structuredClone(publicRows()) })
  }
  let stopObserving = () => {}
  const start = () => {
    stopObserving()
    collection.startSyncImmediate()
    const subscription = collection.subscribeChanges(() => record(`event`), {
      includeInitialState: false,
    })
    stopObserving = () => subscription.unsubscribe()
    record(`started`)
  }
  return {
    collection,
    rows,
    metadata,
    commits,
    publicRows,
    durableRows,
    exposures,
    record,
    subsetLoadCount: () => subsetLoads,
    start,
    stopObserving: () => stopObserving(),
    pauseHydration: (gate: Promise<void>) => {
      hydrationGate = gate
    },
  }
}

const scenarios = ([`eager`, `progressive`] as const).flatMap((syncMode) =>
  [false, true].flatMap((empty) =>
    ([`before`, `after`] as const).map((hydration) => ({
      syncMode,
      empty,
      hydration,
    })),
  ),
)

type PersistedRestartScenario = {
  rowState: `empty` | `nonempty`
  resumeKind: `none` | `reset` | `resume`
  transition:
    | `compatible-reopen`
    | `schema-reset`
    | `partial-restore`
    | `external-row-loss`
  sourceHistory: `up-to-date-only` | `replayed-insert`
}

const persistedRestartScenarios = ([`empty`, `nonempty`] as const).flatMap(
  (rowState) =>
    ([`none`, `reset`, `resume`] as const).flatMap((resumeKind) =>
      (
        [
          `compatible-reopen`,
          `schema-reset`,
          ...(rowState === `nonempty`
            ? ([`partial-restore`, `external-row-loss`] as const)
            : []),
        ] as const
      ).flatMap((transition) =>
        ([`up-to-date-only`, `replayed-insert`] as const).map(
          (sourceHistory): PersistedRestartScenario => ({
            rowState,
            resumeKind,
            transition,
            sourceHistory,
          }),
        ),
      ),
    ),
)

type PersistedRestartObservation = {
  checkpoint: `post-restart-up-to-date`
  requestedOffset: string | undefined
  requestedHandle: string | undefined
  visibleRows: Array<Item>
  durableRows: Array<Item>
  durableResumeKind: unknown
  status: string
}

function expectPersistedRestartLaw(
  actual: PersistedRestartObservation,
  expected: PersistedRestartObservation,
): void {
  expect(actual).toEqual(expected)
}

function cloneItem(item: Item): Item {
  return { id: item.id, name: item.name, stable: item.stable }
}

function attachPersistedRestartCleanupDiagnostics(
  primary: unknown,
  cleanupEvidence: string,
  cleanupFailures: ReadonlyArray<unknown>,
): Error {
  const error =
    primary instanceof Error
      ? primary
      : new Error(`Persisted restart oracle failed with a non-Error value`, {
          cause: primary,
        })
  Object.defineProperty(error, `cleanupEvidence`, {
    value: cleanupEvidence,
    enumerable: true,
  })
  if (cleanupFailures.length > 0) {
    Object.defineProperty(error, `cleanupFailures`, {
      value: [...cleanupFailures],
      enumerable: true,
    })
  }
  return error
}

async function observePersistedRestart(
  scenario: PersistedRestartScenario,
): Promise<{
  observation: PersistedRestartObservation
  expected: PersistedRestartObservation
  cleanupEvidence: string
}> {
  subscribers.length = 0
  vi.clearAllMocks()
  let database: DatabaseSync | undefined
  let result:
    | {
        observation: PersistedRestartObservation
        expected: PersistedRestartObservation
        cleanupEvidence: string
      }
    | undefined
  let deferredFailure: unknown
  try {
    database = new DatabaseSync(`:memory:`)
    const driver = nodeSqliteDriver(database)
    const collectionId = `persisted-schema-reset-electric`
    const modelInitialRows =
      scenario.rowState === `empty`
        ? []
        : [cloneItem(oldRow), cloneItem(otherOldRow)]
    const modelCanonicalRows =
      scenario.sourceHistory === `replayed-insert`
        ? [...modelInitialRows, cloneItem(freshRow)]
        : modelInitialRows
    modelCanonicalRows.sort((left, right) => left.id - right.id)
    const productionSeedRows =
      scenario.rowState === `empty`
        ? []
        : [cloneItem(oldRow), cloneItem(otherOldRow)]
    const canResume =
      scenario.transition === `compatible-reopen` &&
      scenario.resumeKind === `resume`
    const expected: PersistedRestartObservation = {
      checkpoint: `post-restart-up-to-date`,
      requestedOffset: canResume ? `10_0` : undefined,
      requestedHandle: canResume ? `shape-old` : undefined,
      visibleRows: modelCanonicalRows.map(cloneItem),
      durableRows: modelCanonicalRows.map(cloneItem),
      durableResumeKind: `resume`,
      status: `ready`,
    }
    const resumeState =
      scenario.resumeKind === `none`
        ? []
        : [
            {
              type: `set` as const,
              key: `electric:resume`,
              value:
                scenario.resumeKind === `reset`
                  ? { kind: `reset`, updatedAt: 1 }
                  : {
                      kind: `resume`,
                      requiresTagState: false,
                      offset: `10_0`,
                      handle: `shape-old`,
                      shapeId: `{"params":{"table":"test_table"},"url":"http://test-url"}`,
                      updatedAt: 1,
                    },
            },
          ]
    const originalAdapter = new SQLiteCorePersistenceAdapter({
      driver,
      schemaVersion: 1,
    })
    await originalAdapter.applyCommittedTx(collectionId, {
      txId: `seed-electric-baseline`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: productionSeedRows.map((row) => ({
        type: `insert` as const,
        key: row.id,
        value: cloneItem(row),
      })),
      collectionMetadataMutations: resumeState,
    })

    const usesSchemaReset =
      scenario.transition === `schema-reset` ||
      scenario.transition === `partial-restore`
    const schemaVersion = usesSchemaReset ? 2 : 1
    const restartedAdapter = new SQLiteCorePersistenceAdapter({
      driver,
      schemaVersion,
      schemaMismatchPolicy: `sync-present-reset`,
    })
    await restartedAdapter.loadSubset(collectionId, {})
    if (scenario.transition === `partial-restore`) {
      await restartedAdapter.applyCommittedTx(collectionId, {
        txId: `partial-electric-restore`,
        term: 2,
        seq: 1,
        rowVersion: 2,
        mutations: [
          { type: `insert`, key: oldRow.id, value: cloneItem(oldRow) },
        ],
      })
    } else if (scenario.transition === `external-row-loss`) {
      const collectionTable = createPersistedTableName(collectionId, `c`)
      await driver.run(
        `DELETE FROM "${collectionTable}" WHERE json_extract(value, '$.id') = ?`,
        [oldRow.id],
      )
    }

    const collection = createCollection(
      persistedCollectionOptions<
        Item,
        string | number,
        never,
        ElectricCollectionUtils<Item>
      >({
        ...electricCollectionOptions<Item>({
          id: collectionId,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          syncMode: `eager`,
          getKey: (row) => row.id,
          startSync: false,
        }),
        persistence: { adapter: restartedAdapter },
      }),
    )

    let streamSubscriber: Subscriber | undefined
    let subscription: ReturnType<typeof collection.subscribeChanges> | undefined
    let observation!: PersistedRestartObservation
    let semanticFailure: unknown
    let processingFailure: unknown
    const cleanupFailures: Array<unknown> = []
    let cleanupEvidence = `not-run`
    let publicationEvents = 0
    try {
      collection.startSyncImmediate()
      subscription = collection.subscribeChanges(
        () => {
          publicationEvents++
        },
        { includeInitialState: false },
      )
      await vi.waitFor(() => expect(subscribers).toHaveLength(1))
      streamSubscriber = subscribers[0]
      const request = vi.mocked(ShapeStream).mock.calls[0]?.[0] as
        | { offset?: string; handle?: string }
        | undefined
      if (!streamSubscriber || !request) {
        throw new Error(`Persisted Electric stream did not reach subscription`)
      }

      // The source chooses a legal response from the request production made.
      // A resumed request receives only changes since its cursor; a fresh request
      // receives the complete current snapshot. Both finish with up-to-date.
      const sourceRows =
        request.offset === undefined
          ? modelCanonicalRows.map(cloneItem)
          : scenario.sourceHistory === `replayed-insert`
            ? [cloneItem(freshRow)]
            : []
      streamSubscriber([
        ...sourceRows.map((row) => change(`insert`, cloneItem(row))),
        structuredClone(upToDate),
      ])
      await vi.waitFor(() => expect(collection.status).toBe(`ready`))
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))

      const durableRows = await restartedAdapter.loadSubset(collectionId, {})
      const durableMetadata =
        await restartedAdapter.loadCollectionMetadata(collectionId)
      observation = {
        checkpoint: `post-restart-up-to-date`,
        requestedOffset: request.offset,
        requestedHandle: request.handle,
        visibleRows: Array.from(
          collection.values(),
          ({ id, name, stable }) => ({
            id,
            name,
            stable,
          }),
        ).sort((left, right) => left.id - right.id),
        durableRows: durableRows
          .map(({ value }) => value as Item)
          .map(({ id, name, stable }) => ({ id, name, stable }))
          .sort((left, right) => left.id - right.id),
        durableResumeKind: persistedResumeKind(
          durableMetadata.find(({ key }) => key === `electric:resume`)?.value,
        ),
        status: collection.status,
      }
      try {
        expectPersistedRestartLaw(observation, expected)
      } catch (error) {
        semanticFailure = error
      }
    } catch (error) {
      processingFailure = error
    } finally {
      let collectionCleanupCompleted = false
      try {
        subscription?.unsubscribe()
      } catch (error) {
        cleanupFailures.push(error)
      }
      try {
        await collection.cleanup()
        collectionCleanupCompleted = true
      } catch (error) {
        cleanupFailures.push(error)
      }
      if (collectionCleanupCompleted && streamSubscriber) {
        try {
          const beforeLatePublicRows = Array.from(
            collection.values(),
            ({ id, name, stable }) => ({ id, name, stable }),
          ).sort((left, right) => left.id - right.id)
          const beforeLateStatus = collection.status
          const beforeLateEvents = publicationEvents
          const beforeLatePending =
            collection._state.pendingSyncedTransactions.map(
              ({ committed }) => committed,
            )
          const beforeLateRows = await restartedAdapter.loadSubset(
            collectionId,
            {},
          )
          const beforeLateMetadata =
            await restartedAdapter.loadCollectionMetadata(collectionId)
          const beforeLateApplied = await driver.query<{
            term: number
            seq: number
            tx_id: string
            row_version: number
          }>(
            `SELECT term, seq, tx_id, row_version FROM applied_tx WHERE collection_id = ? ORDER BY term, seq`,
            [collectionId],
          )
          // Deliver both data and the commit boundary. An uncommitted message
          // would not challenge late application/publication after retirement.
          streamSubscriber([
            change(`insert`, { id: 77, name: `late`, stable: `late` }),
            structuredClone(upToDate),
          ])
          await new Promise((resolve) => setTimeout(resolve, 0))
          await new Promise((resolve) => setTimeout(resolve, 0))
          const afterLatePublicRows = Array.from(
            collection.values(),
            ({ id, name, stable }) => ({ id, name, stable }),
          ).sort((left, right) => left.id - right.id)
          const afterLateRows = await restartedAdapter.loadSubset(
            collectionId,
            {},
          )
          const afterLateMetadata =
            await restartedAdapter.loadCollectionMetadata(collectionId)
          const afterLateApplied = await driver.query<{
            term: number
            seq: number
            tx_id: string
            row_version: number
          }>(
            `SELECT term, seq, tx_id, row_version FROM applied_tx WHERE collection_id = ? ORDER BY term, seq`,
            [collectionId],
          )
          const afterLatePending =
            collection._state.pendingSyncedTransactions.map(
              ({ committed }) => committed,
            )
          cleanupEvidence =
            isDeepStrictEqual(afterLatePublicRows, beforeLatePublicRows) &&
            collection.status === beforeLateStatus &&
            publicationEvents === beforeLateEvents &&
            isDeepStrictEqual(beforeLatePending, []) &&
            isDeepStrictEqual(afterLatePending, beforeLatePending) &&
            isDeepStrictEqual(afterLateRows, beforeLateRows) &&
            isDeepStrictEqual(afterLateMetadata, beforeLateMetadata) &&
            isDeepStrictEqual(afterLateApplied, beforeLateApplied)
              ? `passed: committed retired-stream delivery changed no public rows, events, status, pending transactions, durable rows, metadata, or applied effects`
              : `failed: committed retired-stream delivery changed public or pending/durable effects`
        } catch (error) {
          cleanupFailures.push(error)
        }
      } else if (collectionCleanupCompleted) {
        cleanupEvidence = `passed: collection cleanup completed before a retired stream became available`
      }
      if (cleanupFailures.length > 0) {
        cleanupEvidence =
          `failed: ${cleanupFailures.map((error) => String(error)).join(`; `)}; ` +
          `retiredProbe=${cleanupEvidence}`
      }
    }

    if (semanticFailure !== undefined) {
      deferredFailure = attachPersistedRestartCleanupDiagnostics(
        new Error(
          `Persisted Electric reset/resume violation. ` +
            `checkpoint=${observation.checkpoint} ` +
            `scenario=${JSON.stringify(scenario)} ` +
            `expected=${JSON.stringify(expected)} ` +
            `actual=${JSON.stringify(observation)} ` +
            `cleanup=${cleanupEvidence}`,
          { cause: semanticFailure },
        ),
        cleanupEvidence,
        cleanupFailures,
      )
    } else if (processingFailure !== undefined) {
      deferredFailure = attachPersistedRestartCleanupDiagnostics(
        processingFailure,
        cleanupEvidence,
        cleanupFailures,
      )
    } else if (cleanupFailures.length > 0) {
      deferredFailure = new AggregateError(cleanupFailures, cleanupEvidence)
    } else if (!cleanupEvidence.startsWith(`passed:`)) {
      deferredFailure = new Error(cleanupEvidence)
    } else {
      result = {
        observation,
        expected,
        cleanupEvidence,
      }
    }
  } catch (error) {
    deferredFailure ??=
      error instanceof Error
        ? error
        : new Error(`Persisted restart setup failed with a non-Error value`, {
            cause: error,
          })
  } finally {
    try {
      database?.close()
    } catch (closeError) {
      if (deferredFailure instanceof Error) {
        Object.defineProperty(deferredFailure, `databaseCloseFailure`, {
          value: closeError,
          enumerable: true,
        })
      } else {
        deferredFailure = closeError
      }
    }
  }

  if (deferredFailure !== undefined) throw deferredFailure
  if (!result) throw new Error(`Persisted restart result was not captured`)
  return result
}

describe(`persisted Electric recovery laws`, () => {
  beforeEach(() => {
    subscribers.length = 0
    vi.clearAllMocks()
  })

  /**
   * This matrix is the reached consumer half of the SQLite reset/resume law.
   * Its independent model carries only baseline lineage and canonical server
   * rows. The real SQLite adapter performs the transition, the real persisted
   * wrapper hydrates it, and electricCollectionOptions chooses the ShapeStream
   * request. The mock boundary supplies the installed protocol's legal rule:
   * resume gets only changes since its cursor; fresh sync gets a full snapshot;
   * both end at the post-restart up-to-date checkpoint.
   *
   * We compare request offset/handle, complete public rows, durable rows,
   * durable resume kind, and readiness after schema reset, partial restore,
   * and one externally deleted-row fault. Callback multiplicity, real HTTP,
   * and arbitrary external edit sequences are omitted. Electric's existing
   * recovery properties own partial unseen updates and SDK framing. The
   * nonempty + resume + schema-reset + up-to-date-only cell preserves the
   * original report at https://github.com/TanStack/db/issues/1589.
   */
  it.each(persistedRestartScenarios)(
    `couples $resumeKind state to $transition with $rowState rows and $sourceHistory source history`,
    async (scenario) => {
      const { cleanupEvidence } = await observePersistedRestart(scenario)
      expect(cleanupEvidence).toContain(`passed: committed retired-stream`)
    },
  )

  it(`accepts a compatible empty resume and rejects a stale reset request or missing canonical row`, () => {
    const compatibleEmpty: PersistedRestartObservation = {
      checkpoint: `post-restart-up-to-date`,
      requestedOffset: `10_0`,
      requestedHandle: `shape-old`,
      visibleRows: [],
      durableRows: [],
      durableResumeKind: `resume`,
      status: `ready`,
    }
    expect(() =>
      expectPersistedRestartLaw(
        { ...compatibleEmpty, visibleRows: [], durableRows: [] },
        compatibleEmpty,
      ),
    ).not.toThrow()

    const freshNonempty: PersistedRestartObservation = {
      ...compatibleEmpty,
      requestedOffset: undefined,
      requestedHandle: undefined,
      visibleRows: [{ ...oldRow }, { ...otherOldRow }],
      durableRows: [{ ...oldRow }, { ...otherOldRow }],
    }
    expect(() =>
      expectPersistedRestartLaw(
        {
          ...freshNonempty,
          requestedOffset: `10_0`,
          requestedHandle: `shape-old`,
          visibleRows: [{ ...oldRow }],
          durableRows: [{ ...oldRow }],
        },
        freshNonempty,
      ),
    ).toThrowError(expect.objectContaining({ name: `AssertionError` }))
  })

  it(`keeps repaired intermediate publications in the persisted recovery record`, async () => {
    const f = fixture(`eager`)
    try {
      f.start()
      await vi.waitFor(() => expect(f.publicRows()).toEqual([oldRow]))
      await vi.waitFor(() => expect(subscribers).toHaveLength(1))
      const cut = f.exposures.length
      f.record(`before`)
      subscribers[0]!([change(`update`, { id: 1, name: `wrong` }), upToDate])
      subscribers[0]!([change(`update`, { id: 1, name: `correct` }), upToDate])
      f.record(`repaired`)
      const correct = [{ ...oldRow, name: `correct` }]
      expect(f.publicRows()).toEqual(correct)
      const entries = f.exposures.slice(cut)
      expect(entries[0]!.rows).toEqual([oldRow])
      expect(
        entries.some(
          ({ cut: kind, rows }) =>
            kind === `event` && rows[0]?.name === `wrong`,
        ),
      ).toBe(true)
      expect(() =>
        expectWholeRecoveryTrace(entries, [[oldRow], correct]),
      ).toThrow()
      expectWholeRecoveryTrace(entries, [
        [oldRow],
        [{ ...oldRow, name: `wrong` }],
        correct,
      ])
    } finally {
      f.stopObserving()
      await f.collection.cleanup()
    }
  })

  function externalPublisher() {
    let receive: ((message: ProtocolEnvelope<unknown>) => void) | undefined
    let id = ``
    let term = 100
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `local`,
      subscribe: (collectionId, callback) => {
        id = collectionId
        receive = callback
        return () => {
          receive = undefined
        }
      },
      publish: () => {},
      isLeader: () => true,
      ensureLeadership: () => Promise.resolve(),
      requestEnsurePersistedIndex: () => Promise.resolve(),
      requestEnsureRemoteSubset: () => Promise.resolve(),
    }
    return {
      coordinator,
      publish: (
        row: Item,
        deleted: boolean,
        fullReload: boolean,
        metadata: Map<string, unknown>,
      ) => {
        const revision = term++
        metadata.set(`oracle:publication`, revision)
        receive?.({
          v: 1,
          dbName: id,
          collectionId: id,
          senderId: `peer`,
          ts: Date.now(),
          payload: {
            type: `tx:committed`,
            term: revision,
            seq: 1,
            txId: `peer-${term}`,
            latestRowVersion: term,
            requiresFullReload: fullReload,
            changedRows: deleted ? [] : [{ key: row.id, value: row }],
            deletedKeys: deleted ? [row.id] : [],
            collectionMetadataMutations: [
              { type: `set`, key: `oracle:publication`, value: revision },
            ],
          },
        })
        return revision
      },
    }
  }

  it.each(
    ([`eager`, `progressive`, `on-demand`] as const).flatMap((syncMode) =>
      [false, true].map((fullReload) => ({ syncMode, fullReload })),
    ),
  )(
    `$syncMode merges stream deltas into independently published rows, fullReload=$fullReload`,
    async ({ syncMode, fullReload }) => {
      const peer = externalPublisher()
      const f = fixture(syncMode, peer.coordinator)
      try {
        f.start()
        await vi.waitFor(() => expect(subscribers).toHaveLength(1))
        if (syncMode === `on-demand`) await f.collection._sync.loadSubset({})
        await vi.waitFor(() => expect(f.publicRows()).toEqual([oldRow]))
        subscribers[0]!([upToDate])
        const cut = f.exposures.length
        f.record(`before peer`)
        f.rows.set(freshRow.id, structuredClone(freshRow))
        peer.publish(freshRow, false, fullReload, f.metadata)
        f.record(`after peer delivery`)
        await vi.waitFor(() =>
          expect(f.publicRows()).toEqual([oldRow, freshRow]),
        )
        f.record(`peer settled`)
        expectWholeRecoveryTrace(f.exposures.slice(cut), [
          [oldRow],
          [oldRow, freshRow],
        ])
        const streamCut = f.exposures.length
        f.record(`before stream delta`)
        subscribers[0]!([
          change(`update`, { id: freshRow.id, name: `changed` }),
          upToDate,
        ])
        const expected = [oldRow, { ...freshRow, name: `changed` }]
        f.record(`after stream delta`)
        expect(f.publicRows()).toEqual(expected)
        await vi.waitFor(() => expect(f.durableRows()).toEqual(expected))
        expectWholeRecoveryTrace(f.exposures.slice(streamCut), [
          [oldRow, freshRow],
          expected,
        ])
      } finally {
        f.stopObserving()
        await f.collection.cleanup()
      }
    },
  )

  type PublicationHistoryCommand = {
    id: number
    name: string
    deleted: boolean
    fullReload: boolean
  }

  const publicationHistoryArbitrary = fc.array(
    fc.record({
      id: fc.integer({ min: 2, max: 4 }),
      name: fc.string({ maxLength: 8 }),
      deleted: fc.boolean(),
      fullReload: fc.boolean(),
    }),
    { minLength: 1, maxLength: 8 },
  )

  const assertPublicationHistory = async (
    commands: Array<PublicationHistoryCommand>,
  ) => {
    subscribers.length = 0
    const peer = externalPublisher()
    const f = fixture(`on-demand`, peer.coordinator)
    const expected = new Map([[oldRow.id, structuredClone(oldRow)]])
    const expectedRows = () =>
      structuredClone([...expected.values()].sort((a, b) => a.id - b.id))
    try {
      f.start()
      await vi.waitFor(() => expect(subscribers).toHaveLength(1), {
        interval: 1,
      })
      await f.collection._sync.loadSubset({})
      subscribers[0]!([upToDate])
      for (const command of commands) {
        const before = expectedRows()
        const cut = f.exposures.length
        f.record(`before peer ${JSON.stringify(command)}`)
        const row = {
          id: command.id,
          name: command.name,
          stable: `peer-${command.id}`,
        }
        if (command.deleted) {
          f.rows.delete(row.id)
          expected.delete(row.id)
        } else {
          f.rows.set(row.id, structuredClone(row))
          expected.set(row.id, structuredClone(row))
        }
        const subsetLoadsBeforeSettlement = f.subsetLoadCount()
        const revision = peer.publish(
          row,
          command.deleted,
          command.fullReload,
          f.metadata,
        )
        f.record(`after peer revision ${revision}`)
        // An unchanged row set is not proof that the peer publication ran.
        // Its metadata marker commits with the rows, including empty deletes.
        await vi.waitFor(
          () =>
            expect(
              f.collection._state.syncedCollectionMetadata.get(
                `oracle:publication`,
              ),
            ).toBe(revision),
          { interval: 1 },
        )
        if (command.fullReload) {
          await vi.waitFor(
            () =>
              expect(f.subsetLoadCount()).toBeGreaterThan(
                subsetLoadsBeforeSettlement,
              ),
            { interval: 1 },
          )
        } else {
          expect(f.subsetLoadCount()).toBe(subsetLoadsBeforeSettlement)
        }
        expect(f.publicRows()).toEqual(expectedRows())
        f.record(`peer revision ${revision} settled`)
        const afterPeer = expectedRows()
        expectWholeRecoveryTrace(f.exposures.slice(cut), [before, afterPeer])
        const streamCut = f.exposures.length
        f.record(`before stream revision ${revision}`)
        subscribers[0]!([
          change(`update`, { id: row.id, name: `stream` }),
          upToDate,
        ])
        if (!command.deleted) expected.set(row.id, { ...row, name: `stream` })
        f.record(`after stream revision ${revision}`)
        expect(f.publicRows()).toEqual(expectedRows())
        await vi.waitFor(
          () => expect(f.durableRows()).toEqual(expectedRows()),
          { interval: 1 },
        )
        expectWholeRecoveryTrace(f.exposures.slice(streamCut), [
          afterPeer,
          expectedRows(),
        ])
      }
    } finally {
      f.stopObserving()
      await f.collection.cleanup()
    }
  }

  const publicationHistoryExamples: Array<[Array<PublicationHistoryCommand>]> =
    [
      [
        [
          { id: 2, name: `external`, deleted: false, fullReload: false },
          { id: 2, name: `removed`, deleted: true, fullReload: true },
        ],
      ],
    ]

  it.each(publicationHistoryExamples)(
    `reconstructs the authored persistence publication history`,
    assertPublicationHistory,
  )

  it(`fixed recovery corpus reaches every deletion and reload combination`, () => {
    const combinations = new Set(
      fc
        .sample(publicationHistoryArbitrary, { seed: 1659, numRuns: 20 })
        .flat()
        .map(({ deleted, fullReload }) => `${deleted}:${fullReload}`),
    )
    expect(combinations).toEqual(
      new Set([`false:false`, `false:true`, `true:false`, `true:true`]),
    )
  })

  fcTest.prop([publicationHistoryArbitrary], {
    seed: 1659,
    numRuns: oracleRuns(20),
  })(
    `independent persistence publications and stream deltas agree with complete-row state (fixed)`,
    assertPublicationHistory,
  )

  fcTest.prop(
    [publicationHistoryArbitrary],
    oraclePropertyOptions(
      20,
      `electric-recovery.publication-stream-convergence`,
    ),
  )(
    `independent persistence publications and stream deltas agree with complete-row state (random or replayed)`,
    assertPublicationHistory,
  )

  it.each(scenarios)(
    `$syncMode invalid resume replaces omitted cached rows: empty=$empty, hydration=$hydration callback`,
    async ({ syncMode, empty, hydration }) => {
      const f = fixture(syncMode)
      const gate = deferred()
      try {
        f.start()
        await vi.waitFor(() => expect(f.publicRows()).toEqual([oldRow]))
        await vi.waitFor(() => expect(subscribers).toHaveLength(1))
        expect(vi.mocked(ShapeStream).mock.calls[0]?.[0]).toMatchObject({
          offset: `10_0`,
          handle: `shape-old`,
        })
        const invalidCut = f.exposures.length
        f.record(`before invalid resume`)
        subscribers[0]!([
          change(`delete`, { id: 1 }),
          change(`update`, { id: 2, name: `partial` }),
          upToDate,
        ])
        f.record(`after invalid resume`)
        await vi.waitFor(() => expect(f.collection.status).toBe(`error`))
        await vi.waitFor(() =>
          expect(f.metadata.get(`electric:resume`)).toMatchObject({
            kind: `reset`,
          }),
        )
        expect(f.publicRows()).toEqual([oldRow])
        expect(f.durableRows()).toEqual([oldRow])
        expectWholeRecoveryTrace(f.exposures.slice(invalidCut), [[oldRow]])

        f.stopObserving()
        await f.collection.cleanup()
        f.pauseHydration(gate.promise)
        const recoveryCut = f.exposures.length
        f.start()
        await vi.waitFor(() => expect(subscribers).toHaveLength(2))
        expect(vi.mocked(ShapeStream).mock.calls[1]?.[0]).toMatchObject({
          offset: undefined,
          handle: undefined,
        })
        // Fresh progressive mode hydrates persisted rows only on demand.
        const hydrationDone =
          syncMode === `progressive`
            ? Promise.resolve(f.collection._sync.loadSubset({ limit: 10 }))
            : undefined
        const hydrationOutcome = hydrationDone?.then(
          () => undefined,
          (error: unknown) => ({ error }),
        )
        const awaitHydration = async () => {
          const outcome = await hydrationOutcome
          if (outcome) throw outcome.error
        }
        if (hydration === `before`) {
          gate.resolve()
          await awaitHydration()
          await vi.waitFor(() => expect(f.publicRows()).toEqual([oldRow]))
        }
        f.record(`before replacement data`)
        const partialCut = f.exposures.length
        const expected = empty ? [] : [freshRow]
        subscribers[1]!(
          expected.map((row) => change(`insert`, structuredClone(row))),
        )
        f.record(`after replacement data`)
        subscribers[1]!([{ headers: { control: `subset-end` } }])
        f.record(`after subset completion`)
        expectWholeRecoveryTrace(f.exposures.slice(partialCut), [
          hydration === `before` ? [oldRow] : [],
        ])
        subscribers[1]!([upToDate])
        f.record(`after replacement commit`)
        // Preserve the original hydration-after-commit cells: the final
        // control is delivered before releasing the paused hydration gate.
        gate.resolve()
        await awaitHydration()
        await vi.waitFor(() => expect(f.collection.status).toBe(`ready`))
        await vi.waitFor(() =>
          expect(f.metadata.get(`electric:resume`)).toMatchObject({
            kind: `resume`,
            requiresTagState: false,
            offset: `20_0`,
          }),
        )
        // The source's complete snapshot defines both results. A reset marker
        // plus a fresh offset is not proof that the old materialization left.
        expect.soft(f.publicRows()).toEqual(expected)
        expect.soft(f.durableRows()).toEqual(expected)
        f.record(`replacement ready`)
        expectWholeRecoveryTrace(f.exposures.slice(recoveryCut), [
          [],
          [oldRow],
          expected,
        ])
      } finally {
        gate.resolve()
        f.stopObserving()
        await f.collection.cleanup()
      }
    },
  )

  it.each([`eager`, `progressive`] as const)(
    `%s valid resume retains cached rows and their unchanged fields`,
    async (syncMode) => {
      const f = fixture(syncMode)
      try {
        f.start()
        await vi.waitFor(() => expect(f.publicRows()).toEqual([oldRow]))
        await vi.waitFor(() => expect(subscribers).toHaveLength(1))
        subscribers[0]!([
          change(`update`, { id: 1, name: `changed` }),
          upToDate,
        ])
        await vi.waitFor(() => expect(f.collection.status).toBe(`ready`))
        const expected = [{ ...oldRow, name: `changed` }]
        expect(f.publicRows()).toEqual(expected)
        await vi.waitFor(() => expect(f.durableRows()).toEqual(expected))
        expect(f.commits.every((tx) => !tx.truncate)).toBe(true)
      } finally {
        f.stopObserving()
        await f.collection.cleanup()
      }
    },
  )
})

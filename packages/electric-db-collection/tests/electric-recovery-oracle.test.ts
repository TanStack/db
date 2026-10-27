import { DatabaseSync } from 'node:sqlite'
import { isDeepStrictEqual } from 'node:util'
import { fc, test as fcTest } from '@fast-check/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import { oraclePropertyOptions, oracleRuns } from '../../db/tests/oracle-config'
import { declareOracle } from '../../db/tests/oracle-declaration'
import {
  SQLiteCorePersistenceAdapter,
  createPersistedTableName,
  persistedCollectionOptions,
} from '../../db-sqlite-persistence-core/src'
import { electricCollectionOptions } from '../src/electric'
import {
  attachRecoveryCleanupDiagnostics,
  change,
  expectPersistedRestartLaw,
  expectWholeRecoveryTrace,
  externalPublisher,
  fixture,
  freshRow,
  oldRow,
  otherOldRow,
  upToDate,
  withFixtureCleanup,
} from './electric-recovery-support'
import type { Message } from '@electric-sql/client'
import type { SQLiteDriver } from '../../db-sqlite-persistence-core/src'
import type { ElectricCollectionUtils } from '../src/electric'
import type {
  Item,
  PersistedRestartObservation,
} from './electric-recovery-support'

/**
 * # What remains visible while a persisted Electric replica repairs itself?
 *
 * Hydrated rows and resume metadata provide the last complete public snapshot.
 * A must-refetch starts a private replacement. Until that replacement is fully
 * applied, readers may see an earlier permitted snapshot but never a torn mix.
 * Failure keeps the prior public rows and records repair debt; later success
 * may replace them atomically.
 *
 * Plain persisted row and metadata Maps form the reference snapshots. The
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
 * behavior, or callback multiplicity beyond the observations named below. The
 * external-publisher fixture routes complete committed transactions through
 * its bound adapter; that wiring does not add native-host evidence.
 */
type Subscriber = (messages: Array<Message<Item>>) => void

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

function cloneItem(item: Item): Item {
  return { id: item.id, name: item.name, stable: item.stable }
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
    const expected = expectedPostRestartObservation(
      scenario,
      modelCanonicalRows,
    )
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
    await originalAdapter.applyCommittedTx(
      { kind: `eager`, collectionId: collectionId },
      {
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
      },
    )

    const usesSchemaReset =
      scenario.transition === `schema-reset` ||
      scenario.transition === `partial-restore`
    const schemaVersion = usesSchemaReset ? 2 : 1
    const restartedAdapter = new SQLiteCorePersistenceAdapter({
      driver,
      schemaVersion,
      schemaMismatchPolicy: `sync-present-reset`,
    })
    await restartedAdapter.loadSubset(
      { kind: `eager`, collectionId: collectionId },
      {},
    )
    if (scenario.transition === `partial-restore`) {
      await restartedAdapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `partial-electric-restore`,
          term: 2,
          seq: 1,
          rowVersion: 2,
          mutations: [
            { type: `insert`, key: oldRow.id, value: cloneItem(oldRow) },
          ],
        },
      )
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
        { offset?: string; handle?: string } | undefined
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

      const durableRows = await restartedAdapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {},
      )
      const durableMetadata = await restartedAdapter.loadCollectionMetadata({
        kind: `eager`,
        collectionId: collectionId,
      })
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
            { kind: `eager`, collectionId: collectionId },
            {},
          )
          const beforeLateMetadata =
            await restartedAdapter.loadCollectionMetadata({
              kind: `eager`,
              collectionId: collectionId,
            })
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
            { kind: `eager`, collectionId: collectionId },
            {},
          )
          const afterLateMetadata =
            await restartedAdapter.loadCollectionMetadata({
              kind: `eager`,
              collectionId: collectionId,
            })
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
      deferredFailure = attachRecoveryCleanupDiagnostics(
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
      deferredFailure = attachRecoveryCleanupDiagnostics(
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

function expectedPostRestartObservation(
  scenario: PersistedRestartScenario,
  modelCanonicalRows: Array<Item>,
): PersistedRestartObservation {
  const canResume =
    scenario.transition === `compatible-reopen` &&
    scenario.resumeKind === `resume`
  return {
    checkpoint: `post-restart-up-to-date`,
    requestedOffset: canResume ? `10_0` : undefined,
    requestedHandle: canResume ? `shape-old` : undefined,
    visibleRows: modelCanonicalRows.map(cloneItem),
    durableRows: modelCanonicalRows.map(cloneItem),
    durableResumeKind: `resume`,
    status: `ready`,
  }
}

/**
 * The Map adapter stands in for SQLite's row operations. An insert replaces
 * the row; an update keeps the fields that the command omits.
 */
function expectedDurableRow(
  operation: `insert` | `update`,
  previous: Item,
  next: Item,
): Item {
  return operation === `insert` ? next : { ...previous, ...next }
}

type PublicationHistoryCommand = {
  id: number
  name: string
  deleted: boolean
  fullReload: boolean
  operation?: `insert` | `update`
  obsolete?: boolean
}

/**
 * One model command pairs two production boundaries: a committed peer
 * publication, then an Electric stream update. The row Map models complete
 * public values; the publication marker is only a reach witness, not model
 * state. No later command branches on that marker.
 *
 * The bounded grammar permits 1–8 pairs, keys 2–4 beside the untouched
 * baseline key 1, and names of length 0–8. Key variation distinguishes
 * independent rows from repeated edits; name and optional field variation
 * distinguish partial update from same-key insert replacement. Deletion
 * changes membership;
 * fullReload requires a persisted read. A targeted notice can also require
 * a read when its row is new to this Collection: the notice carries a
 * patch without a completeness certificate. Public rows, rather than the
 * number of reads, decide whether that route satisfies the law. Multiple
 * pairs expose repeated-key histories. The authored history below
 * reconstructs insert then delete with a reload. The other fixed histories
 * reach both sequence-length and name/key margins. The grammar excludes a
 * malformed peer transaction that lists one key as both changed and deleted;
 * the publisher constructs exactly one of those lists from `deleted`.
 * Arbitrary keys and longer histories remain outside this property.
 */
const publicationHistoryArbitrary = fc.array(
  fc.record({
    id: fc.integer({ min: 2, max: 4 }),
    name: fc.string({ maxLength: 8 }),
    deleted: fc.boolean(),
    fullReload: fc.boolean(),
    operation: fc.constantFrom(`insert` as const, `update` as const),
    obsolete: fc.boolean(),
  }),
  { minLength: 1, maxLength: 8 },
)

/**
 * The model applies a committed peer publication to the expected rows. A
 * delete removes the key; an insert replaces the row; an update keeps the
 * fields that the notice omits.
 */
function applyPublicationCommandToModel(
  expected: Map<number, Item>,
  command: PublicationHistoryCommand,
  row: Item,
  operation: `insert` | `update`,
): void {
  if (command.deleted) expected.delete(row.id)
  else {
    expected.set(
      row.id,
      operation === `insert`
        ? structuredClone(row)
        : { ...expected.get(row.id), ...structuredClone(row) },
    )
  }
}

/**
 * A stream update after a peer publication renames the row that the model
 * holds. A missing row means the model has no basis for the update.
 */
function applyStreamUpdateToModel(
  expected: Map<number, Item>,
  id: number,
): void {
  const current = expected.get(id)
  if (!current) throw new Error(`peer row missing before stream update`)
  expected.set(id, { ...current, name: `stream` })
}

const assertPublicationHistory = async (
  commands: Array<PublicationHistoryCommand>,
) => {
  subscribers.length = 0
  const peer = externalPublisher()
  const f = fixture(`on-demand`, peer.coordinator)
  const expected = new Map([[oldRow.id, structuredClone(oldRow)]])
  const expectedRows = () =>
    structuredClone([...expected.values()].sort((a, b) => a.id - b.id))
  let checkpoint = `startup`
  await withFixtureCleanup(f, async () => {
    try {
      f.start()
      await vi.waitFor(() => expect(subscribers).toHaveLength(1), {
        interval: 1,
      })
      await f.collection._sync.loadSubset({})
      subscribers[0]!([upToDate])
      for (const command of commands) {
        checkpoint = `peer publication ${JSON.stringify(command)}`
        const before = expectedRows()
        const cut = f.exposures.length
        f.record(`before peer ${JSON.stringify(command)}`)
        const row = {
          id: command.id,
          name: command.name,
          stable: `peer-${command.id}`,
          ...(command.obsolete ? { obsolete: `old field` } : {}),
        }
        const operation =
          command.operation ?? (expected.has(row.id) ? `update` : `insert`)
        applyPublicationCommandToModel(expected, command, row, operation)
        const rowReadsBeforeNotice = f.durableRowReadCount()
        const revision = await peer.publish(
          f,
          row,
          command.deleted,
          command.fullReload,
          operation,
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
              expect(f.durableRowReadCount()).toBeGreaterThan(
                rowReadsBeforeNotice,
              ),
            { interval: 1 },
          )
        }
        expect(f.publicRows()).toEqual(expectedRows())
        f.record(`peer revision ${revision} settled`)
        const afterPeer = expectedRows()
        const peerExposures = f.exposures.slice(cut)
        expectWholeRecoveryTrace(peerExposures, [before, afterPeer])
        if (!isDeepStrictEqual(before, afterPeer)) {
          expect(
            peerExposures.some(
              ({ cut: eventCut, rows }) =>
                eventCut === `event` && isDeepStrictEqual(rows, afterPeer),
            ),
          ).toBe(true)
        }
        checkpoint = `stream delta after ${JSON.stringify(command)}`
        const streamCut = f.exposures.length
        f.record(`before stream revision ${revision}`)
        subscribers[0]!([
          change(`update`, { id: row.id, name: `stream` }),
          upToDate,
        ])
        if (!command.deleted) applyStreamUpdateToModel(expected, row.id)
        f.record(`after stream revision ${revision}`)
        expect(f.publicRows()).toEqual(expectedRows())
        await vi.waitFor(
          () => expect(f.durableRows()).toEqual(expectedRows()),
          { interval: 1 },
        )
        const streamExposures = f.exposures.slice(streamCut)
        expectWholeRecoveryTrace(streamExposures, [afterPeer, expectedRows()])
        if (!isDeepStrictEqual(afterPeer, expectedRows())) {
          expect(
            streamExposures.some(
              ({ cut: eventCut, rows }) =>
                eventCut === `event` && isDeepStrictEqual(rows, expectedRows()),
            ),
          ).toBe(true)
        }
      }
    } catch (error) {
      throw new Error(
        `Electric publication history violation. checkpoint=${checkpoint} history=${JSON.stringify(commands)}`,
        { cause: error },
      )
    }
  })
}

function expectedReplacementRows(empty: boolean): Array<Item> {
  return empty ? [] : [freshRow]
}

declareOracle({
  check: [observePersistedRestart, assertPublicationHistory],
  model: [
    expectedPostRestartObservation,
    expectedDurableRow,
    applyPublicationCommandToModel,
    applyStreamUpdateToModel,
    expectedReplacementRows,
  ],
  grammar: [publicationHistoryArbitrary],
})

describe(`persisted Electric recovery laws`, () => {
  // The Map adapter is the driver's durable boundary. It must enact SQLite's
  // distinct row operations before its rows can serve as evidence for a peer
  // notice. Insert replaces a same-key row; update retains omitted fields.
  it.each([`insert`, `update`] as const)(
    `models a same-key %s against the durable row operation`,
    async (operation) => {
      const f = fixture(`on-demand`)
      await withFixtureCleanup(f, async () => {
        const old = { ...freshRow, obsolete: `old field` }
        await f.commitExternalTx({
          txId: `old`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [{ type: `insert`, key: old.id, value: old }],
        })
        const next = { ...freshRow, name: `next` }
        await f.commitExternalTx({
          txId: `next`,
          term: 2,
          seq: 1,
          rowVersion: 2,
          mutations: [{ type: operation, key: next.id, value: next }],
        })
        expect(f.rows.get(next.id)).toEqual(
          expectedDurableRow(operation, old, next),
        )
      })
    },
  )
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

  const publicationHistoryExamples: Array<[Array<PublicationHistoryCommand>]> =
    [
      [[{ id: 2, name: ``, deleted: false, fullReload: false }]],
      [
        [
          { id: 2, name: `external`, deleted: false, fullReload: false },
          { id: 2, name: `removed`, deleted: true, fullReload: true },
        ],
      ],
      [
        [
          {
            id: 2,
            name: `with field`,
            deleted: false,
            fullReload: false,
            operation: `insert`,
            obsolete: true,
          },
          {
            id: 2,
            name: `replacement`,
            deleted: false,
            fullReload: true,
            operation: `insert`,
            obsolete: false,
          },
        ],
      ],
      [
        [
          { id: 4, name: `abcdefgh`, deleted: false, fullReload: true },
          { id: 2, name: `two`, deleted: false, fullReload: false },
          { id: 4, name: `changed`, deleted: false, fullReload: false },
          { id: 2, name: `gone`, deleted: true, fullReload: false },
          { id: 3, name: `three`, deleted: false, fullReload: true },
          { id: 4, name: `gone`, deleted: true, fullReload: true },
          { id: 2, name: `again`, deleted: false, fullReload: false },
          { id: 3, name: `last`, deleted: false, fullReload: true },
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
      await withFixtureCleanup(
        f,
        async () => {
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
          const expected = expectedReplacementRows(empty)
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
          const rowFailures: Array<unknown> = []
          try {
            expect(f.publicRows()).toEqual(expected)
          } catch (error) {
            rowFailures.push(
              new Error(`Public replacement rows differ`, { cause: error }),
            )
          }
          try {
            expect(f.durableRows()).toEqual(expected)
          } catch (error) {
            rowFailures.push(
              new Error(`Durable replacement rows differ`, { cause: error }),
            )
          }
          if (rowFailures.length > 0) {
            throw new AggregateError(
              rowFailures,
              `Replacement-ready row mismatch`,
            )
          }
          f.record(`replacement ready`)
          expectWholeRecoveryTrace(f.exposures.slice(recoveryCut), [
            [],
            [oldRow],
            expected,
          ])
        },
        gate.resolve,
      )
    },
  )
})

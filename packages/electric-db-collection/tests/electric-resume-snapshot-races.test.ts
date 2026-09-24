import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import {
  SQLiteCorePersistenceAdapter,
  createPersistedTableName,
  persistedCollectionOptions,
} from '../../db-sqlite-persistence-core/src'
import { electricCollectionOptions } from '../src/electric'
import type { Message, Row } from '@electric-sql/client'
import type { Collection } from '@tanstack/db'
import type {
  PersistenceAdapter,
  SQLiteDriver,
} from '../../db-sqlite-persistence-core/src'
import type { ElectricCollectionUtils } from '../src/electric'

type Item = Row & { id: number; name: string }
type Subscriber = (messages: Array<Message<Item>>) => void

const subscribers: Array<Subscriber> = []
let synchronousMessages: Array<Message<Item>> | undefined
const mockSubscribe = vi.fn((subscriber: Subscriber) => {
  subscribers.push(subscriber)
  if (synchronousMessages) subscriber(synchronousMessages)
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

function toBinding(value: unknown): string | number | bigint | null {
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

function createDriver(database: DatabaseSync): SQLiteDriver {
  const driver: SQLiteDriver = {
    exec: (sql) => {
      database.exec(sql)
      return Promise.resolve()
    },
    query: (sql, params = []) =>
      Promise.resolve(
        database
          .prepare(sql)
          .all(...params.map(toBinding))
          .map((row) => ({ ...row })) as Array<never>,
      ),
    run: (sql, params = []) => {
      database.prepare(sql).run(...params.map(toBinding))
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

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

async function reachCheckpoint<T>(
  promise: Promise<T>,
  checkpoint: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Did not reach checkpoint: ${checkpoint}`)),
          1_000,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function change(
  operation: `insert` | `update` | `delete`,
  value: Item,
): Message<Item> {
  return { key: String(value.id), value, headers: { operation } }
}

async function runRace(
  transition:
    | `none`
    | `external-row-loss`
    | `schema-reset`
    | `committed-write`
    | `committed-replacement`,
  syncMode: `eager` | `on-demand` = `eager`,
  legacyUnknown = false,
  missingKeySetEvidence = false,
  startupReset: `none` | `tag-state` | `shape-identity` = `none`,
  metadataWrapper: `none` | `shallow-persistence` = `none`,
  laterKeySetEvidence:
    | `unchanged`
    | `unknown`
    | `missing`
    | `incompatible` = `unchanged`,
): Promise<void> {
  const database = new DatabaseSync(`:memory:`)
  const driver = createDriver(database)
  const collectionId =
    `resume-snapshot-${syncMode}-${transition}-` +
    `${legacyUnknown}-${missingKeySetEvidence}-${startupReset}`
  const laterSnapshotEntered = deferred()
  const releaseLaterSnapshot = deferred()
  let collection:
    | Collection<Item, string | number, ElectricCollectionUtils<Item>>
    | undefined
  let unsubscribe: (() => void) | undefined
  let receivedPersistenceCapability: unknown
  let forwardedPersistenceCapability: unknown
  let getExpectedCommitCallCount = () => 0
  let primaryFailure: unknown
  const cleanupFailures: Array<unknown> = []
  try {
    const seedAdapter = new SQLiteCorePersistenceAdapter({
      driver,
      schemaVersion: 1,
    })
    await seedAdapter.applyCommittedTx(collectionId, {
      txId: `seed`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [
        { type: `insert`, key: 1, value: { id: 1, name: `one` } },
        { type: `insert`, key: 2, value: { id: 2, name: `two` } },
      ],
      collectionMetadataMutations: [
        {
          type: `set`,
          key: `electric:resume`,
          value: {
            kind: `resume`,
            requiresTagState: startupReset === `tag-state`,
            offset: `10_0`,
            handle: `shape-old`,
            shapeId:
              startupReset === `shape-identity`
                ? `{"params":{"table":"other_table"},"url":"http://test-url"}`
                : `{"params":{"table":"test_table"},"url":"http://test-url"}`,
            updatedAt: 1,
          },
        },
      ],
    })
    if (legacyUnknown) {
      if (syncMode !== `on-demand`) {
        const tableName = createPersistedTableName(collectionId, `c`)
        await driver.run(
          `DELETE FROM "${tableName}" WHERE json_extract(value, '$.id') = ?`,
          [1],
        )
      }
      await driver.run(
        `UPDATE collection_version SET key_set_evidence_available = 0 WHERE collection_id = ?`,
        [collectionId],
      )
      await driver.run(
        `DELETE FROM collection_expected_keys WHERE collection_id = ?`,
        [collectionId],
      )
      expect(
        (await seedAdapter.loadResumeSnapshot(collectionId)).keySet,
      ).toEqual({ status: `unknown` })
    }

    const restartedAdapter = new SQLiteCorePersistenceAdapter({
      driver,
      schemaVersion: 1,
    })
    let durableObserverAdapter = restartedAdapter
    let snapshotCalls = 0
    let laterSnapshotIncludedRows: boolean | undefined
    let resumeStateAtLaterSnapshot: unknown
    let reportReceiverFailure!: (error: Error) => void
    const receiverFailure = new Promise<Error>((resolve) => {
      reportReceiverFailure = resolve
    })
    const gatedAdapter = new Proxy(restartedAdapter, {
      get(target, property) {
        if (property === `loadResumeSnapshot`) {
          return async function (
            this: PersistenceAdapter,
            ...args: Parameters<typeof target.loadResumeSnapshot>
          ) {
            if (this !== gatedAdapter) {
              const error = new Error(
                `Persistence adapter lost its receiver during resume certification`,
              )
              reportReceiverFailure(error)
              throw error
            }
            snapshotCalls++
            const isLaterSnapshot = snapshotCalls > 1
            if (isLaterSnapshot) {
              laterSnapshotIncludedRows = args[1]?.includeRows
              if (startupReset !== `none`) {
                resumeStateAtLaterSnapshot = (
                  await target.loadCollectionMetadata(collectionId)
                ).find(({ key }) => key === `electric:resume`)?.value
              }
              laterSnapshotEntered.resolve()
              await releaseLaterSnapshot.promise
            }
            const snapshot = await target.loadResumeSnapshot(...args)
            if (isLaterSnapshot && laterKeySetEvidence !== `unchanged`) {
              return {
                ...snapshot,
                keySet:
                  laterKeySetEvidence === `unknown`
                    ? { status: `unknown` as const }
                    : laterKeySetEvidence === `incompatible`
                      ? { status: `incompatible` as const }
                      : undefined,
              }
            }
            return missingKeySetEvidence
              ? { ...snapshot, keySet: undefined }
              : snapshot
          }
        }
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === `function` ? value.bind(target) : value
      },
    }) as unknown as PersistenceAdapter

    const electricOptions = electricCollectionOptions<Item>({
      id: collectionId,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      syncMode,
      getKey: (row) => row.id,
      startSync: false,
    })
    const electricSync = electricOptions.sync
    const wrappedElectricOptions =
      metadataWrapper === `shallow-persistence`
        ? {
            ...electricOptions,
            sync: {
              ...electricSync,
              sync: (params: Parameters<typeof electricSync.sync>[0]) => {
                const sourceMetadata = params.metadata
                const persistence = sourceMetadata?.persistence
                if (!sourceMetadata || !persistence) {
                  throw new Error(`Expected a persistence resume capability`)
                }

                receivedPersistenceCapability = persistence
                const expectedCommit = vi.spyOn(
                  persistence.resumeSnapshot,
                  `expectCurrentCommit`,
                )
                getExpectedCommitCallCount = () =>
                  expectedCommit.mock.calls.length

                const metadata = {
                  ...sourceMetadata,
                  persistence,
                }
                forwardedPersistenceCapability = metadata.persistence
                return electricSync.sync({ ...params, metadata })
              },
            },
          }
        : electricOptions

    collection = createCollection(
      persistedCollectionOptions<
        Item,
        string | number,
        never,
        ElectricCollectionUtils<Item>
      >({
        ...wrappedElectricOptions,
        persistence: { adapter: gatedAdapter },
      }),
    )

    let publications = 0
    if (startupReset !== `none`) {
      synchronousMessages = [
        change(`insert`, { id: 1, name: `one` }),
        change(`insert`, { id: 2, name: `two` }),
        { headers: { control: `up-to-date` } },
      ]
    }
    collection.startSyncImmediate()
    const readiness = collection.stateWhenReady()
    void readiness.catch(() => undefined)
    const subscription = collection.subscribeChanges(
      () => {
        publications++
      },
      { includeInitialState: false },
    )
    unsubscribe = () => subscription.unsubscribe()
    await reachCheckpoint(
      Promise.race([
        laterSnapshotEntered.promise,
        receiverFailure.then((error) => {
          throw error
        }),
      ]),
      `${syncMode} resume reached its second atomic snapshot`,
    )
    await vi.waitFor(() => expect(subscribers).toHaveLength(1))
    const subscriber = subscribers[0]!
    const request = vi.mocked(ShapeStream).mock.calls[0]![0] as {
      offset?: string
      handle?: string
    }
    const replacesUncertifiedBaseline =
      legacyUnknown || missingKeySetEvidence || startupReset !== `none`
    if (startupReset !== `none`) {
      expect(resumeStateAtLaterSnapshot).toMatchObject({ kind: `reset` })
    }
    if (metadataWrapper === `shallow-persistence`) {
      expect(forwardedPersistenceCapability).toBe(receivedPersistenceCapability)
      expect(getExpectedCommitCallCount()).toBe(1)
    }

    if (startupReset === `none`) {
      subscriber(
        request.offset === undefined
          ? [
              change(`insert`, { id: 1, name: `one` }),
              change(`insert`, { id: 2, name: `two` }),
              { headers: { control: `up-to-date` } },
            ]
          : transition === `none`
            ? [{ headers: { control: `up-to-date` } }]
            : [
                change(`update`, { id: 2, name: `new-two` }),
                { headers: { control: `up-to-date` } },
              ],
      )
    }
    if (transition === `external-row-loss`) {
      const tableName = createPersistedTableName(collectionId, `c`)
      await driver.run(
        `DELETE FROM "${tableName}" WHERE json_extract(value, '$.id') = ?`,
        [1],
      )
    } else if (transition === `schema-reset`) {
      const resettingAdapter = new SQLiteCorePersistenceAdapter({
        driver,
        schemaVersion: 2,
      })
      await resettingAdapter.loadSubset(collectionId, {})
      durableObserverAdapter = resettingAdapter
    } else if (transition === `committed-write`) {
      await seedAdapter.applyCommittedTx(collectionId, {
        txId: `concurrent-writer`,
        term: 1,
        seq: 2,
        rowVersion: 2,
        mutations: [
          { type: `insert`, key: 3, value: { id: 3, name: `three` } },
        ],
      })
    } else if (transition === `committed-replacement`) {
      await seedAdapter.applyCommittedTx(collectionId, {
        txId: `concurrent-replacement`,
        term: 2,
        seq: 1,
        rowVersion: 2,
        truncate: true,
        mutations: [
          { type: `insert`, key: 1, value: { id: 1, name: `one` } },
          { type: `insert`, key: 2, value: { id: 2, name: `two` } },
        ],
      })
    }
    releaseLaterSnapshot.resolve()

    if (transition === `none` || replacesUncertifiedBaseline) {
      await vi.waitFor(() => expect(collection!.status).toBe(`ready`))
      expect(
        Array.from(collection.values(), ({ id, name }) => ({ id, name })),
      ).toEqual(
        replacesUncertifiedBaseline
          ? [
              { id: 1, name: `one` },
              { id: 2, name: `two` },
            ]
          : [],
      )
      expect(
        (await durableObserverAdapter.loadSubset(collectionId, {})).map(
          ({ value }) => value,
        ),
      ).toEqual([
        { id: 1, name: `one` },
        { id: 2, name: `two` },
      ])
      if (startupReset !== `none`) {
        await vi.waitFor(async () => {
          const resumeState = (
            await durableObserverAdapter.loadCollectionMetadata(collectionId)
          ).find(({ key }) => key === `electric:resume`)?.value
          expect(resumeState).toMatchObject({
            kind: `resume`,
            offset: `20_0`,
            handle: `shape-current`,
          })
        })
      }
    } else {
      await vi.waitFor(() => expect(collection!.status).toBe(`error`))
      await expect(readiness).rejects.toBe(collection._lifecycle.getSyncError())
      if (laterKeySetEvidence !== `unchanged`) {
        expect(collection._lifecycle.getSyncError()).toEqual(
          expect.objectContaining({
            message:
              syncMode === `on-demand`
                ? `Electric persisted resume baseline could not be certified`
                : `Electric persisted resume baseline could not be certified during hydration`,
          }),
        )
      }
      await vi.waitFor(async () => {
        const metadata =
          await durableObserverAdapter.loadCollectionMetadata(collectionId)
        const resumeState = metadata.find(
          ({ key }) => key === `electric:resume`,
        )?.value
        if (transition === `schema-reset`) {
          // The atomic SQLite reset already removed the stale cursor. A stale
          // adapter must not write another marker after the schema changed.
          expect(resumeState).toBeUndefined()
        } else {
          expect(resumeState).toMatchObject({ kind: `reset` })
        }
      })
      // The persisted wrapper can apply the held baseline before Electric
      // observes that its evidence was downgraded. Safety here means startup
      // fails and never applies or publishes the queued stream batches.
      const expectedErroredRows =
        transition === `external-row-loss` &&
        laterKeySetEvidence !== `unchanged` &&
        syncMode !== `on-demand`
          ? [{ id: 2, name: `two` }]
          : []
      expect(
        Array.from(collection.values(), ({ id, name }) => ({ id, name })),
      ).toEqual(expectedErroredRows)
      expect(collection.status).not.toBe(`ready`)
      const publicationsBeforeLateDelivery = publications
      if (laterKeySetEvidence === `unchanged`) {
        expect(publicationsBeforeLateDelivery).toBe(0)
      }
      const durableRowsBeforeLateDelivery =
        await durableObserverAdapter.loadSubset(collectionId, {})
      expect(durableRowsBeforeLateDelivery.map(({ value }) => value)).toEqual(
        transition === `external-row-loss`
          ? [{ id: 2, name: `two` }]
          : transition === `committed-write`
            ? [
                { id: 1, name: `one` },
                { id: 2, name: `two` },
                { id: 3, name: `three` },
              ]
            : transition === `committed-replacement`
              ? [
                  { id: 1, name: `one` },
                  { id: 2, name: `two` },
                ]
              : [],
      )
      subscriber([
        change(`insert`, { id: 9, name: `late` }),
        { headers: { control: `up-to-date` } },
      ])
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(
        Array.from(collection.values(), ({ id, name }) => ({ id, name })),
      ).toEqual(expectedErroredRows)
      expect(await durableObserverAdapter.loadSubset(collectionId, {})).toEqual(
        durableRowsBeforeLateDelivery,
      )
      expect(publications).toBe(publicationsBeforeLateDelivery)
    }
    if (replacesUncertifiedBaseline) {
      expect(request.offset).toBeUndefined()
      expect(request.handle).toBeUndefined()
    } else {
      expect(request).toMatchObject({ offset: `10_0`, handle: `shape-old` })
    }
    expect(laterSnapshotIncludedRows).toBe(
      replacesUncertifiedBaseline || syncMode !== `on-demand`,
    )
  } catch (error) {
    primaryFailure = error
  } finally {
    releaseLaterSnapshot.resolve()
    try {
      unsubscribe?.()
    } catch (error) {
      cleanupFailures.push(error)
    }
    try {
      if (collection) {
        await reachCheckpoint(
          collection.cleanup(),
          `Electric race collection cleanup`,
        )
      }
    } catch (error) {
      cleanupFailures.push(error)
    }
    try {
      database.close()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }

  if (primaryFailure !== undefined) {
    const failure =
      primaryFailure instanceof Error
        ? primaryFailure
        : new Error(`Resume snapshot race failed`, { cause: primaryFailure })
    if (cleanupFailures.length > 0) {
      Object.defineProperty(failure, `cleanupFailures`, {
        value: cleanupFailures,
        enumerable: true,
      })
    }
    throw failure
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, `Resume snapshot cleanup failed`)
  }
}

type LegacyUnknownResumeObservation = {
  checkpoint: `post-restart-up-to-date`
  migratedKeySet: { status: `unknown` | `consistent` | `incompatible` }
  migratedRows: Array<Item>
  requestedOffset: string | undefined
  requestedHandle: string | undefined
  sourceDelivery: Array<Item>
  publicRows: Array<Item>
  durableRows: Array<Item>
  status: string
}

async function observeLegacyUnknownResume(): Promise<LegacyUnknownResumeObservation> {
  const database = new DatabaseSync(`:memory:`)
  const driver = createDriver(database)
  const collectionId = `legacy-loss-fixed-witness`
  const rowLostBeforeMigration: Item = {
    id: 1,
    name: `lost-before-ledger`,
  }
  const survivingRow: Item = { id: 2, name: `survivor` }
  const postOffsetRow: Item = { id: 3, name: `post-offset` }
  const canonicalSourceSnapshot = [
    rowLostBeforeMigration,
    survivingRow,
    postOffsetRow,
  ]
  let collection:
    | Collection<Item, string | number, ElectricCollectionUtils<Item>>
    | undefined
  let unsubscribe: (() => void) | undefined
  let observation: LegacyUnknownResumeObservation | undefined
  let primaryFailure: unknown
  const cleanupFailures: Array<unknown> = []

  try {
    // Produce the persisted row/metadata encodings through the real adapter,
    // then reduce only the key-evidence schema to its pre-ledger form.
    const legacyAdapter = new SQLiteCorePersistenceAdapter({ driver })
    await legacyAdapter.applyCommittedTx(collectionId, {
      txId: `legacy-snapshot-at-10`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [rowLostBeforeMigration, survivingRow].map((row) => ({
        type: `insert` as const,
        key: row.id,
        value: structuredClone(row),
      })),
      collectionMetadataMutations: [
        {
          type: `set`,
          key: `electric:resume`,
          value: {
            kind: `resume`,
            requiresTagState: false,
            offset: `10_0`,
            handle: `shape-old`,
            shapeId: `{"params":{"table":"test_table"},"url":"http://test-url"}`,
            updatedAt: 1,
          },
        },
      ],
    })

    const collectionTable = createPersistedTableName(collectionId, `c`)
    await driver.run(
      `DELETE FROM "${collectionTable}" WHERE json_extract(value, '$.id') = ?`,
      [rowLostBeforeMigration.id],
    )
    await driver.exec(
      `DROP TRIGGER "${collectionTable}_key_evidence_insert";
       DROP TRIGGER "${collectionTable}_key_evidence_delete";
       DROP TRIGGER "${collectionTable}_key_evidence_update"`,
    )
    await driver.exec(`DROP TABLE collection_expected_keys`)
    await driver.exec(
      `ALTER TABLE collection_version RENAME TO collection_version_with_ledger`,
    )
    await driver.exec(
      `CREATE TABLE collection_version (
         collection_id TEXT PRIMARY KEY,
         latest_row_version INTEGER NOT NULL
       )`,
    )
    await driver.exec(
      `INSERT INTO collection_version (collection_id, latest_row_version)
       SELECT collection_id, latest_row_version
       FROM collection_version_with_ledger`,
    )
    await driver.exec(`DROP TABLE collection_version_with_ledger`)

    const migratedAdapter = new SQLiteCorePersistenceAdapter({ driver })
    const migratedSnapshot =
      await migratedAdapter.loadResumeSnapshot(collectionId)

    collection = createCollection(
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
        persistence: { adapter: migratedAdapter },
      }),
    )
    collection.startSyncImmediate()
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    unsubscribe = () => subscription.unsubscribe()

    await vi.waitFor(() => expect(subscribers).toHaveLength(1))
    const request = vi.mocked(ShapeStream).mock.calls[0]![0] as {
      offset?: string
      handle?: string
    }
    // The source obeys the request: a resume receives only changes after its
    // cursor; a fresh request receives the independently specified snapshot.
    const sourceDelivery =
      request.offset === undefined
        ? canonicalSourceSnapshot.map((row) => structuredClone(row))
        : [structuredClone(postOffsetRow)]
    subscribers[0]!([
      ...sourceDelivery.map((row) => change(`insert`, structuredClone(row))),
      { headers: { control: `up-to-date` } },
    ])

    await vi.waitFor(() => expect(collection!.status).toBe(`ready`))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    observation = {
      checkpoint: `post-restart-up-to-date`,
      migratedKeySet: migratedSnapshot.keySet,
      migratedRows: migratedSnapshot.rows
        .map(({ value }) => value as Item)
        .sort((left, right) => left.id - right.id),
      requestedOffset: request.offset,
      requestedHandle: request.handle,
      sourceDelivery,
      publicRows: Array.from(collection.values(), ({ id, name }) => ({
        id,
        name,
      })).sort((left, right) => left.id - right.id),
      durableRows: (await migratedAdapter.loadSubset(collectionId, {}))
        .map(({ value }) => value as Item)
        .sort((left, right) => left.id - right.id),
      status: collection.status,
    }
  } catch (error) {
    primaryFailure = error
  } finally {
    try {
      unsubscribe?.()
    } catch (error) {
      cleanupFailures.push(error)
    }
    try {
      await collection?.cleanup()
    } catch (error) {
      cleanupFailures.push(error)
    }
    try {
      database.close()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }

  if (primaryFailure !== undefined) {
    const failure =
      primaryFailure instanceof Error
        ? primaryFailure
        : new Error(`Legacy resume witness failed`, { cause: primaryFailure })
    if (cleanupFailures.length > 0) {
      Object.defineProperty(failure, `cleanupFailures`, {
        value: cleanupFailures,
        enumerable: true,
      })
    }
    throw failure
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures,
      `Legacy resume witness cleanup failed`,
    )
  }
  if (!observation) {
    throw new Error(`Legacy resume witness did not capture an observation`)
  }
  return observation
}

/**
 * # Which persisted baseline may Electric resume from during startup races?
 *
 * The persisted resume law requires the rows, resume metadata, stream position,
 * and key-set evidence used for certification to belong to one atomic baseline
 * generation. An unverifiable, externally changed, or reset baseline must start
 * a fresh source snapshot; a compatible baseline may retain its resume cursor.
 * This refines the settled recovery law in electric-recovery-oracle.test.ts and
 * the atomic `loadResumeSnapshot` persistence contract.
 *
 * The reference is the small baseline tuple captured by each case: generation,
 * complete key set, resume state, and expected source delivery. Legal histories
 * vary eager versus on-demand sync, compatible versus unknown legacy evidence,
 * startup reset cause, and row loss, schema reset, or committed write between
 * the initial metadata read and certification. No production classifier or SQL
 * helper computes the expected public and durable rows.
 *
 * The production driver uses `SQLiteCorePersistenceAdapter`, the persisted
 * Collection wrapper, and `electricCollectionOptions`. It holds the adapter's
 * later atomic snapshot, injects the selected transition, then compares the
 * ShapeStream offset/handle plus complete public and durable rows at the
 * post-restart up-to-date checkpoint. Entering the held snapshot is the reach
 * witness; compatible and legacy-unknown controls challenge both resume and
 * fresh-snapshot branches.
 *
 * These deterministic schedules do not model arbitrary external SQL edits,
 * native SQLite hosts, or a live Electric service. Those require their separate
 * persistence-driver and real-provider owners.
 */
describe(`Electric resume snapshot races`, () => {
  beforeEach(() => {
    subscribers.length = 0
    synchronousMessages = undefined
    vi.clearAllMocks()
  })

  it(`keeps a healthy tagged cache when a fresh reset commits before hydration`, async () => {
    await runRace(`none`, `eager`, false, false, `tag-state`)
  })

  it(`keeps a healthy cache when a changed shape commits its reset before hydration`, async () => {
    await runRace(`none`, `eager`, false, false, `shape-identity`)
  })

  it(`keeps generation ownership when a source wrapper shallow-forwards the persistence capability`, async () => {
    await runRace(
      `none`,
      `eager`,
      false,
      false,
      `shape-identity`,
      `shallow-persistence`,
    )
  })

  it(`rejects row loss between resume metadata and baseline hydration`, async () => {
    await runRace(`external-row-loss`)
  })

  it(`rejects a schema reset between resume metadata and baseline hydration`, async () => {
    await runRace(`schema-reset`)
  })

  it(`conservatively rejects a committed write between startup snapshots`, async () => {
    await runRace(`committed-write`)
  })

  it.each([
    [`eager`, `unknown`],
    [`eager`, `missing`],
    [`on-demand`, `unknown`],
    [`on-demand`, `missing`],
  ] as const)(
    `rejects row loss when %s resume evidence becomes %s`,
    async (syncMode, laterKeySetEvidence) => {
      await runRace(
        `external-row-loss`,
        syncMode,
        false,
        false,
        `none`,
        `none`,
        laterKeySetEvidence,
      )
    },
  )

  it(`freshly replaces an unknown on-demand resume baseline`, async () => {
    await runRace(`none`, `on-demand`, true)
  })

  it(`freshly replaces an unknown eager resume baseline`, async () => {
    await runRace(`none`, `eager`, true)
  })

  it(`freshly replaces a resume when snapshot evidence is missing`, async () => {
    await runRace(`none`, `eager`, false, true)
  })

  it(`rejects row loss during on-demand resume certification`, async () => {
    await runRace(`external-row-loss`, `on-demand`)
  })

  it.each(
    ([`eager`, `on-demand`] as const).flatMap((syncMode) =>
      ([`unknown`, `missing`] as const).flatMap((initialEvidence) =>
        ([`external-row-loss`, `committed-replacement`] as const).map(
          (transition) => ({ syncMode, initialEvidence, transition }),
        ),
      ),
    ),
  )(
    `freshly replaces a $initialEvidence $syncMode baseline across $transition`,
    async ({ syncMode, initialEvidence, transition }) => {
      await runRace(
        transition,
        syncMode,
        initialEvidence === `unknown`,
        initialEvidence === `missing`,
        `none`,
        `none`,
        transition === `external-row-loss` ? `incompatible` : `unchanged`,
      )
    },
  )

  it(`freshly replaces an unverifiable pre-ledger resume baseline`, async () => {
    const observation = await observeLegacyUnknownResume()
    expect(observation).toEqual({
      checkpoint: `post-restart-up-to-date`,
      migratedKeySet: { status: `unknown` },
      migratedRows: [{ id: 2, name: `survivor` }],
      requestedOffset: undefined,
      requestedHandle: undefined,
      sourceDelivery: [
        { id: 1, name: `lost-before-ledger` },
        { id: 2, name: `survivor` },
        { id: 3, name: `post-offset` },
      ],
      publicRows: [
        { id: 1, name: `lost-before-ledger` },
        { id: 2, name: `survivor` },
        { id: 3, name: `post-offset` },
      ],
      durableRows: [
        { id: 1, name: `lost-before-ledger` },
        { id: 2, name: `survivor` },
        { id: 3, name: `post-offset` },
      ],
      status: `ready`,
    })
  })
})

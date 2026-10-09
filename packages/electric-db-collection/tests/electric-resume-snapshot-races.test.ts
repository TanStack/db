import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IR, createCollection } from '@tanstack/db'
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
  HydrationPersistenceAdapter,
  PersistenceAdapter,
  SQLiteDriver,
} from '../../db-sqlite-persistence-core/src'
import type { ElectricCollectionUtils } from '../src/electric'

type Item = Row & { id: number; name: string }
type Subscriber = (messages: Array<Message<Item>>) => void

const subscribers: Array<Subscriber> = []
let synchronousMessages: Array<Message<Item>> | undefined
let snapshotRequest: (() => Promise<void>) | undefined
const mockSubscribe = vi.fn((subscriber: Subscriber) => {
  subscribers.push(subscriber)
  if (synchronousMessages) subscriber(synchronousMessages)
  return vi.fn()
})

vi.mock(`@electric-sql/client`, async () => ({
  ...(await vi.importActual(`@electric-sql/client`)),
  ShapeStream: vi.fn(() => ({
    subscribe: mockSubscribe,
    requestSnapshot: vi.fn(() => snapshotRequest?.() ?? Promise.resolve()),
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
  timeoutMs = 1_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Did not reach checkpoint: ${checkpoint}`)),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function reportReceivingOutcome(
  primaryFailure: unknown,
  cleanupFailures: Array<unknown>,
  context: string,
): void {
  if (primaryFailure !== undefined) {
    const failure =
      primaryFailure instanceof Error
        ? primaryFailure
        : new Error(`${context} failed`, { cause: primaryFailure })
    if (cleanupFailures.length > 0) {
      Object.defineProperty(failure, `cleanupFailures`, {
        value: cleanupFailures,
        enumerable: true,
      })
    }
    throw failure
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, `${context} cleanup failed`)
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
    `unchanged` | `unknown` | `missing` | `incompatible` = `unchanged`,
  forwardHydrationScope = false,
): Promise<void> {
  const database = new DatabaseSync(`:memory:`)
  const driver = createDriver(database)
  const collectionId =
    `resume-snapshot-${syncMode}-${transition}-` +
    `${legacyUnknown}-${missingKeySetEvidence}-${startupReset}`
  const laterSnapshotEntered = deferred()
  const releaseLaterSnapshot = deferred()
  let collection:
    Collection<Item, string | number, ElectricCollectionUtils<Item>> | undefined
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
    const gateSnapshotAdapter = <TAdapter extends PersistenceAdapter>(
      adapter: TAdapter,
    ): TAdapter => {
      const gatedAdapter = new Proxy(adapter, {
        get(target, property) {
          // This owner exercises resume certification on adapters without
          // managed cache generations. Rotation has separate receiving tests.
          if (
            syncMode === `on-demand` &&
            (property === `claimCacheGeneration` ||
              property === `rotateCacheGeneration` ||
              property === `renewCacheGenerationClaim` ||
              property === `releaseCacheGenerationClaim` ||
              property === `assertCacheGenerationClaim`)
          ) {
            return undefined
          }
          if (property === `runInHydrationScope`) {
            // Exercise both an adapter without optional hydration scopes and
            // an adapter that forwards its scoped snapshot reads.
            if (!forwardHydrationScope || !target.runInHydrationScope) {
              return undefined
            }
            return <T>(
              task: (scopedAdapter: HydrationPersistenceAdapter) => Promise<T>,
            ): Promise<T> =>
              target.runInHydrationScope!((scopedAdapter) =>
                task(gateSnapshotAdapter(scopedAdapter)),
              )
          }
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
                  if (!target.loadCollectionMetadata) {
                    throw new Error(
                      `Expected collection metadata in snapshot scope`,
                    )
                  }
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
      })
      return gatedAdapter
    }
    const gatedAdapter = gateSnapshotAdapter(restartedAdapter)

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
    if (startupReset !== `none`) {
      // The marker write may commit before or after the held hydration read.
      // Neither schedule may invent a new resume cursor before the fresh
      // source snapshot. The request and final rows are checked above.
      if (
        typeof resumeStateAtLaterSnapshot !== `object` ||
        resumeStateAtLaterSnapshot === null ||
        !(`kind` in resumeStateAtLaterSnapshot)
      ) {
        throw new Error(`Expected the prior resume or reset marker`)
      }
      if (resumeStateAtLaterSnapshot.kind === `reset`) {
        expect(resumeStateAtLaterSnapshot).not.toHaveProperty(`offset`)
      } else {
        expect(resumeStateAtLaterSnapshot).toMatchObject({
          kind: `resume`,
          offset: `10_0`,
          handle: `shape-old`,
        })
      }
    }
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
    Collection<Item, string | number, ElectricCollectionUtils<Item>> | undefined
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
 * generation. An unverifiable, externally changed, or reset eager baseline
 * must start a fresh full source snapshot; a compatible baseline may retain
 * its resume cursor. Uncertified on-demand startup instead keeps durable rows
 * cache-only, starts changes-only at `now`, and loads only demanded subsets.
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
 * post-restart up-to-date checkpoint. The scoped driver holds its startup
 * metadata read, then checks no public cache rows before demand and exact row
 * 1 after its source snapshot applies. Entering each held read is its reach
 * witness; compatible and legacy-unknown controls challenge both resume and
 * fresh-source branches.
 *
 * These deterministic schedules do not model arbitrary external SQL edits,
 * native SQLite hosts, or a live Electric service. Those require their separate
 * persistence-driver and real-provider owners.
 */
describe(`Electric resume snapshot races`, () => {
  beforeEach(() => {
    subscribers.length = 0
    synchronousMessages = undefined
    snapshotRequest = undefined
    vi.clearAllMocks()
  })

  // The stored cursor is compatible with a warm peer but belongs to a
  // different Electric shape for the recovering run. The independent rule is
  // that each sync run's claim owns its durable writes: Electric's decision
  // cannot replace the peer's resume metadata, and an expired claim can only
  // rotate into private storage. The driver holds the real SQLite rotation
  // before its transaction, then after it returns but before public truncate.
  // A new demand crosses that second interval. At the
  // fresh subset's settlement cut, only the replacement row belongs to the
  // recovering Collection; the warm Collection, its rows, metadata, and the
  // current cache head retain the original generation. The ShapeStream mock
  // controls callback timing; Electric's classifier and SQLite are real.
  it(`keeps a warm cache authoritative when Electric recovery crosses expiry`, async () => {
    const database = new DatabaseSync(`:memory:`)
    const logicalId = `electric-expired-recovery`
    let now = Date.now()
    const adapter = new SQLiteCorePersistenceAdapter({
      driver: createDriver(database),
      cacheGenerationClaimTtlMs: 10_000,
      now: () => now,
    })
    const beforeRotation = deferred()
    const releaseBeforeRotation = deferred()
    const afterRotation = deferred()
    const releaseAfterRotation = deferred()
    const snapshotDone = deferred()
    const rotate = adapter.rotateCacheGeneration.bind(adapter)
    adapter.rotateCacheGeneration = async (...args) => {
      beforeRotation.resolve()
      await releaseBeforeRotation.promise
      const rotated = await rotate(...args)
      afterRotation.resolve()
      await releaseAfterRotation.promise
      return rotated
    }
    const oldRow: Item = { id: 1, name: `warm` }
    const freshRow: Item = { id: 2, name: `fresh` }
    const oldResume = {
      kind: `resume`,
      requiresTagState: false,
      offset: `10_0`,
      handle: `warm-shape`,
      shapeId: `{"params":{"table":"test_table"},"url":"http://test-url"}`,
      updatedAt: 1,
    }
    let warm: Collection<Item, number> | undefined
    let recovering:
      | Collection<Item, string | number, ElectricCollectionUtils<Item>>
      | undefined
    let laterClaimId: string | undefined
    let primaryFailure: unknown
    const cleanupFailures: Array<unknown> = []
    try {
      const seed = await adapter.claimCacheGeneration(logicalId)
      await adapter.applyCommittedTx(seed.storageCollectionId, {
        txId: `warm-seed`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        cacheGenerationClaimId: seed.claimId,
        mutations: [{ type: `insert`, key: oldRow.id, value: oldRow }],
        collectionMetadataMutations: [
          { type: `set`, key: `electric:resume`, value: oldResume },
        ],
      })
      await adapter.releaseCacheGenerationClaim(seed.claimId)
      warm = createCollection(
        persistedCollectionOptions<Item, number>({
          id: logicalId,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (source) => {
              source.markReady()
              return {
                restartAfterScopedRecovery: () => {},
                loadSubset: async () => {},
              }
            },
          },
          persistence: { adapter },
        }),
      )
      warm.startSyncImmediate()
      await reachCheckpoint(
        Promise.resolve(warm._sync.loadSubset({})),
        `warm cache load`,
      )
      expect(warm.get(oldRow.id)).toMatchObject(oldRow)
      const warmClaim = database
        .prepare(
          `SELECT claim_id, physical_id FROM cache_generation_claim
           WHERE logical_id = ?`,
        )
        .get(logicalId) as { claim_id: string; physical_id: string }

      const electric = electricCollectionOptions<Item>({
        id: logicalId,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `other_table` },
        },
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        startSync: false,
      })
      recovering = createCollection(
        persistedCollectionOptions<
          Item,
          string | number,
          never,
          ElectricCollectionUtils<Item>
        >({ ...electric, persistence: { adapter } }),
      )
      recovering.startSyncImmediate()
      await reachCheckpoint(
        beforeRotation.promise,
        `Electric recovery rotation`,
      )
      expect(vi.mocked(ShapeStream).mock.calls[0]?.[0]).toMatchObject({
        log: `changes_only`,
        offset: `now`,
      })
      const recoveringClaim = database
        .prepare(
          `SELECT claim_id, physical_id, expires_at_ms
           FROM cache_generation_claim
           WHERE logical_id = ? AND claim_id <> ?`,
        )
        .get(logicalId, warmClaim.claim_id) as {
        claim_id: string
        physical_id: string
        expires_at_ms: number
      }
      expect(recoveringClaim.physical_id).toBe(warmClaim.physical_id)
      expect(
        (
          await adapter.loadResumeSnapshot(warmClaim.physical_id, {
            cacheGenerationClaimId: warmClaim.claim_id,
          })
        ).collectionMetadata,
      ).toEqual([{ key: `electric:resume`, value: oldResume }])

      now += 9_000
      const warmExpiresAt = await adapter.renewCacheGenerationClaim(
        warmClaim.physical_id,
        warmClaim.claim_id,
      )
      now += 2_000
      expect(now).toBeGreaterThan(recoveringClaim.expires_at_ms)
      expect(now).toBeLessThan(warmExpiresAt!)
      releaseBeforeRotation.resolve()
      await reachCheckpoint(
        afterRotation.promise,
        `SQLite rotation before public truncate`,
      )
      expect(subscribers).toHaveLength(1)
      snapshotRequest = () => snapshotDone.promise
      const demand = Promise.resolve(recovering._sync.loadSubset({}))
      void demand.catch(() => undefined)
      let demandSettled = false
      void demand
        .finally(() => {
          demandSettled = true
        })
        .catch(() => undefined)
      await Promise.resolve()
      expect(demandSettled).toBe(false)

      releaseAfterRotation.resolve()
      await vi.waitFor(() => {
        const startup = vi.mocked(ShapeStream).mock.results[0]?.value as {
          requestSnapshot: ReturnType<typeof vi.fn>
        }
        expect(startup.requestSnapshot).toHaveBeenCalled()
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(demandSettled).toBe(false)
      expect(recovering.get(freshRow.id)).toBeUndefined()
      const privateClaim = database
        .prepare(
          `SELECT physical_id FROM cache_generation_claim WHERE claim_id = ?`,
        )
        .get(recoveringClaim.claim_id) as { physical_id: string }
      expect(privateClaim.physical_id).not.toBe(warmClaim.physical_id)
      expect(
        (
          await adapter.loadResumeSnapshot(privateClaim.physical_id, {
            cacheGenerationClaimId: recoveringClaim.claim_id,
          })
        ).rows,
      ).toEqual([])
      subscribers[0]!([
        change(`insert`, freshRow),
        { headers: { control: `subset-end` } },
      ])
      snapshotDone.resolve()
      await reachCheckpoint(demand, `fresh Electric subset settlement`)
      expect(Array.from(recovering.values(), ({ id }) => id)).toEqual([2])
      expect(Array.from(warm.values(), ({ id }) => id)).toEqual([1])
      const laterClaim = await adapter.claimCacheGeneration(logicalId)
      laterClaimId = laterClaim.claimId
      expect(laterClaim.storageCollectionId).toBe(warmClaim.physical_id)
      const privateSnapshot = await adapter.loadResumeSnapshot(
        privateClaim.physical_id,
        { cacheGenerationClaimId: recoveringClaim.claim_id },
      )
      const warmSnapshot = await adapter.loadResumeSnapshot(
        warmClaim.physical_id,
        { cacheGenerationClaimId: warmClaim.claim_id },
      )
      expect(privateSnapshot.rows.map(({ key }) => key)).toEqual([2])
      expect(privateSnapshot.collectionMetadata).toEqual([
        {
          key: `electric:resume`,
          value: expect.objectContaining({ kind: `reset` }),
        },
      ])
      expect(warmSnapshot.rows.map(({ key }) => key)).toEqual([1])
      expect(warmSnapshot.collectionMetadata).toEqual([
        { key: `electric:resume`, value: oldResume },
      ])
    } catch (error) {
      primaryFailure = error
    } finally {
      releaseBeforeRotation.resolve()
      releaseAfterRotation.resolve()
      snapshotDone.resolve()
      const cleanupTimeoutMs = primaryFailure === undefined ? 1_000 : 200
      for (const release of [
        () => recovering?.cleanup(),
        () => warm?.cleanup(),
        () =>
          laterClaimId
            ? adapter.releaseCacheGenerationClaim(laterClaimId)
            : undefined,
      ]) {
        try {
          const settling = release()
          if (settling) {
            await reachCheckpoint(
              settling,
              `Electric expiry cleanup`,
              cleanupTimeoutMs,
            )
          }
        } catch (error) {
          cleanupFailures.push(error)
        }
      }
      try {
        database.close()
      } catch (error) {
        cleanupFailures.push(error)
      }
    }
    reportReceivingOutcome(primaryFailure, cleanupFailures, `Electric expiry`)
  })

  // A later cache-claim expiry occurs after Electric has installed its
  // provider session restart callback. SQLite rotates first; public truncate
  // follows. The independent rule allows the old public snapshot until that
  // truncate, but a retired provider session cannot put a late row into the
  // new durable generation. A demand waiting in this interval must settle
  // from the replacement session's applied source snapshot. This is the
  // intermediate receiving cut omitted by the atomic authority model.
  it(`rejects a retired Electric callback between SQLite rotation and public truncate`, async () => {
    const database = new DatabaseSync(`:memory:`)
    const logicalId = `electric-post-rotation-gap`
    let now = Date.now()
    const adapter = new SQLiteCorePersistenceAdapter({
      driver: createDriver(database),
      cacheGenerationClaimTtlMs: 10_000,
      now: () => now,
    })
    const afterRotation = deferred()
    const releaseRotation = deferred()
    const snapshotDone = deferred()
    const secondSnapshotDone = deferred()
    const thirdSnapshotDone = deferred()
    const rotate = adapter.rotateCacheGeneration.bind(adapter)
    adapter.rotateCacheGeneration = async (...args) => {
      const rotated = await rotate(...args)
      afterRotation.resolve()
      await releaseRotation.promise
      return rotated
    }
    const oldRow: Item = { id: 1, name: `old cache row` }
    const freshRow: Item = { id: 2, name: `fresh source row` }
    const gapRow: Item = { id: 3, name: `gap demand row` }
    let collection:
      | Collection<Item, string | number, ElectricCollectionUtils<Item>>
      | undefined
    let primaryFailure: unknown
    const cleanupFailures: Array<unknown> = []
    try {
      const seed = await adapter.claimCacheGeneration(logicalId)
      await adapter.applyCommittedTx(seed.storageCollectionId, {
        txId: `old-row`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        cacheGenerationClaimId: seed.claimId,
        mutations: [{ type: `insert`, key: oldRow.id, value: oldRow }],
      })
      await adapter.releaseCacheGenerationClaim(seed.claimId)
      const electric = electricCollectionOptions<Item>({
        id: logicalId,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        startSync: false,
      })
      collection = createCollection(
        persistedCollectionOptions<
          Item,
          string | number,
          never,
          ElectricCollectionUtils<Item>
        >({ ...electric, persistence: { adapter } }),
      )
      collection.startSyncImmediate()
      await vi.waitFor(() => expect(subscribers).toHaveLength(1))
      subscribers[0]!([{ headers: { control: `up-to-date` } }])
      await vi.waitFor(() => expect(collection?.status).toBe(`ready`))
      await reachCheckpoint(
        Promise.resolve(collection._sync.loadSubset({})),
        `warm source cache load`,
      )
      expect(collection.get(oldRow.id)).toMatchObject(oldRow)
      const initialClaim = database
        .prepare(
          `SELECT claim_id, physical_id FROM cache_generation_claim
           WHERE logical_id = ?`,
        )
        .get(logicalId) as { claim_id: string; physical_id: string }

      now += 11_000
      let snapshotCount = 0
      snapshotRequest = () => {
        snapshotCount += 1
        return snapshotCount === 1
          ? snapshotDone.promise
          : snapshotCount === 2
            ? secondSnapshotDone.promise
            : thirdSnapshotDone.promise
      }
      const demand = Promise.resolve(
        collection._sync.loadSubset({
          where: new IR.Func(`eq`, [
            new IR.PropRef([`id`]),
            new IR.Value(freshRow.id),
          ]),
        }),
      )
      void demand.catch(() => undefined)
      let demandSettled = false
      void demand
        .finally(() => {
          demandSettled = true
        })
        .catch(() => undefined)
      await reachCheckpoint(afterRotation.promise, `expired SQLite rotation`)
      const privateClaim = database
        .prepare(
          `SELECT claim_id, physical_id FROM cache_generation_claim
           WHERE logical_id = ? AND physical_id <> ?`,
        )
        .get(logicalId, initialClaim.physical_id) as {
        claim_id: string
        physical_id: string
      }
      expect(privateClaim.physical_id).not.toBe(initialClaim.physical_id)
      expect(collection.get(oldRow.id)).toMatchObject(oldRow)
      const privateBeforeTruncate = await adapter.loadResumeSnapshot(
        privateClaim.physical_id,
        { cacheGenerationClaimId: privateClaim.claim_id },
      )
      expect(privateBeforeTruncate.rows).toEqual([])
      const gapDemand = Promise.resolve(
        collection._sync.loadSubset({
          where: new IR.Func(`eq`, [
            new IR.PropRef([`id`]),
            new IR.Value(gapRow.id),
          ]),
        }),
      )
      void gapDemand.catch(() => undefined)
      let gapDemandSettled = false
      void gapDemand
        .finally(() => {
          gapDemandSettled = true
        })
        .catch(() => undefined)
      const durableWrites = vi.spyOn(adapter, `applyCommittedTx`)
      subscribers[0]!([
        change(`insert`, { id: 9, name: `retired callback` }),
        { headers: { control: `subset-end` } },
      ])
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(demandSettled).toBe(false)
      expect(gapDemandSettled).toBe(false)
      expect(collection.get(9)).toBeUndefined()
      expect(durableWrites).not.toHaveBeenCalled()
      expect(
        (
          await adapter.loadResumeSnapshot(privateClaim.physical_id, {
            cacheGenerationClaimId: privateClaim.claim_id,
          })
        ).rows,
      ).toEqual([])

      releaseRotation.resolve()
      await vi.waitFor(() => expect(subscribers).toHaveLength(2))
      subscribers[0]!([
        change(`insert`, { id: 9, name: `retired callback` }),
        { headers: { control: `subset-end` } },
      ])
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(collection.get(9)).toBeUndefined()
      expect(
        (
          await adapter.loadResumeSnapshot(privateClaim.physical_id, {
            cacheGenerationClaimId: privateClaim.claim_id,
          })
        ).rows,
      ).toEqual([])
      await vi.waitFor(() => {
        const replacement = vi.mocked(ShapeStream).mock.results[1]?.value as {
          requestSnapshot: ReturnType<typeof vi.fn>
        }
        expect(replacement.requestSnapshot).toHaveBeenCalled()
      })
      expect(demandSettled).toBe(false)
      expect(gapDemandSettled).toBe(false)
      await vi.waitFor(() => {
        const replacement = vi.mocked(ShapeStream).mock.results[1]?.value as {
          requestSnapshot: ReturnType<typeof vi.fn>
        }
        expect(replacement.requestSnapshot).toHaveBeenCalledTimes(1)
        expect(
          replacement.requestSnapshot.mock.calls.map(([params]) => params),
        ).toMatchObject([{ params: {} }])
      })
      subscribers[1]!([{ headers: { control: `subset-end` } }])
      snapshotDone.resolve()
      await vi.waitFor(() => {
        const replacement = vi.mocked(ShapeStream).mock.results[1]?.value as {
          requestSnapshot: ReturnType<typeof vi.fn>
        }
        expect(replacement.requestSnapshot).toHaveBeenCalledTimes(2)
        expect(replacement.requestSnapshot.mock.calls[1]?.[0]).toMatchObject({
          params: { '1': `2` },
        })
      })
      subscribers[1]!([
        change(`insert`, freshRow),
        { headers: { control: `subset-end` } },
      ])
      secondSnapshotDone.resolve()
      await vi.waitFor(() => {
        const replacement = vi.mocked(ShapeStream).mock.results[1]?.value as {
          requestSnapshot: ReturnType<typeof vi.fn>
        }
        expect(replacement.requestSnapshot).toHaveBeenCalledTimes(3)
        expect(replacement.requestSnapshot.mock.calls[2]?.[0]).toMatchObject({
          params: { '1': `3` },
        })
      })
      expect(gapDemandSettled).toBe(false)
      subscribers[1]!([
        change(`insert`, gapRow),
        { headers: { control: `subset-end` } },
      ])
      thirdSnapshotDone.resolve()
      await reachCheckpoint(demand, `replacement Electric subset settlement`)
      await reachCheckpoint(gapDemand, `gap Electric subset settlement`)
      expect(collection.status).toBe(`ready`)
      expect(Array.from(collection.values(), ({ id }) => id)).toEqual([2, 3])
      expect(
        (
          await adapter.loadResumeSnapshot(privateClaim.physical_id, {
            cacheGenerationClaimId: privateClaim.claim_id,
          })
        ).rows.map(({ key }) => key),
      ).toEqual([2, 3])
    } catch (error) {
      primaryFailure = error
    } finally {
      releaseRotation.resolve()
      snapshotDone.resolve()
      secondSnapshotDone.resolve()
      thirdSnapshotDone.resolve()
      const cleanupTimeoutMs = primaryFailure === undefined ? 1_000 : 200
      try {
        if (collection) {
          await reachCheckpoint(
            collection.cleanup(),
            `gap collection cleanup`,
            cleanupTimeoutMs,
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
    reportReceivingOutcome(
      primaryFailure,
      cleanupFailures,
      `Electric rotation gap`,
    )
  })

  it(`keeps a healthy tagged cache when startup invalidates its resume cursor`, async () => {
    await runRace(`none`, `eager`, false, false, `tag-state`)
  })

  it(`keeps a healthy cache when a changed shape invalidates its resume cursor`, async () => {
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

  it.each([
    [`tag-state`, `none`],
    [`shape-identity`, `none`],
    [`shape-identity`, `shallow-persistence`],
  ] as const)(
    `keeps a fresh %s reset safe when the %s source wrapper forwards hydration scope`,
    async (startupReset, metadataWrapper) => {
      await runRace(
        `none`,
        `eager`,
        false,
        false,
        startupReset,
        metadataWrapper,
        `unchanged`,
        true,
      )
    },
  )

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

  it(`fully replaces an unknown on-demand resume baseline without managed claims`, async () => {
    await runRace(`none`, `on-demand`, true)
  })

  it(`fully replaces an on-demand resume baseline with missing key-set evidence without managed claims`, async () => {
    await runRace(`none`, `on-demand`, false, true)
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
    ([`unknown`, `missing`] as const).flatMap((initialEvidence) =>
      ([`external-row-loss`, `committed-replacement`] as const).map(
        (transition) => ({ initialEvidence, transition }),
      ),
    ),
  )(
    `freshly replaces a $initialEvidence eager baseline across $transition`,
    async ({ initialEvidence, transition }) => {
      await runRace(
        transition,
        `eager`,
        initialEvidence === `unknown`,
        initialEvidence === `missing`,
        `none`,
        `none`,
        transition === `external-row-loss` ? `incompatible` : `unchanged`,
      )
    },
  )

  it.each(
    ([`unknown`, `missing`] as const).flatMap((initialEvidence) =>
      ([`external-row-loss`, `committed-replacement`] as const).map(
        (transition) => ({ initialEvidence, transition }),
      ),
    ),
  )(
    `fully replaces a $initialEvidence on-demand cache without managed claims across $transition`,
    async ({ initialEvidence, transition }) => {
      await runRace(
        transition,
        `on-demand`,
        initialEvidence === `unknown`,
        initialEvidence === `missing`,
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

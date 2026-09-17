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
const mockSubscribe = vi.fn((subscriber: Subscriber) => {
  subscribers.push(subscriber)
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
  transition: `none` | `external-row-loss` | `schema-reset` | `committed-write`,
  syncMode: `eager` | `on-demand` = `eager`,
  legacyUnknown = false,
  missingKeySetEvidence = false,
): Promise<void> {
  const database = new DatabaseSync(`:memory:`)
  const driver = createDriver(database)
  const collectionId =
    `resume-snapshot-${syncMode}-${transition}-` +
    `${legacyUnknown}-${missingKeySetEvidence}`
  const laterSnapshotEntered = deferred()
  const releaseLaterSnapshot = deferred()
  let collection:
    | Collection<Item, string | number, ElectricCollectionUtils<Item>>
    | undefined
  let unsubscribe: (() => void) | undefined
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
            requiresTagState: false,
            offset: `10_0`,
            handle: `shape-old`,
            shapeId: `{"params":{"table":"test_table"},"url":"http://test-url"}`,
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
    let snapshotCalls = 0
    let laterSnapshotIncludedRows: boolean | undefined
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
            if (snapshotCalls > 1) {
              laterSnapshotIncludedRows = args[1]?.includeRows
              laterSnapshotEntered.resolve()
              await releaseLaterSnapshot.promise
            }
            const snapshot = await target.loadResumeSnapshot(...args)
            return missingKeySetEvidence
              ? { ...snapshot, keySet: undefined }
              : snapshot
          }
        }
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === `function` ? value.bind(target) : value
      },
    }) as unknown as PersistenceAdapter

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
          syncMode,
          getKey: (row) => row.id,
          startSync: false,
        }),
        persistence: { adapter: gatedAdapter },
      }),
    )

    let publications = 0
    collection.startSyncImmediate()
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
    const replacesUncertifiedBaseline = legacyUnknown || missingKeySetEvidence

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
    }
    releaseLaterSnapshot.resolve()

    if (transition === `none`) {
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
        (await restartedAdapter.loadSubset(collectionId, {})).map(
          ({ value }) => value,
        ),
      ).toEqual([
        { id: 1, name: `one` },
        { id: 2, name: `two` },
      ])
    } else {
      await vi.waitFor(() => expect(collection!.status).toBe(`error`))
      await vi.waitFor(async () => {
        const metadata =
          await restartedAdapter.loadCollectionMetadata(collectionId)
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
      expect(Array.from(collection.values())).toEqual([])
      expect(collection.status).not.toBe(`ready`)
      expect(publications).toBe(0)
      const durableRowsBeforeLateDelivery = await restartedAdapter.loadSubset(
        collectionId,
        {},
      )
      expect(durableRowsBeforeLateDelivery.map(({ value }) => value)).toEqual(
        transition === `external-row-loss`
          ? [{ id: 2, name: `two` }]
          : transition === `committed-write`
            ? [
                { id: 1, name: `one` },
                { id: 2, name: `two` },
                { id: 3, name: `three` },
              ]
            : [],
      )
      subscriber([
        change(`insert`, { id: 9, name: `late` }),
        { headers: { control: `up-to-date` } },
      ])
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(Array.from(collection.values())).toEqual([])
      expect(await restartedAdapter.loadSubset(collectionId, {})).toEqual(
        durableRowsBeforeLateDelivery,
      )
      expect(publications).toBe(0)
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
 * Deterministic companion schedules for the persisted recovery owner in
 * electric-recovery-oracle.test.ts. Its scenario matrix proves settled restart
 * semantics; these cases hold the adapter's second atomic snapshot so row loss,
 * reset, and concurrent commit can be injected between startup metadata and
 * resume certification. The separate fixture keeps the held boundary explicit
 * and does not claim native SQLite or live Electric service coverage.
 */
describe(`Electric resume snapshot races`, () => {
  beforeEach(() => {
    subscribers.length = 0
    vi.clearAllMocks()
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

  it(`rejects a schema reset for an unknown on-demand resume`, async () => {
    await runRace(`schema-reset`, `on-demand`, true)
  })

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

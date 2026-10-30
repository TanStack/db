// @vitest-environment node
/**
 * The sync metadata session oracle's seed/re-insert/reload law crosses real
 * SQLite and coordinator boundaries here. The law, model, legal histories,
 * and comparison are imported from sync-metadata-session-oracle.ts. This
 * driver supplies two persisted Collections, two production coordinators over
 * Node's BroadcastChannel/Web Locks, and one node:sqlite database. Each
 * Collection has its own adapter; their shared physical database supplies the
 * shared scheduler premise.
 *
 * A peer's named notice comes from its real source commit. For a full reload,
 * that source takes a durable snapshot, changes the requested row, and commits
 * a snapshot transaction. This preserves every other durable row and causes
 * production to announce requiresFullReload. The receiver records the actual
 * notice and waits for SQL/message quiescence before the shared comparison.
 * Neither this driver nor the peer invents an expected metadata value.
 *
 * Limits: one process, one SQLite database, two Collections of one ID, no
 * transport loss or leadership turnover, and core holds only. This is a real
 * SQLite/coordinator receiving witness, not a Chromium OPFS or Electron claim.
 */
import { DatabaseSync } from 'node:sqlite'
import { fc } from '@fast-check/vitest'
import { it } from 'vitest'
import { DbClient, collectionOptions } from '@tanstack/db'
import { BrowserCollectionCoordinator } from '../../browser-db-sqlite-persistence/src/browser-coordinator'
import {
  absentMarker,
  cachedMetadata,
  cachedRow,
  completedSeedReinsertReloadRegime,
  describeMismatch,
  persistedPeerFullLane,
  persistedPeerLane,
  persistedPeerOnDemandLane,
  runSessionHistory,
  seedReinsertReloadHistoryArbitrary,
  seedReinsertReloadReplay,
  sessionCollectionKeys,
} from '../../db/tests/sync-metadata-session-oracle'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
  readOracleRunConfig,
  recordOracleReplay,
} from '../../db/tests/oracle-config'
import { createOracleReach } from '../../db/tests/oracle-reach'
import {
  SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY,
  SQLiteCorePersistenceAdapter,
  eagerStorageTarget,
  managedStorageTarget,
  persistedCollectionOptions,
} from '../src'
import type { SQLInputValue } from 'node:sqlite'
import type { SyncConfig } from '@tanstack/db'
import type {
  ReceiptState,
  SessionAction,
  SessionDriver,
  SessionLane,
} from '../../db/tests/sync-metadata-session-oracle'
import type { SQLiteDriver } from '../src'

type Row = { id: number; v: unknown }
type Actions = Parameters<SyncConfig<Row, number>[`sync`]>[0]
let run = 0

async function createSQLiteDriver(lane: SessionLane): Promise<SessionDriver> {
  const database = new DatabaseSync(`:memory:`)
  let activity = 0
  let queue: Promise<unknown> = Promise.resolve()
  const driver: SQLiteDriver = {
    exec: async (sql) => {
      activity++
      database.exec(sql)
    },
    query: async <T>(sql: string, params: ReadonlyArray<unknown> = []) => {
      activity++
      return database
        .prepare(sql)
        .all(...(params as Array<SQLInputValue>)) as Array<T>
    },
    run: async (sql, params = []) => {
      activity++
      database.prepare(sql).run(...(params as Array<SQLInputValue>))
    },
    transaction: (work) => {
      const next = queue.then(async () => {
        database.exec(`BEGIN IMMEDIATE`)
        try {
          const result = await work(driver)
          database.exec(`COMMIT`)
          return result
        } catch (error) {
          database.exec(`ROLLBACK`)
          throw error
        }
      })
      queue = next.catch(() => undefined)
      return next
    },
  }
  Object.defineProperty(driver, SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY, {
    value: {},
  })
  const adapters = [
    new SQLiteCorePersistenceAdapter({ driver }),
    new SQLiteCorePersistenceAdapter({ driver }),
  ]
  const id = `metadata-items`
  const seedClaim = lane.onDemand
    ? await adapters[0]!.claimCacheGeneration(id)
    : undefined
  const target = seedClaim
    ? managedStorageTarget(seedClaim.storageCollectionId, seedClaim.claimId)
    : eagerStorageTarget(id)
  const storageId = seedClaim?.storageCollectionId ?? id
  await adapters[0]!.applyCommittedTx(target, {
    txId: `cached`,
    term: 1,
    seq: 1,
    rowVersion: 1,
    cacheGenerationClaimId: seedClaim?.claimId,
    mutations: [{ type: `insert`, key: 1, value: cachedRow }],
    rowMetadataMutations: [{ type: `set`, key: 1, value: cachedMetadata }],
  })
  const dbName = `sync-metadata-receiving-${process.pid}-${run++}`
  const coordinators = adapters.map(
    (adapter) => new BrowserCollectionCoordinator({ dbName, adapter }),
  )
  const notices: Array<{ reload: boolean }> = []
  let durableRows: ReadonlyArray<{ key: string | number; value: unknown }> = []
  const stopNotices = coordinators[0]!.subscribe(storageId, (message) => {
    activity++
    const payload = message.payload as {
      type: string
      requiresFullReload?: boolean
    }
    if (payload.type === `tx:committed`)
      notices.push({ reload: payload.requiresFullReload === true })
  })
  const quiesce = async () => {
    let quiet = 0
    for (let turn = 0; turn < 400 && quiet < 5; turn++) {
      const before = activity
      await new Promise((resolve) => setTimeout(resolve, 2))
      quiet = before === activity ? quiet + 1 : 0
    }
    if (quiet < 5) throw new Error(`SQLite metadata hosts did not quiesce`)
    durableRows = await adapters[0]!.loadSubset(target, {})
  }
  const actions: Array<Actions> = []
  let resolveMutation: (() => void) | undefined
  const clients = [new DbClient(), new DbClient()]
  const collections = clients.map((client, index) =>
    client.collection(
      collectionOptions(
        persistedCollectionOptions<Row, number>({
          id,
          getKey: (row) => row.id,
          ...(lane.onDemand ? { syncMode: `on-demand` as const } : {}),
          sync: {
            rowUpdateMode: lane.fullRows ? `full` : `partial`,
            sync: (sync) => {
              actions[index] = sync
              sync.begin()
              sync.commit()
              sync.markReady()
              return lane.onDemand ? { loadSubset: () => true } : undefined
            },
          },
          onInsert: () =>
            new Promise<void>((resolve) => {
              resolveMutation = resolve
            }),
          persistence: {
            adapter: adapters[index]!,
            coordinator: coordinators[index]!,
          },
        }),
      ),
    ),
  )
  // These direct source histories have no live query to start on-demand sync.
  // Start both sources before a follower can route its first demand to its peer.
  for (const current of collections) current.startSyncImmediate()
  if (!lane.onDemand)
    await Promise.all(collections.map((collection) => collection.preload()))
  const demands = collections.map(() => ({}))
  if (lane.onDemand)
    await Promise.all(
      collections.map((collection, index) =>
        collection._sync.loadSubset(demands[index]!),
      ),
    )
  await quiesce()
  const sync = actions[0]!
  const metadata = sync.metadata!
  const collection = collections[0]!
  const receipts: Array<Promise<void>> = []
  const receiptStates: Array<ReceiptState> = []
  const rejections: Array<string> = []
  let depth = 0
  let holdCount = 0
  let blocker: { when: (state: 'settled') => Promise<unknown> } | undefined
  const release = async () => {
    resolveMutation?.()
    resolveMutation = undefined
    await blocker?.when(`settled`)
    blocker = undefined
  }
  const abort = () => {
    const controller = new AbortController()
    controller.abort()
    const receipt = sync.commit(controller.signal)
    depth--
    if (receipt !== true)
      receipts.push(
        receipt.catch((error: unknown) => {
          if (!(error instanceof Error) || error.name !== `AbortError`)
            rejections.push(String(error))
        }),
      )
  }
  const read = (value: unknown) => (value === undefined ? absentMarker : value)
  const sorted = (entries: ReadonlyArray<{ key: string; value: unknown }>) =>
    entries
      .map(({ key, value }): [string, unknown] => [key, value])
      .sort(([a], [b]) => a.localeCompare(b))
  const rowMetadata = (value: unknown) =>
    value === undefined ? {} : { metadata: value as Record<string, unknown> }
  return {
    consumerCheckpoint: `final`,
    begin: () => {
      sync.begin()
      depth++
    },
    commit: () => {
      const index = receiptStates.length
      const receipt = sync.commit()
      depth--
      receiptStates.push(receipt === true ? `applied` : `pending`)
      if (receipt !== true)
        receipts.push(
          receipt.then(
            () => {
              receiptStates[index] = `applied`
            },
            () => {
              receiptStates[index] = `rejected`
            },
          ),
        )
    },
    cancel: abort,
    rowSet: (key, value) => metadata.row.set(key, value),
    rowDelete: (key) => metadata.row.delete(key),
    insert: (_key, value, meta) =>
      sync.write({ type: `insert`, value: value as Row, ...rowMetadata(meta) }),
    update: (_key, value, meta) =>
      sync.write({ type: `update`, value: value as Row, ...rowMetadata(meta) }),
    delete: (key) => sync.write({ type: `delete`, key }),
    truncate: () => sync.truncate(),
    collectionSet: (key, value) => metadata.collection.set(key, value),
    collectionDelete: (key) => metadata.collection.delete(key),
    hold: (store, readHold) => {
      if (store || readHold)
        throw new Error(`the SQLite seed/re-insert grammar uses core holds`)
      blocker = collection.insert({ id: 1000 + holdCount++, v: 0 })
    },
    release,
    seed: (key, value, meta) =>
      clients[0]!.hydrate({
        collections: [
          {
            collectionId: id,
            rows: [
              {
                key,
                value: value as Row,
                metadata: meta as Record<string, unknown>,
              },
            ],
          },
        ],
      }),
    peer: async (key, notice, value, meta) => {
      await quiesce()
      const before = notices.length
      const peer = actions[1]!
      if (notice === `reload`) {
        const rows = await adapters[1]!.loadSubset(target, {})
        peer.begin({ snapshot: true })
        for (const row of rows)
          if (row.key !== key)
            peer.write({
              type: `insert`,
              value: row.value as Row,
              ...rowMetadata(row.metadata),
            })
      } else if (notice === `row`) peer.begin()
      else
        throw new Error(
          `unexpected peer notice in the seed/re-insert grammar: ${notice}`,
        )
      peer.write({ type: `insert`, value: value as Row, ...rowMetadata(meta) })
      await peer.commit()
      await quiesce()
      if (
        !notices
          .slice(before)
          .some((entry) => entry.reload === (notice === `reload`))
      )
        throw new Error(
          `the real coordinator did not deliver the ${notice} notice`,
        )
      console.info(
        `SQLITE_METADATA_NOTICE ${JSON.stringify({ lane: lane.name, notice, received: notices.length - before })}`,
      )
    },
    observe: () => ({
      rowMetadata: {
        1: read(metadata.row.get(1)),
        2: read(metadata.row.get(2)),
      },
      collection: Object.fromEntries(
        sessionCollectionKeys.map((key) => [
          key,
          read(metadata.collection.get(key)),
        ]),
      ),
      list: sorted(metadata.collection.list()),
      prefixList: sorted(metadata.collection.list(`gc:`)),
      base: {
        1: read(collection.base.get(1)),
        2: read(collection.base.get(2)),
      },
      receipts: [...receiptStates],
    }),
    storedRows: () =>
      Object.fromEntries(
        [1, 2].map((key) => [
          key,
          read(durableRows.find((row) => row.key === key)?.value),
        ]),
      ),
    flush: quiesce,
    settle: async () => {
      await release()
      while (depth) abort()
      await quiesce()
      await Promise.all(receipts)
      await quiesce()
      return rejections
    },
    cleanup: async () => {
      await release()
      while (depth) abort()
      await Promise.all(receipts)
      if (lane.onDemand)
        for (const [index, current] of collections.entries())
          current._sync.unloadSubset(demands[index]!)
      await quiesce()
      await Promise.all(collections.map((current) => current.cleanup()))
      stopNotices()
      for (const coordinator of coordinators) coordinator.dispose()
      if (seedClaim)
        await adapters[0]!.releaseCacheGenerationClaim(seedClaim.claimId)
      await queue
      database.close()
    },
  }
}

const lanes = [
  persistedPeerLane,
  persistedPeerFullLane,
  persistedPeerOnDemandLane,
]
async function check(history: ReadonlyArray<SessionAction>, lane: SessionLane) {
  return runSessionHistory(lane, history, () => createSQLiteDriver(lane))
}
oracleReplayTest(it).each(lanes)(
  `receives the seed/re-insert/reload replay through SQLite ($name)`,
  async (lane) => {
    const result = await check(seedReinsertReloadReplay, lane)
    if (result.mismatch)
      throw new Error(
        describeMismatch(seedReinsertReloadReplay, result.mismatch),
      )
  },
)

const property = `sync-metadata-session.sqlite-seed-reinsert-reload`
const requested = readOracleRunConfig().replayProperty
for (const campaign of [`fixed`, `random`] as const) {
  if (
    requested !== undefined &&
    (requested !== property || campaign === `fixed`)
  )
    continue
  it(`receives generated seed/re-insert/reload histories through SQLite (${campaign})`, async () => {
    const states = lanes.flatMap((lane) => [
      `${lane.name}: inner commit`,
      `${lane.name}: row`,
      `${lane.name}: reload`,
    ])
    const completedStates = lanes.flatMap((lane) => [
      `${lane.name}: completed kept bare seed reload`,
      `${lane.name}: completed kept non-bare seed reload`,
    ])
    const reach = createOracleReach(property, states)
    const completedReach = createOracleReach(property, completedStates)
    const result = await fc.check(
      fc.asyncProperty(seedReinsertReloadHistoryArbitrary, async (history) => {
        const failures: Array<string> = []
        for (const lane of lanes) {
          reach.beginHistory()
          completedReach.beginHistory()
          const result = await check(history, lane)
          const last = history.at(-1)!
          const innerCommit = history.findIndex(
            (action) => action.type === `commit`,
          )
          if (result.steps > innerCommit)
            reach.reach(`${lane.name}: inner commit`)
          if (last.type === `peer` && result.steps === history.length)
            reach.reach(`${lane.name}: ${last.notice}`)
          // The peer action has asserted actual requiresFullReload delivery
          // before the shared comparison passes.
          const completed = completedSeedReinsertReloadRegime(history, result)
          if (completed !== undefined)
            completedReach.reach(`${lane.name}: ${completed}`)
          if (result.mismatch)
            failures.push(
              `${lane.name}\n${describeMismatch(history, result.mismatch)}`,
            )
        }
        if (failures.length) throw new Error(failures.join(`\n\n`))
      }),
      campaign === `fixed`
        ? { numRuns: oracleRuns(40), seed: 527962096 }
        : oraclePropertyOptions(40, property),
    )
    recordOracleReplay(property, result)
    console.info(
      `ORACLE_REACH ${JSON.stringify({ property, campaign, seed: result.seed, runs: result.numRuns, shrinks: result.numShrinks, completedBranchGuards: campaign === `fixed` ? `enforced` : `measured`, counts: Object.fromEntries([...reach.counts(), ...completedReach.counts()]) })}`,
    )
    if (result.failed)
      throw new Error(
        `${result.error}\nseed=${result.seed} path=${result.counterexamplePath}`,
      )
    reach.assertReached()
    // The fixed40 campaign enforces this scarce bare-key-1 premise on every
    // normal run. Its probability is 1/24, so random40 would miss it about
    // 18% of the time; that identical campaign reports measured branch reach.
    // Existing inner/row/reload guards remain enforced in both campaigns.
    if (campaign === `fixed`) completedReach.assertReached()
  }, 120_000)
}

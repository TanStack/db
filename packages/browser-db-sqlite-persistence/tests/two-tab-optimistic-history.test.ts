import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fc, test as fcTest } from '@fast-check/vitest'
import {
  createCollection,
  createLiveQueryCollection,
  createTransaction,
  whenSyncAccepted,
} from '@tanstack/db'
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  runOptimisticHistory,
  wrappingSyncHistory,
} from '../../db/tests/optimistic-history-oracle'
import { oraclePropertyOptions, oracleRuns } from '../../db/tests/oracle-config'
import { BrowserCollectionCoordinator } from '../src/browser-coordinator'
import {
  createBrowserWASQLitePersistence,
  persistedCollectionOptions,
} from '../src'
import {
  controlledLocks,
  heldLocks,
  queuedLocks,
} from './helpers/controlled-browser-seams'
import { createWASQLiteTestDatabase } from './helpers/wa-sqlite-test-db'
import type { Collection, CollectionConfig, SyncConfig } from '@tanstack/db'
import type {
  HistoryRow,
  OptimisticStep,
  SourceBatch,
  WrappingSyncLane,
} from '../../db/tests/optimistic-history-oracle'

/**
 * The optimistic-history oracle's laws, run in a tab that shares its durable
 * store with a second tab. Each tab runs its own source, so tab A receives
 * the server rows for its own writes from its own source. The peer tab's
 * source transactions reach tab A through the real Browser coordinator: tab B
 * leads, stores the transaction, and announces it. Once that announcement
 * reaches tab A, the model treats it as a committed sync transaction there.
 *
 * Durable writes from both tabs take the coordinator's writer lock one at a
 * time, so `hold-store` holds that lock. It blocks the next durable write,
 * whichever tab owns it. Tab A's own commit then applies and waits to be
 * stored, and its later commits are deferred. A held peer write delays its
 * announcement until release.
 *
 * The SQLite file is real (better-sqlite3); BroadcastChannel is Node's. Web
 * Locks is the deterministic controlled seam. This lane does not cover
 * leadership transfer or a tab closing mid-history.
 */
const collectionId = `two-tab-optimistic-history`

let originalNavigator: PropertyDescriptor | undefined

beforeEach(() => {
  originalNavigator = Object.getOwnPropertyDescriptor(globalThis, `navigator`)
  Object.defineProperty(globalThis, `navigator`, {
    value: { locks: controlledLocks },
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  if (originalNavigator) {
    Object.defineProperty(globalThis, `navigator`, originalNavigator)
  } else {
    Reflect.deleteProperty(globalThis, `navigator`)
  }
  heldLocks.clear()
  queuedLocks.clear()
})

const turns = async (count: number) => {
  for (let turn = 0; turn < count; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

let laneRun = 0

async function runTwoTabHistory({
  initial,
  steps,
}: {
  initial: Array<HistoryRow>
  steps: Array<OptimisticStep>
}): Promise<void> {
  const run = ++laneRun
  const directory = mkdtempSync(join(tmpdir(), `two-tab-history-`))
  const filename = join(directory, `shared.sqlite`)
  const dbName = `two-tab-history-${run}`
  const writerLock = `tsdb:writer:${dbName}`
  const databases = [
    createWASQLiteTestDatabase({ filename }),
    createWASQLiteTestDatabase({ filename }),
  ]
  const coordinatorB = new BrowserCollectionCoordinator({ dbName })
  const coordinatorA = new BrowserCollectionCoordinator({ dbName })
  let sourceB!: Parameters<SyncConfig<HistoryRow, number>[`sync`]>[0]
  let tabB: Collection<HistoryRow, number> | undefined
  let releaseWrite: (() => void) | undefined

  const cleanup = async () => {
    releaseWrite?.()
    await tabB?.cleanup()
    coordinatorA.dispose()
    coordinatorB.dispose()
    for (const database of databases) database.close?.()
    rmSync(directory, { recursive: true, force: true })
  }

  try {
    // Tab B starts first and leads, so tab A's own commits and tab B's
    // announcements both cross the channel.
    tabB = createCollection(
      persistedCollectionOptions<HistoryRow, number>({
        id: collectionId,
        getKey: (row) => row.id,
        sync: {
          rowUpdateMode: `full`,
          sync: (params) => {
            sourceB = params
            params.markReady()
          },
        },
        persistence: createBrowserWASQLitePersistence({
          database: databases[1]!,
          coordinator: coordinatorB,
        }),
      }),
    )
    await tabB.preload()
    for (let turn = 0; !coordinatorB.isLeader(collectionId); turn++) {
      if (turn > 200) throw new Error(`tab B did not lead`)
      await turns(1)
    }

    const persistenceA = createBrowserWASQLitePersistence({
      database: databases[0]!,
      coordinator: coordinatorA,
    })
    const lane: WrappingSyncLane = {
      db: {
        createCollection,
        createLiveQueryCollection,
        createTransaction,
        whenSyncAccepted,
      },
      wrap: (config) =>
        persistedCollectionOptions<HistoryRow, number>({
          ...(config as CollectionConfig<HistoryRow, number>),
          id: collectionId,
          persistence: persistenceA,
        }) as unknown as CollectionConfig<HistoryRow>,
      holdNextStore: () => {
        void controlledLocks.request(
          writerLock,
          () =>
            new Promise<void>((resolve) => {
              releaseWrite = resolve
            }),
        )
      },
      releaseStore: () => {
        releaseWrite?.()
        releaseWrite = undefined
      },
      // Channel deliveries, RPC replies, and SQLite continuations are timer
      // and promise turns.
      settle: () => turns(30),
      peerSync: (batch: SourceBatch) => {
        sourceB.begin()
        if (batch.truncate) sourceB.truncate()
        const operations = batch.operations ?? [
          ...Array.from({ length: batch.copies }, () =>
            batch.rows.map((row) => ({ type: `row` as const, row })),
          ).flat(),
          ...(batch.deletes ?? []).map((key) => ({
            type: `delete` as const,
            key,
          })),
        ]
        for (const operation of operations) {
          if (operation.type === `delete`) {
            sourceB.write({ type: `delete`, key: operation.key })
          } else {
            sourceB.write({ type: `update`, value: { ...operation.row } })
          }
        }
        void Promise.resolve(sourceB.commit()).catch(() => undefined)
      },
    }
    await runOptimisticHistory(initial, steps, undefined, { wrapping: lane })
  } finally {
    await cleanup()
  }
}

// Tab B's server row for key 1 is announced while tab A's own insert and
// update are persisting. Tab A's own server rows then arrive in order.
const peerBetweenOwnWrites: Array<OptimisticStep> = [
  {
    type: `edit`,
    key: 1,
    fields: { a: 1 },
    optimistic: true,
    inHandler: {
      type: `sync`,
      rows: [{ id: 1, a: 1, b: 0, c: 0 }],
      truncate: false,
      copies: 1,
    },
  },
  {
    type: `peer-sync`,
    batch: {
      type: `sync`,
      rows: [{ id: 2, a: 5, b: 0, c: 0 }],
      truncate: false,
      copies: 1,
    },
  },
  { type: `settle`, slot: 0, success: true, cascade: false },
]

it(`applies a peer tab's announced row beside the tab's own server rows`, async () => {
  await runTwoTabHistory({ initial: [], steps: peerBetweenOwnWrites })
})

it(`samples peer steps in the two-tab grammar`, () => {
  const samples = fc.sample(wrappingSyncHistory(true), {
    seed: 22_013,
    numRuns: 100,
  })
  expect(
    samples.some((sample) =>
      sample.steps.some((step) => step.type === `peer-sync`),
    ),
  ).toBe(true)
})

fcTest.prop([wrappingSyncHistory(true)], {
  numRuns: oracleRuns(20),
  seed: 22_014,
})(
  `two-tab Collections match optimistic histories with a fixed seed`,
  runTwoTabHistory,
  120_000,
)
fcTest.prop(
  [wrappingSyncHistory(true)],
  oraclePropertyOptions(20, `browser-persistence.two-tab-optimistic-history`),
)(
  `two-tab Collections match optimistic histories with a random or replayed seed`,
  runTwoTabHistory,
  120_000,
)

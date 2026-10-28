// @vitest-environment node
/**
 * # Do reserved commits survive hydrations on the real SQLite adapter?
 *
 * Law: a persisted hydration that would start while a reserved sync
 * transaction is open waits until it ends; a commit is then accepted, and an
 * abandoned transaction applies nothing (`reserveCommitTurn`,
 * packages/db/src/types.ts, widened by maintainer decision on #2226). A peer
 * reset is the exception: it abandons a reserved transaction that began
 * before it, so that commit rejects and the reset does not wait (maintainer
 * decision on PR #2265). The
 * primary owner is the persisted-reads grammar in persisted-oracle.test.ts,
 * which uses a recording adapter and simulates a held hydration scope. This
 * oracle drives the same law through `SQLiteCorePersistenceAdapter` over
 * `node:sqlite`, including the shared logical scheduler, which can hold a
 * hydration after its apply-mutex turn began. Its histories were reduced from
 * the report in https://github.com/TanStack/db/issues/2226.
 *
 * Grammar: the hydration route (a peer full-reload notice, a peer reset, or a
 * subset load admitted before the reservation) crossed with the timing (the
 * route waits behind this Collection's held write, or the shared scheduler
 * holds its scope behind another Collection's write after its turn began),
 * the nesting (one reserved transaction, or a second one nested inside it),
 * and the ending (the reserved transactions commit, or are abandoned). A
 * peer reset abandons every reserved transaction that began before it, so a
 * nested one rejects with the same abort as its outer one.
 *
 * Model: row-1's durable value before the reservation follows from the
 * history alone: the initial row, a peer edit, or the held write's value. A
 * commit makes row-1 `refetched`; an abandoned transaction, or one a peer
 * reset abandoned, leaves the durable value. Each cell reaches its premise: the hydration entered its scope while
 * the reservation was open.
 *
 * Limits: the simulated peer writes straight to the adapter and announces
 * through a test coordinator, outside a leader that allocates positions, so
 * only row-1, the commit outcome, and Collection status are judged. The
 * Browser-host owner (the multi-tab Electric oracle) judges peer rows across
 * real tabs.
 */

import { DatabaseSync } from 'node:sqlite'
import { createCollection } from '@tanstack/db'
import { afterEach, describe, expect, it } from 'vitest'
import { createOracleReach } from '../../db/tests/oracle-reach.js'
import { declareOracle } from '../../db/tests/oracle-declaration.js'
import {
  SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY,
  SQLiteCorePersistenceAdapter,
  SingleProcessCoordinator,
  eagerStorageTarget,
  persistedCollectionOptions,
} from '../src'
import type { ProtocolEnvelope, SQLiteDriver, TxCommitted } from '../src'
import type { SyncConfig } from '@tanstack/db'
import type { SQLInputValue } from 'node:sqlite'

interface ShapeRow extends Record<string, unknown> {
  readonly id: string
  readonly value: string
}

/**
 * A real in-memory SQLite driver whose next write transaction can be held to keep the persistence queue busy.
 * `sharedScheduling` marks it as one physical database, as the browser driver does, so every adapter on it
 * shares one write/hydrate scheduler.
 */
const openHoldableDatabase = ({
  sharedScheduling = false,
}: { sharedScheduling?: boolean } = {}) => {
  const database = new DatabaseSync(':memory:')
  let hold: { reached: () => void; released: Promise<void> } | undefined
  let transactionQueue: Promise<unknown> = Promise.resolve()
  const driver: SQLiteDriver = {
    ...(sharedScheduling
      ? { [SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY]: {} }
      : {}),
    exec: async (sql) => {
      database.exec(sql)
    },
    query: async <T>(sql: string, params: ReadonlyArray<unknown> = []) =>
      // SQLiteDriver's generic contract erases SQL parameter and result types.
      database
        .prepare(sql)
        .all(...(params as Array<SQLInputValue>)) as Array<T>,
    run: async (sql, params = []) => {
      database.prepare(sql).run(...(params as Array<SQLInputValue>))
    },
    transaction: (work) => {
      const transaction = transactionQueue.then(async () => {
        const current = hold
        hold = undefined
        if (current) {
          current.reached()
          await current.released
        }
        database.exec('BEGIN IMMEDIATE')
        try {
          const result = await work(driver)
          database.exec('COMMIT')
          return result
        } catch (error) {
          database.exec('ROLLBACK')
          throw error
        }
      })
      transactionQueue = transaction.catch(() => undefined)
      return transaction
    },
  }
  const holdNextWrite = () => {
    let release!: () => void
    let reached!: () => void
    const wasReached = new Promise<void>((resolve) => {
      reached = resolve
    })
    hold = {
      reached,
      released: new Promise<void>((resolve) => (release = resolve)),
    }
    return { release, wasReached }
  }
  return { database, driver, holdNextWrite }
}

const waitFor = async (
  assertion: () => void,
  timeoutMs: number = 2_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      assertion()
      return
    } catch (error) {
      if (Date.now() >= deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
}

/** A coordinator for one tab that lets the test deliver another tab's broadcast, as BroadcastChannel does. */
class PeerTabCoordinator extends SingleProcessCoordinator {
  private readonly listeners = new Map<
    string,
    (message: ProtocolEnvelope<unknown>) => void
  >()

  override subscribe(
    collectionId?: string,
    onMessage?: (message: ProtocolEnvelope<unknown>) => void,
  ): () => void {
    if (collectionId === undefined || onMessage === undefined)
      return () => undefined
    this.listeners.set(collectionId, onMessage)
    return () => this.listeners.delete(collectionId)
  }

  deliverFromPeer(collectionId: string, payload: unknown): void {
    const listener = this.listeners.get(collectionId)
    if (!listener) throw new Error(`No runtime subscribed to ${collectionId}.`)
    listener({
      collectionId,
      dbName: 'repro',
      payload,
      senderId: 'peer-tab',
      ts: Date.now(),
      v: 1,
    })
  }
}

const COLLECTION_ID = 'items'

type SourceSyncParams = Parameters<SyncConfig<ShapeRow, string>['sync']>[0]

/**
 * A persisted collection whose source the test drives by hand, with another tab committing to the same SQLite
 * database. `reserve()` opens a source transaction that reserves its commit turn, as Electric's refetch does.
 */
const openPeerTabHarness = async ({
  sharedScheduling = false,
  onDemand = false,
}: { sharedScheduling?: boolean; onDemand?: boolean } = {}) => {
  const { database, driver, holdNextWrite } = openHoldableDatabase({
    sharedScheduling,
  })
  // The concrete class exposes the stream-position and hydration-scope methods the factory's interface marks optional.
  const adapter = new SQLiteCorePersistenceAdapter({ driver })
  // Reach checkpoint: resolves when a hydration scope starts its task, after
  // any scheduler delay. A case commits only after the hydration it tests has
  // tried to start, so the history overlaps the reservation however slow the
  // runner is.
  const scopeEntryWaiters: Array<() => void> = []
  const runScope = adapter.runInHydrationScope.bind(adapter)
  adapter.runInHydrationScope = (task) =>
    runScope((scoped) => {
      for (const resolve of scopeEntryWaiters.splice(0)) resolve()
      return task(scoped)
    })
  const nextScopeEntry = () =>
    new Promise<void>((resolve) => scopeEntryWaiters.push(resolve))
  const coordinator = new PeerTabCoordinator()
  let source: SourceSyncParams | undefined
  const collection = createCollection(
    persistedCollectionOptions<ShapeRow, string>({
      id: COLLECTION_ID,
      persistence: { adapter, coordinator },
      schemaVersion: 1,
      getKey: (row) => row.id,
      ...(onDemand ? { syncMode: 'on-demand' as const } : {}),
      sync: {
        sync: (params) => {
          source = params
          params.begin()
          params.write({
            type: 'insert',
            value: { id: 'row-1', value: 'initial' },
          })
          params.commit()
          params.markReady()
          return onDemand ? { loadSubset: () => true } : {}
        },
      },
    }),
  )
  const requireSource = (): SourceSyncParams => {
    if (!source) throw new Error('The collection has not started its source.')
    return source
  }
  const start = async () => {
    await collection.preload()
    await waitFor(() =>
      expect(collection.get('row-1')).toMatchObject({ value: 'initial' }),
    )
  }
  /** Commits a row change from the peer tab into the shared database and returns its broadcast notice. */
  const commitFromPeer = async (value: string): Promise<TxCommitted> => {
    const position = await adapter.getStreamPosition(
      eagerStorageTarget(COLLECTION_ID),
    )
    const tx = {
      mutations: [
        {
          key: 'row-1',
          type: 'update' as const,
          value: { id: 'row-1', value },
        },
      ],
      rowVersion: position.latestRowVersion + 1,
      seq: position.latestSeq + 1,
      term: position.latestTerm,
      txId: value,
    }
    await adapter.applyCommittedTx(eagerStorageTarget(COLLECTION_ID), tx)
    return {
      latestRowVersion: tx.rowVersion,
      requiresFullReload: true,
      seq: tx.seq,
      term: tx.term,
      txId: tx.txId,
      type: 'tx:committed',
    }
  }
  const reserve = (value?: string) => {
    const params = requireSource()
    params.begin()
    if (value) params.write({ type: 'update', value: { id: 'row-1', value } })
    params.metadata?.persistence?.reserveCommitTurn()
  }
  // A second reserved transaction nested inside the open one.
  const reserveNested = () => {
    const params = requireSource()
    params.begin()
    params.write({ type: 'insert', value: { id: 'row-2', value: 'nested' } })
    params.metadata?.persistence?.reserveCommitTurn()
  }
  const commit = () => requireSource().commit()
  // Committing with an aborted signal abandons the transaction.
  const abandon = () => {
    const cancelled = new AbortController()
    cancelled.abort()
    return requireSource().commit(cancelled.signal)
  }
  await start()
  return {
    reserveNested,
    abandon,
    adapter,
    coordinator,
    collection,
    commit,
    commitFromPeer,
    database,
    holdNextWrite,
    nextScopeEntry,
    reserve,
  }
}

type AdapterHistory = {
  route: 'peer full reload' | 'peer reset' | 'subset admitted earlier'
  timing: 'mutex turn' | 'scheduler hold'
  nesting: 'single' | 'nested'
  ending: 'commits' | 'abandoned'
}

const adapterHistories: Array<AdapterHistory> = (
  ['peer full reload', 'peer reset', 'subset admitted earlier'] as const
).flatMap((route) =>
  (['mutex turn', 'scheduler hold'] as const).flatMap((timing) =>
    // A peer commit cannot become durable while this Collection's held write
    // occupies the only SQLite writer, so that history needs a separate
    // leader; the persisted-reads grammar's fixture leader covers it.
    route === 'peer full reload' && timing === 'mutex turn'
      ? []
      : (['single', 'nested'] as const).flatMap((nesting) =>
          (['commits', 'abandoned'] as const).map((ending) => ({
            route,
            timing,
            nesting,
            ending,
          })),
        ),
  ),
)

/** A premise that must be reached; a miss fails by name instead of hanging. */
const reached = <T>(promise: Promise<T>, label: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_resolve, reject) =>
      setTimeout(
        () => reject(new Error(`premise not reached: ${label}`)),
        2_000,
      ),
    ),
  ])

// The model: a peer reset abandons the reservation, which began before it,
// so only a committing transaction on another route is accepted. An accepted
// commit shows its rows; a waited subset load runs after the reservation and
// succeeds either way.
const expectedAdapterOutcome = ({ route, nesting, ending }: AdapterHistory) => {
  const commitAccepted = ending === 'commits' && route !== 'peer reset'
  return {
    commitAccepted,
    observation: {
      outcomes: Array.from({ length: nesting === 'nested' ? 2 : 1 }, () =>
        commitAccepted ? 'fulfilled' : 'rejected (AbortError)',
      ),
      nestedRow: nesting === 'nested' && commitAccepted ? 'nested' : undefined,
      status: 'ready',
      loadOutcome:
        route === 'subset admitted earlier' ? 'fulfilled' : undefined,
    },
  }
}

describe('reserved commits across real-adapter hydrations', () => {
  const cleanups: Array<() => Promise<void> | void> = []
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  })

  // The driver runs one history on the real adapter and compares it with the
  // model.
  const runAdapterHistory = async (history: AdapterHistory) => {
    const { route, timing, nesting, ending } = history
    const harness = await openPeerTabHarness({
      sharedScheduling: timing === 'scheduler hold',
      onDemand: route === 'subset admitted earlier',
    })
    cleanups.push(() => harness.database.close())
    cleanups.push(() => harness.collection.cleanup())
    const reach = createOracleReach('sqlite.reserved-commit-hydration', [
      'hydration entered its scope while reserved',
    ])
    reach.beginHistory()
    // row-1's durable value just before the reservation, from the history.
    let durableBefore = 'initial'
    const notice =
      route === 'peer full reload'
        ? await harness.commitFromPeer('peer edit')
        : undefined
    if (notice) durableBefore = 'peer edit'
    // The subset load's settlement, judged after the reservation ends.
    let load: Promise<'fulfilled' | 'rejected'> | undefined
    const admitRoute = () => {
      if (notice) harness.coordinator.deliverFromPeer(COLLECTION_ID, notice)
      else if (route === 'peer reset') {
        harness.coordinator.deliverFromPeer(COLLECTION_ID, {
          type: 'collection:reset',
          schemaVersion: 1,
          resetEpoch: 1,
        })
      } else {
        load = Promise.resolve(
          harness.collection._sync.loadSubset({ limit: 1 }),
        ).then(
          () => 'fulfilled' as const,
          () => 'rejected' as const,
        )
      }
    }
    if (timing === 'mutex turn') {
      // This Collection's held write is ahead of the route on the mutex.
      const write = harness.holdNextWrite()
      harness.reserve('durable predecessor')
      durableBefore = 'durable predecessor'
      const blocker = Promise.resolve(harness.commit()).catch(() => undefined)
      await write.wasReached
      admitRoute()
      // One task lets the route take its mutex turn before the reservation.
      await new Promise((resolve) => setTimeout(resolve, 0))
      harness.reserve('refetched')
      if (nesting === 'nested') harness.reserveNested()
      const entered = harness.nextScopeEntry()
      write.release()
      await blocker
      await reached(entered, 'hydration entered its scope')
    } else {
      // Another Collection's held write holds the shared scheduler, so the
      // route's scope waits after its mutex turn began.
      await harness.adapter.loadSubset(
        eagerStorageTarget('other_collection'),
        {},
      )
      const otherWrite = harness.holdNextWrite()
      const blocker = harness.adapter.applyCommittedTx(
        eagerStorageTarget('other_collection'),
        { mutations: [], rowVersion: 1, seq: 1, term: 1, txId: 'blocker' },
      )
      await otherWrite.wasReached
      let turnBegan!: () => void
      const began = new Promise<void>((resolve) => {
        turnBegan = resolve
      })
      const runInHydrationScope = harness.adapter.runInHydrationScope.bind(
        harness.adapter,
      )
      harness.adapter.runInHydrationScope = (task) => {
        turnBegan()
        return runInHydrationScope(task)
      }
      admitRoute()
      await reached(began, 'route turn began')
      harness.reserve('refetched')
      if (nesting === 'nested') harness.reserveNested()
      const entered = harness.nextScopeEntry()
      otherWrite.release()
      await blocker
      await reached(entered, 'hydration entered its scope')
    }
    reach.reach('hydration entered its scope while reserved')
    // Commits the innermost transaction first; a rejection keeps its name,
    // so an abort and a cross-cycle failure stay distinct.
    const settle = async () => {
      try {
        await (ending === 'commits' ? harness.commit() : harness.abandon())
        return 'fulfilled'
      } catch (error) {
        return `rejected (${(error as Error).name})`
      }
    }
    const outcomes: Array<string> = []
    if (nesting === 'nested') outcomes.push(await settle())
    outcomes.push(await settle())
    const loadOutcome = await load
    reach.assertReached()
    const expected = expectedAdapterOutcome(history)
    const expectedValue = expected.commitAccepted ? 'refetched' : durableBefore
    await waitFor(() =>
      expect(harness.collection.get('row-1')).toMatchObject({
        value: expectedValue,
      }),
    )
    // A subset load that waited runs after the reservation and succeeds.
    expect({
      outcomes,
      nestedRow: harness.collection.get('row-2')?.value,
      status: harness.collection.status,
      loadOutcome,
    }).toEqual(expected.observation)
  }
  declareOracle({
    check: [runAdapterHistory],
    model: [expectedAdapterOutcome],
    grammar: [adapterHistories],
  })
  it.each(adapterHistories)(
    'keeps a reserved commit lawful across a real-adapter hydration ($route, $timing, $nesting, $ending)',
    runAdapterHistory,
  )
})

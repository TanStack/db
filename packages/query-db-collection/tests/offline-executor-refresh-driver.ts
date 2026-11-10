import { createCollection, createTransaction } from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import { vi } from 'vitest'
import { queryCollectionOptions } from '../src/query'
import { startOfflineExecutor } from '../../offline-transactions/src/OfflineExecutor'
import { OutboxManager } from '../../offline-transactions/src/outbox/OutboxManager'
import {
  FakeStorageAdapter,
  gate,
  turn,
} from '../../offline-transactions/tests/harness'
import {
  cleanupOfflineOracle,
  useControlledClock,
} from '../../offline-transactions/tests/oracle-lifecycle'
import type { Transaction } from '@tanstack/db'
import type { OnlineDetector } from '../../offline-transactions/src/types'
import type {
  BarrierCut,
  BarrierHistory,
} from '../../offline-transactions/tests/executor-lifecycle-oracle'

type Row = { id: string; value: string }

/** Observe one stable public barrier without letting another promise settle it. */
export async function readRefreshBarrier(
  current: () => Promise<unknown> | null | undefined,
): Promise<BarrierCut[`barrier`]> {
  for (;;) {
    const barrier = current()
    const outcome = { settled: false }
    if (barrier) {
      void barrier.then(
        () => {
          outcome.settled = true
        },
        () => {
          outcome.settled = true
        },
      )
      // A task turn drains promise reaction chains as well as this reaction.
      await turn()
    }
    if (barrier !== current()) continue
    return !barrier ? `none` : outcome.settled ? `settled` : `pending`
  }
}

// This production driver supplies a real QueryDB consumer to the offline
// barrier oracle. It computes no expected rows or receipt outcomes. Query
// results are copied snapshots of an external controlled backend. The backend
// changes only after the named mutation provider's gate opens.
export async function driveQueryBarrier(
  plan: BarrierHistory,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const releaseClock = useControlledClock()
  const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
  const backend = new Map<string, Row>([
    [`base`, { id: `base`, value: `base` }],
  ])
  const queryReads: Array<Array<Row>> = []
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: Infinity },
    },
  })
  const collection = createCollection(
    queryCollectionOptions<Row>({
      id: `offline-refresh-receiving`,
      queryKey: [`offline-refresh-receiving`],
      queryClient,
      startSync: true,
      queryFn: () => {
        const rows = [...backend.values()].map((row) => ({ ...row }))
        queryReads.push(rows)
        return Promise.resolve(rows)
      },
      getKey: (row) => row.id,
    }),
  )
  const listeners = new Set<() => void>()
  let online = false
  const detector: OnlineDetector = {
    isOnline: () => online,
    subscribe: (callback) => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
    notifyOnline: () => {
      for (const callback of listeners) callback()
    },
    dispose: () => listeners.clear(),
  }
  const gates = Array.from({ length: plan.count }, () => gate())
  const ids: Array<string> = []
  const callers = Array.from({ length: plan.count }, () => `pending`)
  const calls: Array<number> = []
  const errors: Array<string> = []
  const transactions: Array<Transaction> = []
  const storage = new FakeStorageAdapter()
  let executor: ReturnType<typeof startOfflineExecutor> | undefined
  const start = () =>
    startOfflineExecutor({
      storage,
      collections: { rows: collection },
      onlineDetector: detector,
      leaderElection: {
        requestLeadership: () => Promise.resolve(true),
        releaseLeadership: () => {},
        isLeader: () => true,
        onLeadershipChange: () => () => {},
      },
      mutationFns: {
        save: async ({ transaction }) => {
          const index = ids.indexOf(transaction.id)
          calls.push(index)
          await gates[index]!.promise
          backend.set(String(index), {
            id: String(index),
            value: `insert ${index}`,
          })
        },
      },
    })
  // Move actual Query Core notification timers and allow Promise reactions.
  // Eight controlled turns bound the observation. Pending is recorded as a
  // public receipt outcome instead of awaiting a possibly orphaned refetch.
  const settle = async () => {
    for (let index = 0; index < 8; index++) {
      await turn()
      await vi.advanceTimersByTimeAsync(5)
    }
  }
  const receipt = { value: `pending` }
  let staleDelivered = false
  const deferred = { scheduled: false }
  let restoreThen: (() => void) | undefined
  let primaryFailure = false
  const capture = async (
    checkpoint: string,
    completed: number,
    receiving = false,
  ) => {
    if (!executor) throw new Error(`Receiving executor was not started`)
    const barrierState = await readRefreshBarrier(
      () => collection.deferDataRefresh,
    )
    observe(checkpoint, {
      completed,
      barrier: barrierState,
      calls: [...calls],
      callers: [...callers],
      errors: [...errors],
      outbox: (await executor.peekOutbox())
        .map((entry) => ids.indexOf(entry.id))
        .sort(),
      ...(receiving
        ? {
            query: {
              receipt: receipt.value,
              staleDelivered,
              deferredScheduled: deferred.scheduled,
              // Virtual origin/pending-write attribution belongs to core's
              // optimistic-history oracle; this receiving law judges row data.
              rows: [...collection.values()]
                .map((row) => ({ id: row.id, value: row.value }))
                .sort((left, right) => left.id.localeCompare(right.id)),
            },
          }
        : {}),
    } satisfies BarrierCut)
  }
  try {
    await settle()
    // Capture legal public mutations and store them through the real serializer.
    // Retire each seed before startup. Replay restores pending optimism, which
    // does not invoke QueryDB's persisting-mutation refetch escape hatch.
    const outbox = new OutboxManager(storage, { rows: collection })
    for (let index = 0; index < plan.count; index++) {
      const seed = createTransaction({
        autoCommit: false,
        mutationFn: () => Promise.resolve(),
      })
      transactions.push(seed)
      seed.mutate(() =>
        collection.insert({ id: String(index), value: `insert ${index}` }),
      )
      ids.push(seed.id)
      await outbox.add({
        id: seed.id,
        mutationFnName: `save`,
        mutations: seed.mutations,
        keys: seed.mutations.map((mutation) => mutation.globalKey),
        idempotencyKey: seed.id,
        createdAt: new Date(),
        retryCount: 0,
        nextAttemptAt: Date.now(),
        metadata: {},
        version: 1,
      })
      seed.rollback({ isSecondaryRollback: true })
    }
    executor = start()
    await executor.waitForInit()
    for (const [index, id] of ids.entries()) {
      void executor.waitForTransactionCompletion(id).then(
        () => {
          callers[index] = `fulfilled`
        },
        () => {
          callers[index] = `rejected`
        },
      )
    }
    await settle()
    await capture(`queued offline`, 0)
    online = true
    for (let index = 0; index < plan.notifications; index++) {
      try {
        detector.notifyOnline()
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
    await settle()
    await capture(`provider held`, 0)
    observe(`reach`, `pending refresh barrier`)
    const barrier = collection.deferDataRefresh
    if (barrier) {
      // Existing offline-refresh e2e uses this positive scheduling witness.
      // Only QueryDB's actual subscription is intercepted, after our recorder.
      const originalThen = barrier.then.bind(barrier)
      barrier.then = (...args) => {
        deferred.scheduled = true
        return originalThen(...args)
      }
      restoreThen = () => {
        barrier.then = originalThen
      }
    }
    const readsBefore = queryReads.length
    void collection.utils.refetch({ throwOnError: true }).then(
      () => {
        receipt.value = `fulfilled`
      },
      () => {
        receipt.value = `rejected`
      },
    )
    await settle()
    restoreThen?.()
    restoreThen = undefined
    staleDelivered = queryReads
      .slice(readsBefore)
      .some((rows) => rows.length === 1 && rows[0]?.id === `base`)
    await capture(`stale refetch held`, 0, true)
    if (staleDelivered) observe(`reach`, `stale refetch delivered`)
    if (deferred.scheduled) observe(`reach`, `query deferred by barrier`)
    for (const entry of gates) {
      entry.resolve()
      await settle()
    }
    await capture(`batch completed`, plan.count, true)
    if (receipt.value === `fulfilled`) observe(`reach`, `query refresh settled`)
  } catch (error) {
    primaryFailure = true
    throw error
  } finally {
    restoreThen?.()
    for (const entry of gates) entry.resolve()
    executor?.dispose()
    await settle()
    for (const transaction of new Set([
      ...transactions,
      ...collection._state.transactions.values(),
    ]))
      if (transaction.state === `pending` || transaction.state === `persisting`)
        transaction.rollback({ isSecondaryRollback: true })
    await cleanupOfflineOracle(
      [
        () => collection.cleanup(),
        () => queryClient.clear(),
        () => warning.mockRestore(),
        () => releaseClock(),
      ],
      primaryFailure,
    )
  }
}

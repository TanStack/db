// Offline settlement cases whose expectations are written by hand: a retry
// deadline that a hook must not change, a rejected hook result, a held
// deletion, a failed terminal marker, and a rejected outbox write. Each runs
// the real executor against a finite history and compares with values written
// in the test. The settlement laws they illustrate are owned by
// transaction-settlement-oracle.property.test.ts.
import { runInNewContext } from 'node:vm'
import { createCollection, createTransaction } from '@tanstack/db'
import { expect, it, vi } from 'vitest'
import { NonRetriableError } from '../src/types'
import { OutboxManager } from '../src/outbox/OutboxManager'
import { KeyScheduler } from '../src/executor/KeyScheduler'
import { TransactionExecutor } from '../src/executor/TransactionExecutor'
import { DefaultRetryPolicy } from '../src/retry/RetryPolicy'
import { FakeStorageAdapter, createTestOfflineEnvironment } from './harness'
import {
  atOracleCheckpoint,
  captureUnhandledRejections,
  cleanupOfflineOracle,
} from './oracle-lifecycle'
import { gate, turn } from './transaction-settlement-support'
import type { TestItem } from './harness'
import type { OfflineTransaction, TransactionSignaler } from '../src/types'

// The no-hook run is the reference for existing retry timing. With the same
// retry count, ordinary Error, disabled jitter, and clock, adding a true hook
// may change the decision path but not the durable deadline. Comparing outbox
// records leaves the choice of delay implementation to production.
it(`preserves the default retry deadline when the hook agrees`, async () => {
  const fixedNow = 1_000_000
  const providerError = new Error(`temporary connection failure`)
  const hookCalls: Array<{ error: Error; retryCount: number }> = []
  const clock = vi.spyOn(Date, `now`).mockReturnValue(fixedNow)
  const signaler: TransactionSignaler = {
    isOfflineEnabled: true,
    isOnline: () => true,
    resolveTransaction: () => {
      throw new Error(`failed provider cannot resolve`)
    },
    rejectTransaction: () => {
      throw new Error(`ordinary failure should retry`)
    },
    registerRestorationTransaction: () => {},
  }
  const observeDeadline = async (withHook: boolean): Promise<number> => {
    const outbox = new OutboxManager(new FakeStorageAdapter(), {})
    const executor = new TransactionExecutor(
      new KeyScheduler(),
      outbox,
      {
        collections: {},
        mutationFns: {
          syncData: () => Promise.reject(providerError),
        },
        jitter: false,
        ...(withHook
          ? {
              shouldRetry: (error: Error, retryCount: number) => {
                hookCalls.push({ error, retryCount })
                return true
              },
            }
          : {}),
      },
      signaler,
    )
    const transaction: OfflineTransaction = {
      id: withHook ? `hooked-deadline` : `default-deadline`,
      mutationFnName: `syncData`,
      mutations: [],
      keys: [],
      idempotencyKey: withHook ? `hooked-deadline` : `default-deadline`,
      createdAt: new Date(0),
      retryCount: 0,
      nextAttemptAt: 0,
      version: 1,
    }
    await outbox.add(transaction)
    try {
      await atOracleCheckpoint(
        executor.execute(transaction),
        `retry deadline ${withHook ? `with` : `without`} hook`,
      )
      const stored = await outbox.get(transaction.id)
      expect(stored).toMatchObject({ retryCount: 1 })
      return stored!.nextAttemptAt
    } finally {
      executor.pause()
    }
  }

  try {
    const defaultDeadline = await observeDeadline(false)
    const hookedDeadline = await observeDeadline(true)
    expect(defaultDeadline).toBeGreaterThan(fixedNow)
    expect(hookedDeadline).toBe(defaultDeadline)
    expect(hookCalls).toEqual([{ error: providerError, retryCount: 0 }])
    expect(hookCalls[0]?.error).toBe(providerError)
  } finally {
    clock.mockRestore()
  }
})

// Two ordinary provider failures are a legal history. The first explicit
// answer keeps the head. On the second failure, false removes it while
// undefined delegates to the default and keeps it for a third attempt. The
// distinct Errors expose a stale-error decision at the second durable cut.
it.each([`terminal`, `defer`] as const)(
  `passes the second error and retry count to the decision hook (%s)`,
  async (secondDecision) => {
    const firstError = new Error(`temporary first failure`)
    const secondError = new Error(`temporary second failure`)
    const firstRetryStored = gate()
    const secondDecisionStored = gate()
    const hookCalls: Array<{ error: Error; retryCount: number }> = []
    let transactionId = ``
    class DecisionStorage extends FakeStorageAdapter {
      override async set(key: string, value: string): Promise<void> {
        await super.set(key, value)
        if (key !== `tx:${transactionId}`) return
        const record = JSON.parse(value) as { retryCount: number }
        if (record.retryCount === 1) firstRetryStored.resolve()
        if (record.retryCount === 2) secondDecisionStored.resolve()
      }

      override async delete(key: string): Promise<void> {
        await super.delete(key)
        if (key === `tx:${transactionId}`) secondDecisionStored.resolve()
      }
    }
    const config = {
      jitter: false,
      shouldRetry: (error: Error, retryCount: number): boolean | undefined => {
        hookCalls.push({ error, retryCount })
        if (retryCount === 0) return true
        return secondDecision === `terminal` ? false : undefined
      },
    }
    const env = createTestOfflineEnvironment({
      storage: new DecisionStorage(),
      config,
      mutationFn: (params) => {
        const attempt = env.mutationCalls.length
        if (attempt === 1) throw firstError
        if (attempt === 2) throw secondError
        env.applyMutations(params.transaction.mutations)
      },
    })
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    let commitStatus: unknown = `pending`
    let waitStatus: unknown = `pending`
    const observed: Array<Promise<void>> = []
    let hasPrimaryFailure = false
    try {
      await env.waitForLeader()
      const tx = env.executor.createOfflineTransaction({
        mutationFnName: env.mutationFnName,
        autoCommit: false,
      })
      transactionId = tx.id
      const observedWait = env.executor
        .waitForTransactionCompletion(tx.id)
        .then(
          () => {
            waitStatus = `fulfilled`
          },
          (error: unknown) => {
            waitStatus = error
          },
        )
      tx.mutate(() =>
        env.collection.insert({
          id: `retry-count`,
          value: `pending`,
          completed: false,
          updatedAt: new Date(0),
        }),
      )
      const observedCommit = tx.commit().then(
        () => {
          commitStatus = `fulfilled`
        },
        (error: unknown) => {
          commitStatus = error
        },
      )
      observed.push(observedCommit, observedWait)
      await atOracleCheckpoint(firstRetryStored.promise, `first retry stored`)
      expect((await env.executor.peekOutbox())[0]?.retryCount).toBe(1)
      expect(commitStatus).toBe(`pending`)
      expect(waitStatus).toBe(`pending`)

      await turn()
      env.executor.getOnlineDetector().notifyOnline()
      await atOracleCheckpoint(
        secondDecisionStored.promise,
        `second decision stored`,
      )
      await turn()
      expect(hookCalls).toEqual([
        { error: firstError, retryCount: 0 },
        { error: secondError, retryCount: 1 },
      ])
      expect(hookCalls[0]?.error).toBe(firstError)
      expect(hookCalls[1]?.error).toBe(secondError)
      expect(env.mutationCalls).toHaveLength(2)
      if (secondDecision === `defer`) {
        expect(await env.executor.peekOutbox()).toMatchObject([
          { id: tx.id, retryCount: 2 },
        ])
        expect(commitStatus).toBe(`pending`)
        expect(waitStatus).toBe(`pending`)
        env.executor.getOnlineDetector().notifyOnline()
        await atOracleCheckpoint(
          Promise.all([observedCommit, observedWait]),
          `delegated second retry settled caller`,
        )
        expect(env.mutationCalls).toHaveLength(3)
        expect(commitStatus).toBe(`fulfilled`)
        expect(waitStatus).toBe(`fulfilled`)
        expect(await env.executor.peekOutbox()).toEqual([])
      } else {
        expect(await env.executor.peekOutbox()).toEqual([])
        await atOracleCheckpoint(
          Promise.all([observedCommit, observedWait]),
          `second failure settled caller`,
        )
        expect(commitStatus).toBe(secondError)
        expect(waitStatus).toBe(secondError)
      }
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      if (
        transactionId &&
        (commitStatus === `pending` || waitStatus === `pending`)
      )
        env.executor.rejectTransaction(
          transactionId,
          new Error(`retry count oracle cleanup`),
        )
      await cleanupOfflineOracle(
        [
          () => Promise.all(observed),
          () => env.executor.dispose(),
          () => env.collection.cleanup(),
          () => warning.mockRestore(),
        ],
        hasPrimaryFailure,
      )
    }
  },
)

// The same-Error contract is based on the thrown value, not its realm. A foreign
// Error with a status-bearing field must reach the public hook unchanged. The
// 401 is a boundary control: the default decision would terminate it, while
// the hook's true answer retains the row for a later successful attempt.
it(`passes a cross-realm Error unchanged to shouldRetry`, async () => {
  const providerError = runInNewContext(
    `Object.assign(new Error('HTTP 401 Unauthorized'), { status: 401 })`,
  ) as Error & { status: number }
  expect(providerError instanceof Error).toBe(false)
  const hookEntered = gate()
  const retryStored = gate()
  let transactionId = ``
  let hookError: Error | undefined
  class RetryStorage extends FakeStorageAdapter {
    override async set(key: string, value: string): Promise<void> {
      await super.set(key, value)
      if (key !== `tx:${transactionId}`) return
      if ((JSON.parse(value) as { retryCount: number }).retryCount === 1)
        retryStored.resolve()
    }
  }
  const env = createTestOfflineEnvironment({
    storage: new RetryStorage(),
    config: {
      jitter: false,
      shouldRetry: (error, retryCount) => {
        expect(retryCount).toBe(0)
        hookError = error
        hookEntered.resolve()
        return (error as Error & { status?: number }).status === 401
      },
    },
    mutationFn: (params) => {
      if (params.attempt === 1) throw providerError
      env.applyMutations(params.transaction.mutations)
    },
  })
  const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
  let commitResult: unknown = `pending`
  let observedCommit: Promise<void> | undefined
  let hasPrimaryFailure = false
  try {
    await env.waitForLeader()
    const tx = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })
    transactionId = tx.id
    tx.mutate(() =>
      env.collection.insert({
        id: `foreign-error-retry`,
        value: `pending`,
        completed: false,
        updatedAt: new Date(0),
      }),
    )
    observedCommit = tx.commit().then(
      () => {
        commitResult = `fulfilled`
      },
      (error: unknown) => {
        commitResult = error
      },
    )
    await atOracleCheckpoint(hookEntered.promise, `foreign Error reached hook`)
    expect(hookError).toBe(providerError)
    expect((hookError as Error & { status?: number }).status).toBe(401)
    await atOracleCheckpoint(retryStored.promise, `foreign Error retry stored`)
    expect((await env.executor.peekOutbox())[0]?.retryCount).toBe(1)
    expect(commitResult).toBe(`pending`)
    env.executor.getOnlineDetector().notifyOnline()
    await atOracleCheckpoint(observedCommit, `foreign Error retry settled`)
    expect(commitResult).toBe(`fulfilled`)
    expect(env.mutationCalls).toHaveLength(2)
    expect(await env.executor.peekOutbox()).toEqual([])
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    if (transactionId && commitResult === `pending`)
      env.executor.rejectTransaction(
        transactionId,
        new Error(`foreign Error oracle cleanup`),
      )
    await cleanupOfflineOracle(
      [
        () => observedCommit,
        () => env.executor.dispose(),
        () => env.collection.cleanup(),
        () => warning.mockRestore(),
      ],
      hasPrimaryFailure,
    )
  }
})

// The public hook always receives an Error, including when the named mutation
// function rejects with a primitive or object. Returning false distinguishes
// this hook decision from the default retry for these inputs. The public commit
// rejection must be the same converted Error observed by the hook.
it.each([
  { label: `string`, rejection: `network disconnected` },
  { label: `object`, rejection: { status: 401 } },
])(
  `passes a converted Error to shouldRetry for a $label rejection`,
  async ({ rejection }) => {
    const hookCalls: Array<{ error: Error; retryCount: number }> = []
    const env = createTestOfflineEnvironment({
      config: {
        shouldRetry: (error, retryCount) => {
          hookCalls.push({ error, retryCount })
          return false
        },
      },
      mutationFn: () => Promise.reject(rejection),
    })
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    let transactionId = ``
    let observedCommit: Promise<void> | undefined
    let commitStatus: unknown = `pending`
    let hasPrimaryFailure = false
    try {
      await env.waitForLeader()
      const tx = env.executor.createOfflineTransaction({
        mutationFnName: env.mutationFnName,
        autoCommit: false,
      })
      transactionId = tx.id
      tx.mutate(() =>
        env.collection.insert({
          id: `converted-error`,
          value: `pending`,
          completed: false,
          updatedAt: new Date(0),
        }),
      )
      observedCommit = tx.commit().then(
        () => {
          commitStatus = `fulfilled`
        },
        (error: unknown) => {
          commitStatus = error
        },
      )
      await atOracleCheckpoint(
        observedCommit,
        `non-Error rejection settled caller`,
      )
      expect(hookCalls).toEqual([{ error: expect.any(Error), retryCount: 0 }])
      expect(hookCalls[0]?.error).not.toBe(rejection)
      expect(commitStatus).toBe(hookCalls[0]?.error)
      expect(await env.executor.peekOutbox()).toEqual([])
      expect(env.collection.toArray).toEqual([])
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      if (transactionId && commitStatus === `pending`)
        env.executor.rejectTransaction(
          transactionId,
          new Error(`non-Error rejection oracle cleanup`),
        )
      await cleanupOfflineOracle(
        [
          () => observedCommit,
          () => env.executor.dispose(),
          () => env.collection.cleanup(),
          () => warning.mockRestore(),
        ],
        hasPrimaryFailure,
      )
    }
  },
)

// A configuration failure is observed through public commit(), not only the
// executor's internal batch promise. The provider error is a 401, so ignoring
// the hook would reject with the provider error. A Promise is invalid whether
// it fulfills or rejects; its later rejection must stay within this row-local
// failure boundary rather than become an unhandled process rejection. A fresh
// executor over the same storage must skip the failed row.
it.each([
  `throw`,
  `null`,
  `zero`,
  `promise-fulfilled`,
  `promise-rejected`,
] as const)(
  `rejects public commit when shouldRetry fails (%s)`,
  async (failureKind) => {
    const providerError = new Error(`HTTP 401 Unauthorized`)
    const hookError = new Error(`retry decision unavailable`)
    const asyncError = new Error(`async retry decision failed`)
    const { rejections: unhandled, cleanup: cleanupUnhandled } =
      captureUnhandledRejections()
    const providerEntered = gate()
    const releaseProvider = gate()
    const terminalMarkerStored = gate()
    const retryRecordStored = gate()
    let hookCalls = 0
    let transactionId = ``
    class DecisionStorage extends FakeStorageAdapter {
      override async set(key: string, value: string): Promise<void> {
        await super.set(key, value)
        if (key !== `tx:${transactionId}`) return
        const record = JSON.parse(value) as {
          outboxPhase?: string
          retryCount: number
        }
        if (record.outboxPhase === `rejection-pending`)
          terminalMarkerStored.resolve()
        if (record.retryCount === 1) retryRecordStored.resolve()
      }
    }
    const config = {
      jitter: false,
      shouldRetry: (
        _error: Error,
        _retryCount: number,
      ): boolean | undefined => {
        hookCalls++
        if (failureKind === `throw`) throw hookError
        if (failureKind === `null`)
          return null as unknown as boolean | undefined
        if (failureKind === `zero`) return 0 as unknown as boolean | undefined
        // An async hook returns a Promise. Neither outcome is a synchronous
        // retry decision, and a rejection must still be observed.
        return (failureKind === `promise-rejected`
          ? Promise.reject(asyncError)
          : Promise.resolve(true)) as unknown as boolean | undefined
      },
    }
    const storage = new DecisionStorage()
    const env = createTestOfflineEnvironment({
      storage,
      config,
      mutationFn: async () => {
        providerEntered.resolve()
        await releaseProvider.promise
        throw providerError
      },
    })
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    let restarted: ReturnType<typeof createTestOfflineEnvironment> | undefined
    let commitStatus: unknown = `pending`
    let hasPrimaryFailure = false
    try {
      await env.waitForLeader()
      const tx = env.executor.createOfflineTransaction({
        mutationFnName: env.mutationFnName,
        autoCommit: false,
      })
      transactionId = tx.id
      tx.mutate(() =>
        env.collection.insert({
          id: `invalid-decision`,
          value: `pending`,
          completed: false,
          updatedAt: new Date(0),
        }),
      )
      const observedCommit = tx.commit().then(
        () => {
          commitStatus = `fulfilled`
        },
        (error: unknown) => {
          commitStatus = error
        },
      )
      await atOracleCheckpoint(providerEntered.promise, `provider entered`)
      const [admitted] = await env.executor.peekOutbox()
      expect(admitted?.retryCount).toBe(0)
      releaseProvider.resolve()
      // The first durable decision must be terminal. A mistaken implementation
      // that awaits a Promise answer stores a retry record instead of a marker.
      const storedDecision = await atOracleCheckpoint(
        Promise.race([
          terminalMarkerStored.promise.then(() => `terminal` as const),
          retryRecordStored.promise.then(() => `retry` as const),
        ]),
        `invalid decision recorded`,
      )
      expect(storedDecision).toBe(`terminal`)
      await atOracleCheckpoint(
        observedCommit,
        `invalid decision settled caller`,
      )

      if (failureKind === `throw`) expect(commitStatus).toBe(hookError)
      else {
        expect(commitStatus).toBeInstanceOf(TypeError)
        expect(commitStatus).not.toBe(providerError)
      }
      expect(hookCalls).toBe(1)
      const remaining = await env.executor.peekOutbox()
      await turn()
      expect(unhandled).toEqual([])
      expect(env.executor.getRunningCount()).toBe(0)
      expect(env.mutationCalls).toHaveLength(1)
      expect(env.collection.toArray).toEqual([])

      env.executor.dispose()
      restarted = createTestOfflineEnvironment({
        storage,
        mutationFn: (params) => {
          restarted!.applyMutations(params.transaction.mutations)
        },
      })
      await restarted.waitForLeader()
      const fresh = restarted.executor.createOfflineTransaction({
        mutationFnName: restarted.mutationFnName,
        autoCommit: false,
      })
      fresh.mutate(() =>
        restarted!.collection.insert({
          id: `after-hook-failure`,
          value: `fresh`,
          completed: false,
          updatedAt: new Date(1),
        }),
      )
      await atOracleCheckpoint(fresh.commit(), `fresh work after hook failure`)
      // The new transaction proves that restart has passed the FIFO head.
      // A retained failed row would have called the provider before this one.
      expect(
        restarted.mutationCalls.map(({ transaction: { id } }) => id),
      ).toEqual([fresh.id])
      expect(remaining).toEqual([])
      expect(await restarted.executor.peekOutbox()).toEqual([])
      expect(restarted.collection.toArray.map(({ id }) => id)).toEqual([
        `after-hook-failure`,
      ])
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseProvider.resolve()
      if (transactionId && commitStatus === `pending`)
        env.executor.rejectTransaction(
          transactionId,
          new Error(`invalid decision oracle cleanup`),
        )
      await cleanupOfflineOracle(
        [
          () => env.executor.dispose(),
          () => restarted?.executor.dispose(),
          () => env.collection.cleanup(),
          () => restarted?.collection.cleanup(),
          () => warning.mockRestore(),
          () => cleanupUnhandled(),
        ],
        hasPrimaryFailure,
      )
    }
  },
)

// The model treats an acknowledged peer write as queued work. The hook fault
// belongs to the head row; a peer admitted before or during terminal cleanup
// stays pending until the head's deletion acknowledges and its provider runs.
// This relation does not copy the executor's queue or cleanup machinery.
function expectedHookFaultPeerAtHeldCleanup(): {
  durable: true
  outcome: `pending`
} {
  return { durable: true, outcome: `pending` }
}

function observedFaultAdmissionOutcome(value: unknown) {
  if (value instanceof Error) return `rejected`
  return value
}

// Legal history: the FIFO head enters its named mutation function, one peer
// becomes durable, then the hook throws or returns an invalid result. Storage
// holds the terminal marker read, write, or deletion while a second public commit
// joins the queue. The held cut compares settlement, exact outbox contents,
// provider calls, and optimistic rows. After deletion, both peers must run in
// FIFO order in this executor. The held Promise rejects only after both peers
// settle, so its later failure must not escape as an unhandled process
// rejection. No storage write fails.
it.each([
  [`throw`, `marker`],
  [`throw`, `read`],
  [`throw`, `deletion`],
  [`invalid`, `marker`],
  [`invalid`, `read`],
  [`invalid`, `deletion`],
  [`promise-late-rejection`, `deletion`],
] as const)(
  `admits queued work during %s hook failure and %s cleanup`,
  async (failureKind, heldStep) => {
    const providerError = new Error(`HTTP 401 Unauthorized`)
    const hookError = new Error(`retry decision failed`)
    const asyncError = new Error(`async retry decision failed`)
    const { rejections: unhandled, cleanup: cleanupUnhandled } =
      captureUnhandledRejections()
    const providerEntered = gate()
    const releaseProvider = gate()
    const hookEntered = gate()
    const preFaultStored = gate()
    const terminalCleanupEntered = gate()
    const releaseTerminalCleanup = gate()
    const postFaultStored = gate()
    let headId = ``
    let preFaultId = ``
    let postFaultId = ``
    let holdTerminalRead = false
    let asyncDecision: Promise<boolean> | undefined
    let rejectAsyncDecision: ((error: Error) => void) | undefined
    let lateDecisionRejected = false
    const providerCalls: Array<string> = []

    class HeldTerminalDeleteStorage extends FakeStorageAdapter {
      override async get(key: string): Promise<string | null> {
        if (heldStep === `read` && key === `tx:${headId}` && holdTerminalRead) {
          holdTerminalRead = false
          terminalCleanupEntered.resolve()
          await releaseTerminalCleanup.promise
        }
        return super.get(key)
      }

      override async set(key: string, value: string): Promise<void> {
        if (
          heldStep === `marker` &&
          key === `tx:${headId}` &&
          (JSON.parse(value) as { outboxPhase?: string }).outboxPhase ===
            `rejection-pending`
        ) {
          terminalCleanupEntered.resolve()
          await releaseTerminalCleanup.promise
        }
        await super.set(key, value)
        if (key === `tx:${preFaultId}`) preFaultStored.resolve()
        if (key === `tx:${postFaultId}`) postFaultStored.resolve()
      }

      override async delete(key: string): Promise<void> {
        if (heldStep === `deletion` && key === `tx:${headId}`) {
          terminalCleanupEntered.resolve()
          await releaseTerminalCleanup.promise
        }
        await super.delete(key)
      }
    }

    const env = createTestOfflineEnvironment({
      storage: new HeldTerminalDeleteStorage(),
      config: {
        shouldRetry: (): boolean | undefined => {
          hookEntered.resolve()
          holdTerminalRead = true
          if (failureKind === `throw`) throw hookError
          if (failureKind === `promise-late-rejection`) {
            asyncDecision = new Promise<boolean>((_resolve, reject) => {
              rejectAsyncDecision = reject
            })
            return asyncDecision as unknown as boolean | undefined
          }
          return null as unknown as boolean | undefined
        },
      },
      mutationFn: async ({ transaction }) => {
        providerCalls.push(transaction.id)
        if (transaction.id === headId) {
          providerEntered.resolve()
          await releaseProvider.promise
          throw providerError
        }
        env.applyMutations(transaction.mutations)
      },
    })
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const errorLog = vi.spyOn(console, `error`).mockImplementation(() => {})
    const observed: Array<Promise<void>> = []
    const outcomes = new Map<string, unknown>()
    let hasPrimaryFailure = false

    // The production driver uses public transactions and their commit promises.
    // Each outcome starts pending so the held checkpoint can reject early success.
    function createObservedTransaction(rowId: string, updatedAt: number) {
      const tx = env.executor.createOfflineTransaction({
        mutationFnName: env.mutationFnName,
        autoCommit: false,
      })
      tx.mutate(() =>
        env.collection.insert({
          id: rowId,
          value: rowId,
          completed: false,
          updatedAt: new Date(updatedAt),
        }),
      )
      outcomes.set(tx.id, `pending`)
      const commit = tx.commit().then(
        () => {
          outcomes.set(tx.id, `fulfilled`)
        },
        (error: unknown) => {
          outcomes.set(tx.id, error)
        },
      )
      observed.push(commit)
      return { id: tx.id, commit }
    }

    try {
      await env.waitForLeader()
      const head = createObservedTransaction(`head`, 0)
      headId = head.id
      await atOracleCheckpoint(providerEntered.promise, `head provider entered`)

      const preFault = createObservedTransaction(`before-fault`, 1)
      preFaultId = preFault.id
      await atOracleCheckpoint(preFaultStored.promise, `pre-fault peer durable`)
      releaseProvider.resolve()
      await atOracleCheckpoint(hookEntered.promise, `retry hook failed`)
      await atOracleCheckpoint(
        terminalCleanupEntered.promise,
        `terminal ${heldStep} held`,
      )

      const postFault = createObservedTransaction(`after-fault`, 2)
      postFaultId = postFault.id
      const firstObservation = await atOracleCheckpoint(
        Promise.race([
          postFault.commit.then(() => `settled` as const),
          postFaultStored.promise.then(() => `durable` as const),
        ]),
        `post-fault admission or rejection`,
      )

      const before = expectedHookFaultPeerAtHeldCleanup()
      const after = expectedHookFaultPeerAtHeldCleanup()
      const outboxAtHeldCleanup = await env.executor.peekOutbox()
      const durableIds = new Set(outboxAtHeldCleanup.map(({ id }) => id))
      // The race rejects an early admission refusal at this exact cut;
      // waiting for final cleanup alone would hide the transient violation.
      expect(firstObservation).toBe(`durable`)
      expect(durableIds.has(preFault.id)).toBe(before.durable)
      expect(durableIds.has(postFault.id)).toBe(after.durable)
      expect([...durableIds].sort()).toEqual(
        [head.id, preFault.id, postFault.id].sort(),
      )
      expect(observedFaultAdmissionOutcome(outcomes.get(preFault.id))).toBe(
        before.outcome,
      )
      expect(observedFaultAdmissionOutcome(outcomes.get(postFault.id))).toBe(
        after.outcome,
      )
      expect(outcomes.get(head.id)).toBe(`pending`)
      expect(
        outboxAtHeldCleanup.find(({ id }) => id === head.id)?.outboxPhase,
      ).toBe(heldStep === `deletion` ? `rejection-pending` : undefined)
      expect(
        outboxAtHeldCleanup.find(({ id }) => id === preFault.id)?.outboxPhase,
      ).toBeUndefined()
      expect(providerCalls).toEqual([head.id])
      expect(env.collection.toArray.map(({ id }) => id).sort()).toEqual([
        `after-fault`,
        `before-fault`,
        `head`,
      ])

      releaseTerminalCleanup.resolve()
      await atOracleCheckpoint(head.commit, `failed head settled`)
      if (failureKind === `throw`) expect(outcomes.get(head.id)).toBe(hookError)
      else expect(outcomes.get(head.id)).toBeInstanceOf(TypeError)
      await atOracleCheckpoint(preFault.commit, `pre-fault peer settled`)
      await atOracleCheckpoint(postFault.commit, `post-fault peer settled`)
      expect(outcomes.get(preFault.id)).toBe(`fulfilled`)
      expect(outcomes.get(postFault.id)).toBe(`fulfilled`)
      expect(await env.executor.peekOutbox()).toEqual([])
      expect(providerCalls).toEqual([head.id, preFault.id, postFault.id])
      expect(env.collection.toArray.map(({ id }) => id).sort()).toEqual([
        `after-fault`,
        `before-fault`,
      ])
      if (failureKind === `promise-late-rejection`) {
        expect(rejectAsyncDecision).toBeTypeOf(`function`)
        rejectAsyncDecision?.(asyncError)
        lateDecisionRejected = true
      }
      await turn()
      expect(unhandled).toEqual([])
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      if (asyncDecision && !lateDecisionRejected) {
        // Release a mutant that wrongly awaits this test-owned Promise.
        void asyncDecision.catch(() => {})
        rejectAsyncDecision?.(asyncError)
      }
      releaseProvider.resolve()
      releaseTerminalCleanup.resolve()
      const cleanupError = new Error(`hook-fault admission oracle cleanup`)
      for (const [id, outcome] of outcomes)
        if (outcome === `pending`)
          env.executor.rejectTransaction(id, cleanupError)
      await cleanupOfflineOracle(
        [
          () => Promise.all(observed),
          () => env.executor.dispose(),
          () => env.collection.cleanup(),
          () => warning.mockRestore(),
          () => errorLog.mockRestore(),
          () => cleanupUnhandled(),
        ],
        hasPrimaryFailure,
      )
    }
  },
)

// A hook failure removes only the head. The already queued peer then runs in
// the same batch, and a later batch remains available for new work.
it(`continues queued work after shouldRetry throws`, async () => {
  const providerError = new Error(`HTTP 401 Unauthorized`)
  const hookError = new Error(`retry decision failed`)
  const outbox = new OutboxManager(new FakeStorageAdapter(), {})
  const scheduler = new KeyScheduler()
  const rejections: Array<Error> = []
  const resolutions: Array<string> = []
  let peerCalls = 0
  const signaler: TransactionSignaler = {
    isOfflineEnabled: true,
    isOnline: () => true,
    resolveTransaction: (id) => {
      if (id === `hook-failure-head`)
        throw new Error(`failed head cannot resolve`)
      resolutions.push(id)
    },
    rejectTransaction: (_id, error) => rejections.push(error),
    registerRestorationTransaction: () => {},
  }
  const executor = new TransactionExecutor(
    scheduler,
    outbox,
    {
      collections: {},
      mutationFns: {
        head: () => Promise.reject(providerError),
        peer: () => {
          peerCalls++
          return Promise.resolve()
        },
      },
      shouldRetry: () => {
        throw hookError
      },
    },
    signaler,
  )
  const head: OfflineTransaction = {
    id: `hook-failure-head`,
    mutationFnName: `head`,
    mutations: [],
    keys: [],
    idempotencyKey: `hook-failure-head`,
    createdAt: new Date(0),
    retryCount: 0,
    nextAttemptAt: 0,
    version: 1,
  }
  const peer: OfflineTransaction = {
    ...head,
    id: `hook-failure-peer`,
    mutationFnName: `peer`,
    idempotencyKey: `hook-failure-peer`,
    createdAt: new Date(1),
  }
  const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
  try {
    await outbox.add(head)
    await outbox.add(peer)
    scheduler.schedule(peer)
    await expect(executor.execute(head)).resolves.toBeUndefined()
    expect(rejections).toEqual([hookError])
    expect(await outbox.get(head.id)).toBeNull()
    expect(await outbox.get(peer.id)).toBeNull()
    expect(scheduler.getPendingCount()).toBe(0)
    expect(peerCalls).toBe(1)
    expect(resolutions).toEqual([peer.id])
    await expect(executor.executeAll()).resolves.toBeUndefined()
    expect(peerCalls).toBe(1)
    expect(resolutions).toEqual([peer.id])
  } finally {
    executor.pause()
    warning.mockRestore()
  }
})

it(`keeps commit pending until successful outbox deletion`, async () => {
  const deletionEntered = gate()
  const releaseDeletion = gate()
  class Storage extends FakeStorageAdapter {
    override async delete(key: string): Promise<void> {
      if (key.startsWith(`tx:`)) {
        deletionEntered.resolve()
        await releaseDeletion.promise
      }
      await super.delete(key)
    }
  }
  const env = createTestOfflineEnvironment({ storage: new Storage() })
  let commitStatus: unknown = `pending`
  let persistedStatus: unknown = `pending`
  let transactionId = ``
  let observed: Promise<void> | undefined
  let observedPersistence: Promise<void> | undefined
  let hasPrimaryFailure = false
  try {
    await env.waitForLeader()
    const transaction = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })
    transactionId = transaction.id
    const localTransaction = transaction.mutate(() =>
      env.collection.insert({
        id: `held-delete`,
        value: `provider-applied`,
        completed: false,
        updatedAt: new Date(0),
      }),
    )
    observedPersistence = localTransaction.isPersisted.promise.then(
      () => {
        persistedStatus = `fulfilled`
      },
      (error: unknown) => {
        persistedStatus = error
      },
    )
    observed = transaction.commit().then(
      () => {
        commitStatus = `fulfilled`
      },
      (error: unknown) => {
        commitStatus = error
      },
    )

    await atOracleCheckpoint(deletionEntered.promise, `outbox deletion entered`)
    await turn()
    expect(env.mutationCalls.map(({ transaction: { id } }) => id)).toEqual([
      transactionId,
    ])
    expect(env.serverState.has(`held-delete`)).toBe(true)
    expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual([
      transactionId,
    ])
    expect([commitStatus, persistedStatus, localTransaction.state]).toEqual([
      `pending`,
      `pending`,
      `persisting`,
    ])

    releaseDeletion.resolve()
    await atOracleCheckpoint(
      Promise.all([observed, observedPersistence]),
      `outbox deletion settled caller`,
    )
    expect([commitStatus, persistedStatus, localTransaction.state]).toEqual([
      `fulfilled`,
      `fulfilled`,
      `completed`,
    ])
    expect(await env.executor.peekOutbox()).toEqual([])
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseDeletion.resolve()
    if (commitStatus === `pending` && transactionId)
      env.executor.resolveTransaction(transactionId, undefined)
    await cleanupOfflineOracle(
      [
        () => Promise.all([observed, observedPersistence]),
        () => env.executor.dispose(),
        () => env.collection.cleanup(),
      ],
      hasPrimaryFailure,
    )
  }
})

it.each([`removeFromOutbox`, `clearOutbox`] as const)(
  `settles active provider work after %s acknowledges outbox deletion`,
  async (removal) => {
    const providerEntered = gate()
    const releaseProvider = gate()
    const env = createTestOfflineEnvironment({
      mutationFn: async (params) => {
        providerEntered.resolve()
        await releaseProvider.promise
        env.applyMutations(params.transaction.mutations)
      },
    })
    let transactionId = ``
    let commitStatus: unknown = `pending`
    let persistedStatus: unknown = `pending`
    let observed: Promise<void> | undefined
    let observedPersistence: Promise<void> | undefined
    let hasPrimaryFailure = false
    try {
      await env.waitForLeader()
      const transaction = env.executor.createOfflineTransaction({
        mutationFnName: env.mutationFnName,
        autoCommit: false,
      })
      transactionId = transaction.id
      const localTransaction = transaction.mutate(() =>
        env.collection.insert({
          id: `manually-removed-active`,
          value: `provider-applied`,
          completed: false,
          updatedAt: new Date(0),
        }),
      )
      observedPersistence = localTransaction.isPersisted.promise.then(
        () => {
          persistedStatus = `fulfilled`
        },
        (error: unknown) => {
          persistedStatus = error
        },
      )
      observed = transaction.commit().then(
        () => {
          commitStatus = `fulfilled`
        },
        (error: unknown) => {
          commitStatus = error
        },
      )

      await atOracleCheckpoint(providerEntered.promise, `provider held`)
      expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual([
        transactionId,
      ])
      if (removal === `removeFromOutbox`)
        await env.executor.removeFromOutbox(transactionId)
      else await env.executor.clearOutbox()
      expect(await env.executor.peekOutbox()).toEqual([])
      expect([commitStatus, persistedStatus, localTransaction.state]).toEqual([
        `pending`,
        `pending`,
        `persisting`,
      ])

      releaseProvider.resolve()
      await atOracleCheckpoint(
        Promise.all([observed, observedPersistence]),
        `provider fulfillment after ${removal} deletion settled caller`,
      )
      expect([commitStatus, persistedStatus, localTransaction.state]).toEqual([
        `fulfilled`,
        `fulfilled`,
        `completed`,
      ])
      expect(env.mutationCalls.map(({ transaction: { id } }) => id)).toEqual([
        transactionId,
      ])
      expect(env.serverState.has(`manually-removed-active`)).toBe(true)
      expect(await env.executor.peekOutbox()).toEqual([])
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseProvider.resolve()
      if (commitStatus === `pending` && transactionId)
        env.executor.resolveTransaction(transactionId, undefined)
      await cleanupOfflineOracle(
        [
          () => Promise.all([observed, observedPersistence]),
          () => env.executor.dispose(),
          () => env.collection.cleanup(),
        ],
        hasPrimaryFailure,
      )
    }
  },
)

// The independently chosen result is a rejection with the provider error:
// deletion is already acknowledged, and a retry cannot re-admit that row.
// Hold the real public provider call, remove its outbox entry, then reject it.
// The checkpoint compares both caller promises and the outbox before admitting
// a later peer. The peer checks that a missing retry record did not stop the
// executor. The default network retry and overridden 401 retry reach the same
// persistence boundary by different decisions.
it.each([
  [`removeFromOutbox`, `default`],
  [`removeFromOutbox`, `hook`],
  [`clearOutbox`, `default`],
  [`clearOutbox`, `hook`],
] as const)(
  `rejects a failed provider after %s removed its outbox row (%s retry)`,
  async (removal, retryDecision) => {
    const providerEntered = gate()
    const releaseProvider = gate()
    const providerError = new Error(
      retryDecision === `hook`
        ? `HTTP 401 Unauthorized`
        : `network unavailable`,
    )
    let headId = ``
    const env = createTestOfflineEnvironment({
      config: {
        jitter: false,
        ...(retryDecision === `hook`
          ? { shouldRetry: (error: Error) => error === providerError }
          : {}),
      },
      mutationFn: async (params) => {
        if (params.transaction.id === headId) {
          providerEntered.resolve()
          await releaseProvider.promise
          throw providerError
        }
        env.applyMutations(params.transaction.mutations)
      },
    })
    let headCommit: Promise<void> | undefined
    let headPersistence: Promise<void> | undefined
    let headCommitResult: unknown = `pending`
    let headPersistenceResult: unknown = `pending`
    let hasPrimaryFailure = false
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    try {
      await env.waitForLeader()
      const head = env.executor.createOfflineTransaction({
        mutationFnName: env.mutationFnName,
        autoCommit: false,
      })
      headId = head.id
      const localHead = head.mutate(() =>
        env.collection.insert({
          id: `removed-failure`,
          value: `never-applied`,
          completed: false,
          updatedAt: new Date(0),
        }),
      )
      headPersistence = localHead.isPersisted.promise.then(
        () => {
          headPersistenceResult = `fulfilled`
        },
        (error: unknown) => {
          headPersistenceResult = error
        },
      )
      headCommit = head.commit().then(
        () => {
          headCommitResult = `fulfilled`
        },
        (error: unknown) => {
          headCommitResult = error
        },
      )

      await atOracleCheckpoint(providerEntered.promise, `provider held`)
      expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual([
        headId,
      ])
      if (removal === `removeFromOutbox`)
        await env.executor.removeFromOutbox(headId)
      else await env.executor.clearOutbox()
      expect(await env.executor.peekOutbox()).toEqual([])
      expect([headCommitResult, headPersistenceResult]).toEqual([
        `pending`,
        `pending`,
      ])

      releaseProvider.resolve()
      if (removal === `removeFromOutbox`) {
        await vi.waitFor(() => expect(env.executor.getRunningCount()).toBe(0))
        await Promise.resolve()
        await Promise.resolve()
      }
      await atOracleCheckpoint(
        Promise.all([headCommit, headPersistence]),
        `provider rejection after acknowledged removal`,
      )
      expect([headCommitResult, headPersistenceResult]).toEqual([
        providerError,
        providerError,
      ])
      expect(localHead.state).toBe(`failed`)
      expect(await env.executor.peekOutbox()).toEqual([])
      expect(env.mutationCalls.map(({ transaction: { id } }) => id)).toEqual([
        headId,
      ])

      const peer = env.executor.createOfflineTransaction({
        mutationFnName: env.mutationFnName,
        autoCommit: false,
      })
      peer.mutate(() =>
        env.collection.insert({
          id: `later-peer`,
          value: `applied`,
          completed: false,
          updatedAt: new Date(0),
        }),
      )
      await atOracleCheckpoint(peer.commit(), `later peer settled`)
      expect(env.mutationCalls.map(({ transaction: { id } }) => id)).toEqual([
        headId,
        peer.id,
      ])
      expect(env.serverState.has(`removed-failure`)).toBe(false)
      expect(env.serverState.has(`later-peer`)).toBe(true)
      expect(await env.executor.peekOutbox()).toEqual([])
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releaseProvider.resolve()
      if (headCommitResult === `pending` && headId)
        env.executor.rejectTransaction(headId, providerError)
      await cleanupOfflineOracle(
        [
          () => Promise.all([headCommit, headPersistence]),
          () => env.executor.dispose(),
          () => env.collection.cleanup(),
          () => warning.mockRestore(),
        ],
        hasPrimaryFailure,
      )
    }
  },
)

it(`stops successful provider work when outbox deletion fails`, async () => {
  const firstProviderEntered = gate()
  const releaseFirstProvider = gate()
  const deletionAttempted = gate()
  const storageError = new Error(`acknowledgement cleanup failed`)
  let transactionId = ``
  class Storage extends FakeStorageAdapter {
    attempts = 0
    override async delete(key: string): Promise<void> {
      if (key === `tx:${transactionId}`) {
        this.attempts++
        deletionAttempted.resolve()
        throw storageError
      }
      await super.delete(key)
    }
  }
  const storage = new Storage()
  const env = createTestOfflineEnvironment({
    storage,
    mutationFn: async (params) => {
      if (params.transaction.id === transactionId) {
        firstProviderEntered.resolve()
        await releaseFirstProvider.promise
      }
      env.applyMutations(params.transaction.mutations)
    },
  })
  const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
  let commitStatus: unknown = `pending`
  let persistedStatus: unknown = `pending`
  let peerStatus: unknown = `pending`
  let peerId = ``
  let observed: Promise<void> | undefined
  let observedPersistence: Promise<void> | undefined
  let observedPeer: Promise<void> | undefined
  let hasPrimaryFailure = false
  try {
    await env.waitForLeader()
    const transaction = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })
    transactionId = transaction.id
    const localTransaction = transaction.mutate(() =>
      env.collection.insert({
        id: `successful-cleanup-failure`,
        value: `provider-applied`,
        completed: false,
        updatedAt: new Date(0),
      }),
    )
    observedPersistence = localTransaction.isPersisted.promise.then(
      () => {
        persistedStatus = `fulfilled`
      },
      (error: unknown) => {
        persistedStatus = error
      },
    )
    observed = transaction.commit().then(
      () => {
        commitStatus = `fulfilled`
      },
      (error: unknown) => {
        commitStatus = error
      },
    )

    await atOracleCheckpoint(
      firstProviderEntered.promise,
      `first provider held`,
    )
    const peer = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })
    peerId = peer.id
    peer.mutate(() =>
      env.collection.insert({
        id: `queued-peer`,
        value: `provider-applied`,
        completed: false,
        updatedAt: new Date(1),
      }),
    )
    observedPeer = peer.commit().then(
      () => {
        peerStatus = `fulfilled`
      },
      (error: unknown) => {
        peerStatus = error
      },
    )
    await turn()
    releaseFirstProvider.resolve()

    await atOracleCheckpoint(
      deletionAttempted.promise,
      `successful acknowledgement cleanup attempted`,
    )
    await turn()

    expect(env.mutationCalls.map(({ transaction: { id } }) => id)).toEqual([
      transactionId,
    ])
    expect(env.serverState.has(`successful-cleanup-failure`)).toBe(true)
    expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual([
      transactionId,
      peerId,
    ])
    expect([
      commitStatus,
      persistedStatus,
      localTransaction.state,
      peerStatus,
    ]).toEqual([storageError, storageError, `failed`, `pending`])

    env.executor.getOnlineDetector().notifyOnline()
    await turn()
    expect(storage.attempts).toBe(1)
    expect(env.mutationCalls.map(({ transaction: { id } }) => id)).toEqual([
      transactionId,
    ])
    expect(peerStatus).toBe(`pending`)
    const later = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })
    later.mutate(() =>
      env.collection.insert({
        id: `after-storage-stop`,
        value: `not-admitted`,
        completed: false,
        updatedAt: new Date(2),
      }),
    )
    await expect(later.commit()).rejects.toBe(storageError)
    expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual([
      transactionId,
      peerId,
    ])
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseFirstProvider.resolve()
    if (commitStatus === `pending` && transactionId)
      env.executor.resolveTransaction(transactionId, undefined)
    if (peerStatus === `pending` && peerId)
      env.executor.resolveTransaction(peerId, undefined)
    await cleanupOfflineOracle(
      [
        () => Promise.all([observed, observedPersistence, observedPeer]),
        () => env.executor.dispose(),
        () => env.collection.cleanup(),
        () => warning.mockRestore(),
      ],
      hasPrimaryFailure,
    )
  }
})

it(`stops after a failed deletion-pending write and holds its queued peer`, async () => {
  const firstProviderEntered = gate()
  const releaseFirstProvider = gate()
  const markerWriteFailed = gate()
  const markerError = new Error(`deletion-pending record unavailable`)
  let headId = ``
  class Storage extends FakeStorageAdapter {
    markerWrites = 0
    deletedIds: Array<string> = []

    override async set(key: string, value: string): Promise<void> {
      if (
        key === `tx:${headId}` &&
        (JSON.parse(value) as { outboxPhase?: string }).outboxPhase ===
          `deletion-pending`
      ) {
        this.markerWrites++
        markerWriteFailed.resolve()
        throw markerError
      }
      await super.set(key, value)
    }

    override async delete(key: string): Promise<void> {
      if (key.startsWith(`tx:`)) this.deletedIds.push(key.slice(3))
      await super.delete(key)
    }
  }
  const storage = new Storage()
  const env = createTestOfflineEnvironment({
    storage,
    mutationFn: async (params) => {
      if (params.transaction.id === headId) {
        firstProviderEntered.resolve()
        await releaseFirstProvider.promise
      }
      env.applyMutations(params.transaction.mutations)
    },
  })
  let headStatus: unknown = `pending`
  let persistedStatus: unknown = `pending`
  let peerStatus: unknown = `pending`
  let peerId = ``
  let observedHead: Promise<void> | undefined
  let observedPersistence: Promise<void> | undefined
  let observedPeer: Promise<void> | undefined
  let hasPrimaryFailure = false
  try {
    await env.waitForLeader()
    const head = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })
    headId = head.id
    const localTransaction = head.mutate(() =>
      env.collection.insert({
        id: `marker-write-head`,
        value: `provider-applied`,
        completed: false,
        updatedAt: new Date(0),
      }),
    )
    observedPersistence = localTransaction.isPersisted.promise.then(
      () => {
        persistedStatus = `fulfilled`
      },
      (error: unknown) => {
        persistedStatus = error
      },
    )
    observedHead = head.commit().then(
      () => {
        headStatus = `fulfilled`
      },
      (error: unknown) => {
        headStatus = error
      },
    )

    await atOracleCheckpoint(firstProviderEntered.promise, `head provider held`)
    const peer = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })
    peerId = peer.id
    peer.mutate(() =>
      env.collection.insert({
        id: `marker-write-peer`,
        value: `queued`,
        completed: false,
        updatedAt: new Date(1),
      }),
    )
    observedPeer = peer.commit().then(
      () => {
        peerStatus = `fulfilled`
      },
      (error: unknown) => {
        peerStatus = error
      },
    )
    await turn()
    releaseFirstProvider.resolve()

    await atOracleCheckpoint(
      markerWriteFailed.promise,
      `fulfilled-provider marker write failed`,
    )
    await turn()
    expect(env.mutationCalls.map(({ transaction: { id } }) => id)).toEqual([
      headId,
    ])
    expect(env.serverState.has(`marker-write-head`)).toBe(true)
    expect(env.serverState.has(`marker-write-peer`)).toBe(false)
    expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual([
      headId,
      peerId,
    ])
    expect((await env.executor.peekOutbox())[0]?.outboxPhase).toBeUndefined()
    expect(storage.deletedIds).toEqual([])
    expect([
      headStatus,
      persistedStatus,
      localTransaction.state,
      peerStatus,
    ]).toEqual([markerError, markerError, `failed`, `pending`])

    env.executor.getOnlineDetector().notifyOnline()
    await turn()
    expect(storage.markerWrites).toBe(1)
    expect(env.mutationCalls.map(({ transaction: { id } }) => id)).toEqual([
      headId,
    ])
    expect(storage.deletedIds).toEqual([])
    expect(peerStatus).toBe(`pending`)
    expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual([
      headId,
      peerId,
    ])
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseFirstProvider.resolve()
    if (headStatus === `pending` && headId)
      env.executor.resolveTransaction(headId, undefined)
    if (peerStatus === `pending` && peerId)
      env.executor.resolveTransaction(peerId, undefined)
    await cleanupOfflineOracle(
      [
        () => Promise.all([observedHead, observedPersistence, observedPeer]),
        () => env.executor.dispose(),
        () => env.collection.cleanup(),
      ],
      hasPrimaryFailure,
    )
  }
})

it(`restarts a fulfilled provider transaction after a stopped deletion failure`, async () => {
  const firstDeletionAttempted = gate()
  const restartedDeletionAttempted = gate()
  const storageError = new Error(`acknowledgement cleanup failed`)
  const providerCalls: Array<{ id: string; idempotencyKey: string }> = []
  let providerFulfilled = false
  class Storage extends FakeStorageAdapter {
    failDeletes = true
    completedWritesAfterProviderFulfilled = 0

    override async set(key: string, value: string): Promise<void> {
      await super.set(key, value)
      if (providerFulfilled) this.completedWritesAfterProviderFulfilled++
    }

    override async delete(key: string): Promise<void> {
      if (key.startsWith(`tx:`)) {
        if (this.failDeletes) {
          firstDeletionAttempted.resolve()
          throw storageError
        }
        restartedDeletionAttempted.resolve()
      }
      await super.delete(key)
    }
  }
  const storage = new Storage()
  const first = createTestOfflineEnvironment({
    storage,
    mutationFn: (params) => {
      providerCalls.push({
        id: params.transaction.id,
        idempotencyKey: params.idempotencyKey,
      })
      first.applyMutations(params.transaction.mutations)
      providerFulfilled = true
    },
  })
  const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
  let second: ReturnType<typeof createTestOfflineEnvironment> | undefined
  let transactionId = ``
  let commitStatus: unknown = `pending`
  let persistedStatus: unknown = `pending`
  let observed: Promise<void> | undefined
  let observedPersistence: Promise<void> | undefined
  let replayStatus: unknown = `pending`
  let observedReplay: Promise<void> | undefined
  let hasPrimaryFailure = false
  try {
    await first.waitForLeader()
    const transaction = first.executor.createOfflineTransaction({
      mutationFnName: first.mutationFnName,
      autoCommit: false,
      idempotencyKey: `restart-after-provider-fulfillment`,
    })
    transactionId = transaction.id
    const localTransaction = transaction.mutate(() =>
      first.collection.insert({
        id: `restart-after-delete-failure`,
        value: `provider-applied`,
        completed: false,
        updatedAt: new Date(0),
      }),
    )
    observedPersistence = localTransaction.isPersisted.promise.then(
      () => {
        persistedStatus = `fulfilled`
      },
      (error: unknown) => {
        persistedStatus = error
      },
    )
    observed = transaction.commit().then(
      () => {
        commitStatus = `fulfilled`
      },
      (error: unknown) => {
        commitStatus = error
      },
    )

    await atOracleCheckpoint(
      firstDeletionAttempted.promise,
      `first deletion failed after provider fulfillment`,
    )
    await turn()
    expect(providerCalls).toEqual([
      {
        id: transactionId,
        idempotencyKey: `restart-after-provider-fulfillment`,
      },
    ])
    expect(first.serverState.has(`restart-after-delete-failure`)).toBe(true)
    expect((await first.executor.peekOutbox()).map(({ id }) => id)).toEqual([
      transactionId,
    ])
    expect([commitStatus, persistedStatus, localTransaction.state]).toEqual([
      storageError,
      storageError,
      `failed`,
    ])
    expect(storage.completedWritesAfterProviderFulfilled).toBeGreaterThan(0)
    const markerWrites = storage.completedWritesAfterProviderFulfilled

    first.executor.dispose()
    storage.failDeletes = false
    second = createTestOfflineEnvironment({
      storage,
      config: {
        // Filtering unfulfilled work cannot cancel already fulfilled provider
        // work whose only remaining obligation is durable deletion.
        beforeRetry: () => [],
      },
      mutationFn: (params) => {
        providerCalls.push({
          id: params.transaction.id,
          idempotencyKey: params.idempotencyKey,
        })
      },
    })
    observedReplay = second.executor
      .waitForTransactionCompletion(transactionId)
      .then(
        () => {
          replayStatus = `fulfilled`
        },
        (error: unknown) => {
          replayStatus = error
        },
      )
    await second.waitForLeader()
    await atOracleCheckpoint(
      restartedDeletionAttempted.promise,
      `restarted deletion attempted`,
    )
    expect(await second.executor.peekOutbox()).toEqual([])
    await atOracleCheckpoint(observedReplay, `restarted deletion settled`)
    expect(replayStatus).toBe(`fulfilled`)
    expect(providerCalls).toEqual([
      {
        id: transactionId,
        idempotencyKey: `restart-after-provider-fulfillment`,
      },
    ])
    expect(storage.completedWritesAfterProviderFulfilled).toBe(markerWrites)
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    if (commitStatus === `pending` && transactionId)
      first.executor.resolveTransaction(transactionId, undefined)
    await cleanupOfflineOracle(
      [
        () => Promise.all([observed, observedPersistence]),
        () => observedReplay,
        () => first.executor.dispose(),
        () => second?.executor.dispose(),
        () => first.collection.cleanup(),
        () => second?.collection.cleanup(),
        () => warning.mockRestore(),
      ],
      hasPrimaryFailure,
    )
  }
})

it(`replays an admitted row with no fulfilled-provider checkpoint`, async () => {
  const deletionCompleted = gate()
  class Storage extends FakeStorageAdapter {
    override async delete(key: string): Promise<void> {
      await super.delete(key)
      if (key === `tx:legacy-unmarked-transaction`) deletionCompleted.resolve()
    }
  }
  const storage = new Storage()
  const seed = createCollection<TestItem, string>({
    id: `test-items`,
    getKey: (row) => row.id,
    startSync: true,
    sync: { sync: (ops) => ops.markReady() },
  })
  const outbox = new OutboxManager(storage, { [seed.id]: seed })
  const seedTransaction = createTransaction({
    autoCommit: false,
    mutationFn: () => Promise.resolve(),
  })
  void seedTransaction.isPersisted.promise.catch(() => {})
  try {
    seedTransaction.mutate(() =>
      seed.insert({
        id: `legacy-unmarked`,
        value: `replay-me`,
        completed: false,
        updatedAt: new Date(0),
      }),
    )
    await outbox.add({
      id: `legacy-unmarked-transaction`,
      mutationFnName: `syncData`,
      mutations: seedTransaction.mutations,
      keys: seedTransaction.mutations.map(({ globalKey }) => globalKey),
      idempotencyKey: `legacy-unmarked-key`,
      createdAt: new Date(0),
      retryCount: 0,
      nextAttemptAt: 0,
      version: 1,
    })
  } finally {
    seedTransaction.rollback({ isSecondaryRollback: true })
    await seed.cleanup()
  }

  const providerEntered = gate()
  const providerCalls: Array<{ id: string; idempotencyKey: string }> = []
  const env = createTestOfflineEnvironment({
    storage,
    mutationFn: (params) => {
      providerCalls.push({
        id: params.transaction.id,
        idempotencyKey: params.idempotencyKey,
      })
      env.applyMutations(params.transaction.mutations)
      providerEntered.resolve()
    },
  })
  let hasPrimaryFailure = false
  try {
    await env.waitForLeader()
    await atOracleCheckpoint(
      providerEntered.promise,
      `unmarked provider replay`,
    )
    expect(providerCalls).toEqual([
      {
        id: `legacy-unmarked-transaction`,
        idempotencyKey: `legacy-unmarked-key`,
      },
    ])
    expect(env.serverState.has(`legacy-unmarked`)).toBe(true)
    await atOracleCheckpoint(
      deletionCompleted.promise,
      `unmarked replay outbox deletion`,
    )
    expect(await env.executor.peekOutbox()).toEqual([])
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    await cleanupOfflineOracle(
      [() => env.executor.dispose(), () => env.collection.cleanup()],
      hasPrimaryFailure,
    )
  }
})

// Deletion failure leaves a durable terminal marker. The two causes must both
// retain their own error and skip the provider when a fresh executor removes it.
async function checkTerminalFailureWithFailedDeletion(
  failureKind: `provider` | `hook`,
) {
  const deletionAttempted = gate()
  const restartedDeletionAttempted = gate()
  const releaseRestartedDeletion = gate()
  const primaryError =
    failureKind === `provider`
      ? new NonRetriableError(`provider rejected permanently`)
      : new Error(`retry decision failed`)
  const providerError =
    failureKind === `provider`
      ? primaryError
      : new Error(`HTTP 401 Unauthorized`)
  const storageError = new Error(`rejection cleanup failed`)
  class Storage extends FakeStorageAdapter {
    failDeletes = true
    override async delete(key: string): Promise<void> {
      if (key.startsWith(`tx:`)) {
        if (this.failDeletes) {
          deletionAttempted.resolve()
          throw storageError
        }
        restartedDeletionAttempted.resolve()
        await releaseRestartedDeletion.promise
      }
      await super.delete(key)
    }
  }
  const storage = new Storage()
  let providerCalls = 0
  const env = createTestOfflineEnvironment({
    storage,
    config:
      failureKind === `hook`
        ? {
            shouldRetry: () => {
              throw primaryError
            },
          }
        : {},
    mutationFn: () => {
      providerCalls++
      return Promise.reject(providerError)
    },
  })
  const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
  let restarted: ReturnType<typeof createTestOfflineEnvironment> | undefined
  let status: unknown = `pending`
  let replayStatus: unknown = `pending`
  let transactionId = ``
  let observed: Promise<void> | undefined
  let observedReplay: Promise<void> | undefined
  let hasPrimaryFailure = false
  try {
    await env.waitForLeader()
    const transaction = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })
    transactionId = transaction.id
    transaction.mutate(() =>
      env.collection.insert({
        id: `permanent-cleanup-failure`,
        value: `optimistic`,
        completed: false,
        updatedAt: new Date(0),
      }),
    )
    observed = transaction.commit().then(
      () => {
        status = `fulfilled`
      },
      (error: unknown) => {
        status = error
      },
    )

    await atOracleCheckpoint(
      deletionAttempted.promise,
      `permanent rejection cleanup attempted`,
    )
    await turn()

    expect(status).toBe(primaryError)
    expect((await env.executor.peekOutbox()).map(({ id }) => id)).toEqual([
      transaction.id,
    ])
    expect((await env.executor.peekOutbox())[0]).toMatchObject({
      outboxPhase: `rejection-pending`,
      lastError: { message: primaryError.message },
    })
    expect(providerCalls).toBe(1)

    env.executor.dispose()
    storage.failDeletes = false
    restarted = createTestOfflineEnvironment({
      storage,
      mutationFn: () => {
        providerCalls++
      },
    })
    observedReplay = restarted.executor
      .waitForTransactionCompletion(transactionId)
      .then(
        () => {
          replayStatus = `fulfilled`
        },
        (error: unknown) => {
          replayStatus = error
        },
      )
    await restarted.waitForLeader()
    await atOracleCheckpoint(
      restartedDeletionAttempted.promise,
      `terminal rejection deletion retried after restart`,
    )
    expect(providerCalls).toBe(1)
    expect(restarted.collection.toArray).toEqual([])
    releaseRestartedDeletion.resolve()
    await atOracleCheckpoint(observedReplay, `terminal replay settled`)
    expect(replayStatus).toMatchObject({
      name: primaryError.name,
      message: primaryError.message,
    })
    expect(await restarted.executor.peekOutbox()).toEqual([])
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    releaseRestartedDeletion.resolve()
    if (status === `pending` && transactionId)
      env.executor.rejectTransaction(transactionId, primaryError)
    if (replayStatus === `pending` && transactionId)
      restarted?.executor.rejectTransaction(transactionId, primaryError)
    await cleanupOfflineOracle(
      [
        () => observed,
        () => observedReplay,
        () => env.executor.dispose(),
        () => restarted?.executor.dispose(),
        () => env.collection.cleanup(),
        () => restarted?.collection.cleanup(),
        () => warning.mockRestore(),
      ],
      hasPrimaryFailure,
    )
  }
}

it.each([`provider`, `hook`] as const)(
  `preserves terminal %s failure when rejection cleanup also fails`,
  checkTerminalFailureWithFailedDeletion,
)

// The row-local hook law ends when terminal storage fails. A failed marker or
// deletion leaves the head's durable ownership unresolved, so the executor
// must stop before the queued peer runs. The failed head keeps the hook error;
// the batch reports the storage error. Provider-failure deletion is an adjacent
// control that preserves the established storage-stop boundary.
it.each([
  [`provider`, `deletion`],
  [`hook`, `marker`],
  [`hook`, `deletion`],
] as const)(
  `stops queued work after %s terminal failure and failed %s`,
  async (failureKind, failedStep) => {
    const providerError =
      failureKind === `provider`
        ? new NonRetriableError(`provider rejected`)
        : new Error(`HTTP 401 Unauthorized`)
    const hookError = new Error(`retry decision failed`)
    const callerError = failureKind === `hook` ? hookError : providerError
    const storageError = new Error(`${failedStep} rejected`)
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    class Storage extends FakeStorageAdapter {
      failCleanup = true

      override async set(key: string, value: string): Promise<void> {
        if (
          this.failCleanup &&
          failedStep === `marker` &&
          key === `tx:terminal-cleanup-head` &&
          (JSON.parse(value) as { outboxPhase?: string }).outboxPhase ===
            `rejection-pending`
        )
          throw storageError
        await super.set(key, value)
      }

      override async delete(key: string): Promise<void> {
        if (this.failCleanup && failedStep === `deletion`) throw storageError
        await super.delete(key)
      }
    }
    const storage = new Storage()
    const outbox = new OutboxManager(storage, {})
    const scheduler = new KeyScheduler()
    const rejections: Array<{ id: string; error: Error }> = []
    const resolutions: Array<string> = []
    let peerCalls = 0
    const signaler: TransactionSignaler = {
      isOfflineEnabled: true,
      isOnline: () => true,
      resolveTransaction: (id) => resolutions.push(id),
      rejectTransaction: (id, error) => rejections.push({ id, error }),
      registerRestorationTransaction: () => {},
    }
    const executor = new TransactionExecutor(
      scheduler,
      outbox,
      {
        collections: {},
        mutationFns: {
          syncData: () => Promise.reject(providerError),
          peer: () => {
            peerCalls++
            return Promise.resolve()
          },
        },
        ...(failureKind === `hook`
          ? {
              shouldRetry: () => {
                throw hookError
              },
            }
          : {}),
        jitter: false,
      },
      signaler,
    )
    const transaction: OfflineTransaction = {
      id: `terminal-cleanup-head`,
      mutationFnName: `syncData`,
      mutations: [],
      keys: [],
      idempotencyKey: `terminal-cleanup-head`,
      createdAt: new Date(0),
      retryCount: 0,
      nextAttemptAt: 0,
      version: 1,
    }
    const peer: OfflineTransaction = {
      ...transaction,
      id: `terminal-cleanup-peer`,
      mutationFnName: `peer`,
      idempotencyKey: `terminal-cleanup-peer`,
      createdAt: new Date(1),
    }
    await outbox.add(transaction)
    await outbox.add(peer)
    scheduler.schedule(peer)
    try {
      await expect(executor.execute(transaction)).rejects.toBe(storageError)
      expect(rejections).toEqual([{ id: transaction.id, error: callerError }])
      expect(resolutions).toEqual([])
      expect(peerCalls).toBe(0)
      expect(scheduler.getPendingCount()).toBe(2)
      expect((await outbox.get(transaction.id))?.outboxPhase).toBe(
        failedStep === `deletion` ? `rejection-pending` : undefined,
      )
      expect(await outbox.get(peer.id)).toMatchObject({ id: peer.id })

      storage.failCleanup = false
      executor.resetRetryDelays()
      await expect(executor.executeAll()).rejects.toBe(storageError)
      await expect(executor.execute(peer)).rejects.toBe(storageError)
      expect(peerCalls).toBe(0)
      expect(resolutions).toEqual([])
      expect(scheduler.getPendingCount()).toBe(2)
      expect(await outbox.get(peer.id)).toMatchObject({ id: peer.id })
    } finally {
      executor.pause()
      warning.mockRestore()
    }
  },
)

it(`stops after failed deletion without rerunning the provider`, async () => {
  const storageError = new Error(`delete rejected`)
  const rejections: Array<Error> = []
  const retryCounts: Array<number> = []
  const delay = vi.spyOn(DefaultRetryPolicy.prototype, `calculateDelay`)
  delay.mockImplementation((retryCount) => {
    retryCounts.push(retryCount)
    return 60_000
  })
  class Storage extends FakeStorageAdapter {
    override delete(): Promise<void> {
      return Promise.reject(storageError)
    }
  }
  const outbox = new OutboxManager(new Storage(), {})
  const scheduler = new KeyScheduler()
  let providerCalls = 0
  const signaler: TransactionSignaler = {
    isOfflineEnabled: true,
    isOnline: () => true,
    resolveTransaction: () => {
      throw new Error(`deletion has not succeeded`)
    },
    rejectTransaction: (_id, error) => rejections.push(error),
    registerRestorationTransaction: () => {},
  }
  const executor = new TransactionExecutor(
    scheduler,
    outbox,
    {
      collections: {},
      mutationFns: {
        syncData: () => {
          providerCalls++
          return Promise.resolve()
        },
      },
      jitter: false,
    },
    signaler,
  )
  const transaction: OfflineTransaction = {
    id: `deletion-backoff`,
    mutationFnName: `syncData`,
    mutations: [],
    keys: [],
    idempotencyKey: `deletion-backoff`,
    createdAt: new Date(0),
    retryCount: 0,
    nextAttemptAt: 0,
    version: 1,
  }
  await outbox.add(transaction)
  try {
    await expect(executor.execute(transaction)).rejects.toBe(storageError)
    executor.resetRetryDelays()
    await expect(executor.executeAll()).rejects.toBe(storageError)
    expect(retryCounts).toEqual([])
    expect(rejections).toEqual([storageError])
    expect(providerCalls).toBe(1)
    expect((await outbox.get(transaction.id))?.outboxPhase).toBe(
      `deletion-pending`,
    )
  } finally {
    executor.pause()
    delay.mockRestore()
  }
})

// Focused witness, not a generated history: the FIFO model keeps a queued
// transaction's optimistic rows, and a rollback while the transaction
// persists removes them. Once the mutation function runs, the executor alone
// settles the waiter, so a rollback must not settle it early or change its
// outcome.
it.each([true, false])(
  `keeps the executor's outcome for a rollback while persisting (succeeds: %s)`,
  async (succeeds) => {
    const providerError = new NonRetriableError(`provider failed`)
    const entered = gate()
    const release = gate()
    const env = createTestOfflineEnvironment({
      mutationFn: async (params) => {
        entered.resolve()
        await release.promise
        if (!succeeds) throw providerError
        env.applyMutations(params.transaction.mutations)
      },
    })
    const { rejections: unhandled, cleanup: cleanupUnhandled } =
      captureUnhandledRejections()
    const logged = vi.spyOn(console, `error`).mockImplementation(() => {})
    try {
      await env.waitForLeader()
      const tx = env.executor.createOfflineTransaction({
        mutationFnName: env.mutationFnName,
        autoCommit: false,
      })
      tx.mutate(() =>
        env.collection.insert({
          id: `held`,
          value: `v`,
          completed: false,
          updatedAt: new Date(0),
        }),
      )
      const statuses: Array<unknown> = []
      const wait = env.executor.waitForTransactionCompletion(tx.id).then(
        () => statuses.push(`fulfilled`),
        (error: unknown) => statuses.push(error),
      )
      void tx.commit().catch(() => undefined)
      await atOracleCheckpoint(entered.promise, `provider entered`)
      tx.rollback()
      await turn()
      expect(statuses, `waiter before the executor settles`).toEqual([])
      release.resolve()
      await atOracleCheckpoint(wait, `waiter settled`)
      expect(statuses, `waiter outcome`).toEqual([
        succeeds ? `fulfilled` : providerError,
      ])
      expect(env.serverState.has(`held`), `server row`).toBe(succeeds)
      expect(await env.executor.peekOutbox(), `outbox`).toEqual([])
      await turn()
      expect(unhandled, `unhandled rejections`).toEqual([])
    } finally {
      release.resolve()
      cleanupUnhandled()
      logged.mockRestore()
      env.executor.dispose()
    }
  },
)

// Focused witness, not a generated history: a failed outbox write stops the
// executor, so a FIFO history cannot continue past it. For every commit path,
// the admission write fails, the receipt rejects with the storage error, and
// the failure neither escapes as an unhandled rejection nor is logged again.
it.each([`manual`, `auto`, `default`, `action`] as const)(
  `rejects the receipt when the outbox write fails (%s)`,
  async (commit) => {
    const storageError = new Error(`outbox write unavailable`)
    class FailingStorage extends FakeStorageAdapter {
      override async set(key: string, value: string): Promise<void> {
        if (key.startsWith(`tx:`)) throw storageError
        await super.set(key, value)
      }
    }
    const env = createTestOfflineEnvironment({
      storage: new FailingStorage(),
      mutationFn: (params) => {
        env.applyMutations(params.transaction.mutations)
        return Promise.resolve()
      },
    })
    const { rejections: unhandled, cleanup: cleanupUnhandled } =
      captureUnhandledRejections()
    const logged = vi.spyOn(console, `error`).mockImplementation(() => {})
    const debug = vi.spyOn(console, `log`).mockImplementation(() => {})
    try {
      await env.waitForLeader()
      const write = () =>
        env.collection.insert({
          id: `stored`,
          value: `v`,
          completed: false,
          updatedAt: new Date(0),
        })
      let receipt: Promise<unknown>
      if (commit === `action`) {
        const transaction = env.executor.createOfflineAction({
          mutationFnName: env.mutationFnName,
          onMutate: write,
        })(undefined)
        receipt = transaction.when(`settled`)
      } else {
        const tx = env.executor.createOfflineTransaction({
          mutationFnName: env.mutationFnName,
          ...(commit === `default` ? {} : { autoCommit: commit === `auto` }),
        })
        const transaction = tx.mutate(write)
        receipt =
          commit === `manual` ? tx.commit() : transaction.when(`settled`)
      }
      await expect(receipt).rejects.toBe(storageError)
      await turn()
      expect(unhandled, `unhandled rejections`).toEqual([])
      // The executor logs the persist failure once; nothing logs it again.
      expect(
        logged.mock.calls.map(([message]) => String(message)),
        `errors logged`,
      ).toEqual([
        expect.stringMatching(/^Failed to persist offline transaction /),
      ])
      expect(debug.mock.calls, `debug output`).toEqual([])
      expect(env.collection.get(`stored`), `optimistic row`).toBeUndefined()
      expect(env.serverState.size, `provider calls`).toBe(0)
    } finally {
      cleanupUnhandled()
      logged.mockRestore()
      debug.mockRestore()
      env.executor.dispose()
      await env.collection.cleanup()
    }
  },
)

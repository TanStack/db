import { expect, it, vi } from 'vitest'
import { NonRetriableError } from '../src/types'
import { FakeStorageAdapter, createTestOfflineEnvironment } from './harness'
import { atOracleCheckpoint, cleanupOfflineOracle } from './oracle-lifecycle'

/**
 * # May a false browser online hint strand a visible tab's durable work?
 *
 * Contract: an elected web executor may attempt persisted work when its tab is
 * visible, even if the browser's connectivity hint is false. A hidden tab with
 * the same hint does not attempt work. A successful provider call removes the
 * durable row and settles the caller. This is an attempt law, not a promise of
 * connectivity or exactly-once provider execution.
 *
 * Model: in this bounded history, the hidden/false cut permits zero provider
 * calls and keeps the row; the visible/false cut permits one call and then no
 * row after provider success. The model describes public observations, not the
 * detector's predicate or the executor's queue.
 *
 * Grammar: one elected executor, one write, false online hint, hidden admission,
 * then visible notification through either the browser event or explicit
 * retry. Provider success is controlled. A non-leader history is outside this
 * test and belongs to the leadership oracle.
 *
 * Driver/checkpoint: real OfflineExecutor, WebOnlineDetector, storage, and
 * transaction path; public outbox, provider calls, and commit settlement are
 * compared before and after notification. Baseline main fails at the visible
 * checkpoint with zero provider calls; the fixture uses no elapsed-time retry.
 */
function expectedAt(phase: `hidden` | `visible`): {
  providerCalls: number
  outboxEntries: number
  callerState: `pending` | `fulfilled`
} {
  return phase === `hidden`
    ? { providerCalls: 0, outboxEntries: 1, callerState: `pending` }
    : { providerCalls: 1, outboxEntries: 0, callerState: `fulfilled` }
}

it.each([`visibilitychange`, `explicit retry`] as const)(
  `replays a committed outbox write on %s in a visible tab with a false online hint`,
  async (signal) => {
    const visibilityListeners = new Set<() => void>()
    vi.stubGlobal(`navigator`, { ...navigator, onLine: false })
    vi.stubGlobal(`document`, {
      visibilityState: `hidden`,
      addEventListener: (name: string, listener: () => void) => {
        if (name === `visibilitychange`) visibilityListeners.add(listener)
      },
      removeEventListener: (name: string, listener: () => void) => {
        if (name === `visibilitychange`) visibilityListeners.delete(listener)
      },
    })

    let persisted!: () => void
    const persistedPromise = new Promise<void>((resolve) => {
      persisted = resolve
    })
    class Storage extends FakeStorageAdapter {
      override async set(key: string, value: string): Promise<void> {
        await super.set(key, value)
        persisted()
      }
    }
    const env = createTestOfflineEnvironment({ storage: new Storage() })
    const settlement: { state: `pending` | `fulfilled` | `rejected` } = {
      state: `pending`,
    }
    let commitObserved: Promise<void> | undefined
    let transactionId = ``
    let hasPrimaryFailure = false
    try {
      await env.waitForLeader()
      const transaction = env.executor.createOfflineTransaction({
        mutationFnName: env.mutationFnName,
        autoCommit: false,
      })
      transactionId = transaction.id
      transaction.mutate(() => {
        env.collection.insert({
          id: `saved`,
          value: `local`,
          completed: false,
          updatedAt: new Date(0),
        })
      })
      commitObserved = transaction.commit().then(
        () => {
          settlement.state = `fulfilled`
        },
        () => {
          settlement.state = `rejected`
        },
      )

      await atOracleCheckpoint(persistedPromise, `outbox write persisted`)
      const outboxBefore = await env.executor.peekOutbox()
      expect(outboxBefore.map(({ id }) => id)).toEqual([transactionId])
      expect({
        providerCalls: env.mutationCalls.length,
        outboxEntries: outboxBefore.length,
        callerState: settlement.state,
      }).toEqual(expectedAt(`hidden`))

      Object.defineProperty(document, `visibilityState`, { value: `visible` })
      if (signal === `visibilitychange`) {
        expect(visibilityListeners.size).toBe(1)
        for (const listener of visibilityListeners) listener()
      } else {
        env.executor.getOnlineDetector().notifyOnline()
      }

      // One microtask boundary lets the event-driven executor reach its
      // provider, without waiting for a retry timer or network timeout.
      await Promise.resolve()
      expect(env.mutationCalls).toHaveLength(
        expectedAt(`visible`).providerCalls,
      )
      expect(
        env.mutationCalls.map(({ idempotencyKey }) => idempotencyKey),
      ).toEqual([outboxBefore[0]!.idempotencyKey])
      await atOracleCheckpoint(commitObserved, `visible replay committed`)
      const outboxAfter = await env.executor.peekOutbox()
      expect({
        providerCalls: env.mutationCalls.length,
        outboxEntries: outboxAfter.length,
        callerState: settlement.state,
      }).toEqual(expectedAt(`visible`))
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      if (settlement.state === `pending` && transactionId)
        env.executor.rejectTransaction(
          transactionId,
          new NonRetriableError(`oracle cleanup`),
        )
      await cleanupOfflineOracle(
        [
          () => commitObserved,
          () => env.executor.dispose(),
          () => env.collection.cleanup(),
          () => vi.unstubAllGlobals(),
        ],
        hasPrimaryFailure,
      )
    }
  },
)

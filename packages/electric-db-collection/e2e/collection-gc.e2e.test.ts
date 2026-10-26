// @vitest-environment node
import { createCollection } from '@tanstack/db'
import { afterAll, expect, inject, it, vi } from 'vitest'
import { createDeferred } from '../../db/src/deferred'
import {
  checkGcObservation,
  createGcModel,
  gcDeadline,
  stepGcModel,
} from '../../db/tests/collection-gc-retention-oracle'
import { makePgClient } from '../../db-collection-e2e/support/global-setup'
import { electricCollectionOptions } from '../src/electric'
import type { GcAction } from '../../db/tests/collection-gc-retention-oracle'

/**
 * The shared GC model owns retention and retirement. This receiving driver
 * supplies a real PostgreSQL transaction and the installed Electric SDK. An
 * assigned but uncommitted txid cannot be acknowledged by the Electric stream.
 * The mutation handler awaits that txid while elapsed time crosses the deadline
 * that would retire an unheld Collection. Committing PostgreSQL releases real
 * confirmation; caller settlement must preserve the source row and renew GC.
 *
 * Only host idle delivery is controlled. Real elapsed timers and provider I/O
 * run normally. Chromium's separate driver owns native idle provenance. These
 * four histories distinguish small/ordinary gcTime and absent/last subscribers;
 * they do not claim arbitrary provider recovery or persisted-wrapper coverage.
 */
const idleHost = vi.hoisted(() => {
  const callbacks = new Map<number, IdleRequestCallback>()
  let nextId = 0
  vi.stubGlobal(`window`, {
    requestIdleCallback: (callback: IdleRequestCallback) => {
      const id = ++nextId
      callbacks.set(id, callback)
      return id
    },
    cancelIdleCallback: (id: number) => {
      callbacks.delete(id)
    },
  })
  return { callbacks }
})
afterAll(() => vi.unstubAllGlobals())

for (const gcTime of [10, 100]) {
  for (const lastUnsubscribe of [false, true]) {
    it(`retains a real Electric confirmation across GC with gcTime ${gcTime} and last unsubscribe ${lastUnsubscribe}`, async () => {
      const table = `gc_confirmation_${crypto.randomUUID().replaceAll('-', '')}`
      const schema = inject(`testSchema`)
      const admin = makePgClient()
      const writer = makePgClient()
      let tableCreated = false
      const assignedTxid = createDeferred<number>()
      let sqlOpen = false
      let sourceCommitted = false
      let acknowledged = false
      const collection = createCollection(
        electricCollectionOptions<{ id: number; value: string }>({
          id: table,
          getKey: (row) => row.id,
          startSync: false,
          gcTime,
          shapeOptions: {
            url: `${inject(`baseUrl`)}/v1/shape`,
            params: { table: `"${schema}"."${table}"` },
            onError: (error) => {
              throw error
            },
          },
          onInsert: async ({ collection: owner }) => {
            try {
              await writer.query(`BEGIN`)
              sqlOpen = true
              const result = await writer.query<{ txid: string }>(
                `INSERT INTO "${schema}"."${table}" (id, value) VALUES (1, 'confirmed') RETURNING pg_current_xact_id()::text AS txid`,
              )
              const txid = Number(result.rows[0]!.txid)
              assignedTxid.resolve(txid)
              await owner.utils.awaitTxId(txid, 15_000)
              acknowledged = true
            } catch (error) {
              assignedTxid.reject(error)
              throw error
            }
          },
        }),
      )
      let primaryFailure: unknown
      let checkFailed = false
      let observeCaller = Promise.resolve()
      try {
        await admin.connect()
        await writer.connect()
        await admin.query(
          `CREATE TABLE "${schema}"."${table}" (id INTEGER PRIMARY KEY, value TEXT NOT NULL)`,
        )
        tableCreated = true
        await collection.preload()
        const startedAt = performance.now()
        const model = createGcModel(gcTime)
        const advance = () =>
          stepGcModel(model, {
            kind: `advance`,
            elapsedMs: performance.now() - startedAt - model.now,
          })
        const apply = (action: GcAction) => {
          advance()
          stepGcModel(model, action)
        }
        const subscription = lastUnsubscribe
          ? collection.subscribeChanges(() => {})
          : undefined
        if (subscription) apply({ kind: `subscribe` })
        const transaction = collection.insert({ id: 1, value: `confirmed` })
        apply({ kind: `insert`, commit: true })
        let callerOutcome = `pending`
        observeCaller = transaction.when(`settled`).then(
          () => {
            callerOutcome = `fulfilled`
          },
          () => {
            callerOutcome = `rejected`
          },
        )
        if (subscription) {
          subscription.unsubscribe()
          apply({ kind: `unsubscribe` })
        }
        const observation = () => ({
          retired: collection.status === `cleaned-up`,
          visibleKeys: [...collection.keys()].map((key) => {
            if (typeof key !== `number`)
              throw new Error(
                `Expected integer PostgreSQL key, received ${key}`,
              )
            return key
          }),
          transactionStates: [transaction.state],
        })
        const check = (checkpoint: string) => {
          advance()
          checkGcObservation(
            model,
            observation(),
            checkpoint,
            sourceCommitted ? [1] : [],
          )
        }
        const idle = (hasTime: boolean) => {
          for (const [id, callback] of [...idleHost.callbacks]) {
            idleHost.callbacks.delete(id)
            callback({
              didTimeout: false,
              timeRemaining: () => (hasTime ? 50 : 0),
            })
          }
          apply({ kind: `idle`, hasTime, didTimeout: false })
        }

        const txid = await assignedTxid.promise
        expect(Number.isSafeInteger(txid)).toBe(true)
        expect(sqlOpen).toBe(true)
        // The separate connection cannot see the uncommitted source row. This
        // is the real-provider premise, rather than a held utility Promise.
        expect(
          (await admin.query(`SELECT id FROM "${schema}"."${table}"`)).rows,
        ).toEqual([])
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(gcTime, 50) + 20),
        )
        idle(true)
        check(`real Electric confirmation held across unheld GC deadline`)
        expect(model.now).toBeGreaterThanOrEqual(Math.max(gcTime, 50))
        expect(transaction.state).toBe(`persisting`)
        expect(callerOutcome).toBe(`pending`)
        expect(acknowledged).toBe(false)
        // A plausible wrong public result must be rejected at this same cut.
        expect(() =>
          checkGcObservation(
            model,
            { ...observation(), retired: true },
            `hostile early retirement`,
          ),
        ).toThrow(/retired expected false, got true/)

        await writer.query(`COMMIT`)
        sqlOpen = false
        sourceCommitted = true
        await observeCaller
        expect(callerOutcome).toBe(`fulfilled`)
        expect(acknowledged).toBe(true)
        apply({ kind: `settle`, slot: 0, outcome: `complete` })
        check(`real Electric caller settlement`)
        expect(collection.get(1)).toMatchObject({
          id: 1,
          value: `confirmed`,
          $synced: true,
          $hasPendingWrites: false,
        })
        expect(idleHost.callbacks.size).toBe(0)

        // Timer delivery proves core reached renewed eligibility. A zero-budget
        // host opportunity must preserve rows; a usable one then retires them.
        await vi.waitFor(() =>
          expect(idleHost.callbacks.size).toBeGreaterThan(0),
        )
        advance()
        // Real timers may round a sub-millisecond deadline. Wait for the
        // independent model's deadline before delivering the idle opportunity.
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, gcDeadline(model) - model.now) + 1),
        )
        idle(false)
        check(`real Electric renewed deadline without idle budget`)
        expect(idleHost.callbacks.size).toBeGreaterThan(0)
        idle(true)
        await Promise.resolve()
        check(`real Electric renewed deadline with idle budget`)
        expect(model.retired).toBe(true)
        console.info(
          JSON.stringify({
            witness: `electric.gc-provider-confirmation`,
            gcTime,
            lastUnsubscribe,
            txid,
            heldAcrossDeadline: true,
            acknowledged,
            callerOutcome,
            retired: model.retired,
          }),
        )
      } catch (error) {
        checkFailed = true
        primaryFailure = error
      }
      const cleanupFailures: Array<unknown> = []
      for (const cleanup of [
        async () => {
          if (sqlOpen) await writer.query(`ROLLBACK`)
        },
        () => collection.cleanup(),
        () => observeCaller,
        () => writer.end(),
        async () => {
          if (tableCreated)
            await admin.query(`DROP TABLE IF EXISTS "${schema}"."${table}"`)
        },
        () => admin.end(),
      ]) {
        try {
          await cleanup()
        } catch (error) {
          cleanupFailures.push(error)
        }
      }
      idleHost.callbacks.clear()
      if (checkFailed || cleanupFailures.length)
        throw new AggregateError(
          [...(checkFailed ? [primaryFailure] : []), ...cleanupFailures],
          `Electric GC receiving check or cleanup failed`,
          { cause: primaryFailure },
        )
    })
  }
}

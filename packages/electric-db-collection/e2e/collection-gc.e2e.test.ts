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
import { createOracleReach } from '../../db/tests/oracle-reach'
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
 * twelve histories cross small/ordinary gcTime and absent/last subscribers with
 * one writer or two independently committed writers in both orders. A completed
 * writer must not end its sibling's retention hold. Settlement order names the
 * local optimistic transactions, independently of PostgreSQL txid assignment.
 * The source keys follow SQL
 * COMMIT actions, never Collection reads. Arbitrary provider recovery, native
 * browser/provider composition and persisted wrappers remain outside this path.
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
    for (const settlementOrder of [[0], [0, 1], [1, 0]]) {
      const order =
        settlementOrder.length === 1
          ? `single`
          : settlementOrder[0] === 0
            ? `oldest-first`
            : `newest-first`
      it(`retains real Electric confirmations across GC with gcTime ${gcTime}, last unsubscribe ${lastUnsubscribe}, and ${order} settlement`, async () => {
        const table = `gc_confirmation_${crypto.randomUUID().replaceAll('-', '')}`
        const schema = inject(`testSchema`)
        const admin = makePgClient()
        const writers = settlementOrder.map(() => makePgClient())
        const assignedTxids = writers.map(() => createDeferred<number>())
        const sqlOpen = writers.map(() => false)
        const acknowledged = writers.map(() => false)
        const callerOutcomes = writers.map(() => `pending`)
        const sourceKeys = new Set<number>()
        const reach = createOracleReach(
          `collection-lifecycle.gc-retention-boundaries`,
          [
            `provider-confirmations-held`,
            ...(writers.length === 2
              ? [
                  `provider-${order}`,
                  `surviving-provider-hold-crosses-deadline`,
                ]
              : []),
            `all-provider-writes-confirmed`,
            `renewed-zero-budget`,
            `renewed-usable-idle`,
          ],
        )
        reach.beginHistory()
        let tableCreated = false
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
            onInsert: async ({ collection: owner, transaction }) => {
              const id = transaction.mutations[0].modified.id
              const slot = id - 1
              const writer = writers[slot]!
              try {
                await writer.query(`BEGIN`)
                sqlOpen[slot] = true
                const result = await writer.query<{ txid: string }>(
                  `INSERT INTO "${schema}"."${table}" (id, value) VALUES ($1, 'confirmed') RETURNING pg_current_xact_id()::text AS txid`,
                  [id],
                )
                const txid = Number(result.rows[0]!.txid)
                assignedTxids[slot]!.resolve(txid)
                await owner.utils.awaitTxId(txid, 15_000)
                acknowledged[slot] = true
              } catch (error) {
                assignedTxids[slot]!.reject(error)
                throw error
              }
            },
          }),
        )
        let primaryFailure: unknown
        let checkFailed = false
        const observeCallers: Array<Promise<void>> = []
        try {
          await admin.connect()
          await Promise.all(writers.map((writer) => writer.connect()))
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
          const transactions = writers.map((_, slot) => {
            const transaction = collection.insert({
              id: slot + 1,
              value: `confirmed`,
            })
            apply({ kind: `insert`, commit: true })
            observeCallers.push(
              transaction.when(`settled`).then(
                () => {
                  callerOutcomes[slot] = `fulfilled`
                },
                () => {
                  callerOutcomes[slot] = `rejected`
                },
              ),
            )
            return transaction
          })
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
            transactionStates: transactions.map(
              (transaction) => transaction.state,
            ),
          })
          const check = (checkpoint: string) => {
            advance()
            checkGcObservation(model, observation(), checkpoint, [
              ...sourceKeys,
            ])
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

          const txids = await Promise.all(
            assignedTxids.map((assigned) => assigned.promise),
          )
          expect(txids.every(Number.isSafeInteger)).toBe(true)
          expect(new Set(txids).size).toBe(writers.length)
          expect(sqlOpen).toEqual(writers.map(() => true))
          // The separate connection cannot see either uncommitted source row.
          // This proves genuine provider work, not merely a held utility Promise.
          expect(
            (
              await admin.query(
                `SELECT id FROM "${schema}"."${table}" ORDER BY id`,
              )
            ).rows,
          ).toEqual([])
          await new Promise((resolve) =>
            setTimeout(resolve, Math.max(gcTime, 50) + 20),
          )
          idle(true)
          check(`real Electric confirmations held across unheld GC deadline`)
          expect(model.now).toBeGreaterThanOrEqual(Math.max(gcTime, 50))
          expect(transactions.map((transaction) => transaction.state)).toEqual(
            writers.map(() => `persisting`),
          )
          expect(callerOutcomes).toEqual(writers.map(() => `pending`))
          expect(acknowledged).toEqual(writers.map(() => false))
          reach.reach(`provider-confirmations-held`)
          // A plausible wrong public result must be rejected at this same cut.
          expect(() =>
            checkGcObservation(
              model,
              { ...observation(), retired: true },
              `hostile early retirement`,
            ),
          ).toThrow(/retired expected false, got true/)

          for (const [index, slot] of settlementOrder.entries()) {
            await writers[slot]!.query(`COMMIT`)
            sqlOpen[slot] = false
            sourceKeys.add(slot + 1)
            await observeCallers[slot]
            expect(callerOutcomes[slot]).toBe(`fulfilled`)
            expect(acknowledged[slot]).toBe(true)
            apply({ kind: `settle`, slot, outcome: `complete` })
            check(`real Electric caller settlement ${index}`)
            if (index + 1 < settlementOrder.length) {
              const survivor = settlementOrder[index + 1]!
              expect(sqlOpen[survivor]).toBe(true)
              expect(acknowledged[survivor]).toBe(false)
              expect(callerOutcomes[survivor]).toBe(`pending`)
              expect(transactions[survivor]!.state).toBe(`persisting`)
              expect(
                (
                  await admin.query(
                    `SELECT id FROM "${schema}"."${table}" ORDER BY id`,
                  )
                ).rows,
              ).toEqual([{ id: slot + 1 }])
              reach.reach(`provider-${order}`)
              // A fresh delay after the first confirmation is insufficient: the
              // remaining handler still owns the Collection past that deadline.
              await new Promise((resolve) =>
                setTimeout(resolve, Math.max(gcTime, 50) + 20),
              )
              idle(true)
              check(
                `surviving real Electric confirmation holds after first release deadline`,
              )
              expect(transactions[survivor]!.state).toBe(`persisting`)
              expect(callerOutcomes[survivor]).toBe(`pending`)
              expect(acknowledged[survivor]).toBe(false)
              reach.reach(`surviving-provider-hold-crosses-deadline`)
            }
          }
          reach.reach(`all-provider-writes-confirmed`)
          for (const id of sourceKeys)
            expect(collection.get(id)).toMatchObject({
              id,
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
          reach.reach(`renewed-zero-budget`)
          idle(true)
          await Promise.resolve()
          check(`real Electric renewed deadline with idle budget`)
          expect(model.retired).toBe(true)
          reach.reach(`renewed-usable-idle`)
          reach.assertReached()
          console.info(
            JSON.stringify({
              witness: `electric.gc-provider-confirmation`,
              gcTime,
              lastUnsubscribe,
              txids,
              order,
              reach: Object.fromEntries(reach.counts()),
              heldAcrossDeadline: true,
              acknowledged,
              callerOutcomes,
              retired: model.retired,
            }),
          )
        } catch (error) {
          checkFailed = true
          primaryFailure = error
        }
        const cleanupFailures: Array<unknown> = []
        for (const cleanup of [
          ...writers.map((writer, slot) => async () => {
            if (sqlOpen[slot]) await writer.query(`ROLLBACK`)
          }),
          () => collection.cleanup(),
          () => Promise.all(observeCallers),
          ...writers.map((writer) => () => writer.end()),
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
}

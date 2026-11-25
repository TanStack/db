/** Real SDK callbacks and SQLite locks receive the native mutation-stop law. */
import { Schema, Table, column } from '@powersync/common'
import { createCollection, createTransaction } from '@tanstack/db'
import { z } from 'zod'
import { untilStartup } from '../../db-adapter-conformance/tests/persisted-startup-driver'
import { powerSyncCollectionOptions } from '../src'
import { PendingOperationStore } from '../src/PendingOperationStore'
import { PowerSyncTransactor } from '../src/PowerSyncTransactor'
import {
  nativeMutationInitialRows,
  nativeMutationKeys,
} from './batch-decode-oracle'
import { retainNativeObservation } from './receiving-cleanup'
import type { LockContext } from '@powersync/common'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { PendingOperation } from '../src/PendingOperationStore'
import type {
  NativeMutationHistory,
  NativeMutationObservation,
  NativeMutationRow,
} from './batch-decode-oracle'
import type { NativeReceivingOpen } from './hook-lifecycle-driver'

const schema = new Schema({ rows: new Table({ value: column.integer }) })
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const sorted = (rows: Iterable<NativeMutationRow>) =>
  [...rows]
    .map(({ id, value }) => ({ id, value }))
    .sort((a, b) => a.id.localeCompare(b.id))
function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

export async function observeNativeMutationRefusal(
  open: NativeReceivingOpen,
  h: NativeMutationHistory,
  id: string,
): Promise<NativeMutationObservation> {
  const detachedErrors: Array<string> = []
  const detached = (error: unknown) => detachedErrors.push(String(error))
  const onRejected = (event: PromiseRejectionEvent) => {
    detached(event.reason)
    event.preventDefault()
  }
  if (typeof window === `undefined`) process.on(`unhandledRejection`, detached)
  else window.addEventListener(`unhandledrejection`, onRejected)
  try {
    const source = await open(schema)
    return await retainNativeObservation(async () => {
      const database = source.database
      const keys = nativeMutationKeys(h)
      const refusal = new Error(`native decoder stopped ${h.coordinate}`)
      const readFailure = new Error(
        `native async diff read failed ${h.coordinate}`,
      )
      const read = gate()
      const transactionReturn = gate()
      let mutationReturnHeld = false
      let readHeld = false
      let readFinished = false
      let liveReads = 0
      let rejectRead = h.effect === `read-rejection`
      let readRejected = false
      let active = h.timing === `initial`
      let setup = 0
      let setupsCompleted = 0
      let disposal = 0
      let disposed = 0
      let executing = 0
      let callbacksFinished = 0
      let writeSubmissions = 0
      let blockCallbacks = false
      let blockPeer = false
      const publications: Array<Array<NativeMutationRow>> = []
      let activePeerCut: NativeMutationObservation['activePeer']
      let ownerCallbacksBefore = 0
      let peerCallbacksBefore = 0
      let peerTrackingName: string | undefined
      let peerCallbacksFinished = 0
      const waitingCallbacks: Array<{ peer: boolean; release: () => void }> = []
      const releaseRole = (peer: boolean) => {
        for (const callback of waitingCallbacks.splice(0)) {
          if (callback.peer === peer) callback.release()
          else waitingCallbacks.push(callback)
        }
      }
      const releaseOne = () => {
        const index = waitingCallbacks.findIndex((callback) => !callback.peer)
        if (index >= 0) waitingCallbacks.splice(index, 1)[0]!.release()
      }
      const releaseAll = () => {
        blockCallbacks = false
        for (const callback of waitingCallbacks.splice(0)) {
          if (callback.peer && blockPeer) waitingCallbacks.push(callback)
          else callback.release()
        }
      }
      const recordContext = <T extends LockContext>(context: T): T =>
        new Proxy(context, {
          get(target, property, receiver) {
            if (property === `getAll`)
              return async (sql: string, params?: Array<unknown>) => {
                const rows = await target.getAll<unknown>(sql, params)
                const relevant =
                  h.timing === `initial`
                    ? /SELECT \* FROM .* LIMIT \?/i.test(sql)
                    : /ORDER BY operation_id ASC/i.test(sql)
                if (active && relevant) liveReads++
                if (active && relevant && !readHeld) {
                  readHeld = true
                  if (h.timing === `during-read` || h.timing === `initial`)
                    await read.promise
                  if (rejectRead) {
                    rejectRead = false
                    readRejected = readFinished = true
                    throw readFailure
                  }
                  readFinished = true
                }
                return rows
              }
            const value: unknown = Reflect.get(target, property, receiver)
            return typeof value === `function` ? value.bind(target) : value
          },
        })
      const transact = database.writeTransaction.bind(database)
      database.writeTransaction = (callback, timeout) => {
        writeSubmissions++
        return transact(
          (context) => callback(recordContext(context)),
          timeout,
        ).then(async (result) => {
          if (
            h.effect === `cleanup-return` &&
            !mutationReturnHeld &&
            typeof result === `object` &&
            result !== null &&
            `whenComplete` in result
          ) {
            mutationReturnHeld = true
            await transactionReturn.promise
          }
          return result
        })
      }
      const writeLock = database.writeLock.bind(database)
      database.writeLock = (callback) =>
        writeLock((context) => callback(recordContext(context)))
      const createTrigger = database.triggers.createDiffTrigger.bind(
        database.triggers,
      )
      database.triggers.createDiffTrigger = async (options) => {
        setup++
        try {
          const dispose = await createTrigger({
            ...options,
            hooks: {
              ...options.hooks,
              beforeCreate: async (context) =>
                options.hooks?.beforeCreate?.(recordContext(context)),
            },
          })
          return async (disposeOptions) => {
            disposal++
            try {
              await dispose(disposeOptions)
              disposed++
            } finally {
              disposal--
            }
          }
        } finally {
          setup--
          setupsCompleted++
        }
      }
      const register = database.onChangeWithCallback.bind(database)
      database.onChangeWithCallback = (handler, options) => {
        const peerCallback =
          peerTrackingName !== undefined &&
          options?.tables?.includes(peerTrackingName) === true
        return register(
          {
            ...handler,
            onChange: async (event) => {
              if (peerCallback ? blockPeer : blockCallbacks)
                await new Promise<void>((resolve) => {
                  waitingCallbacks.push({
                    peer: peerCallback,
                    release: resolve,
                  })
                })
              executing++
              try {
                await handler?.onChange(event)
              } finally {
                executing--
                if (peerCallback) peerCallbacksFinished++
                else callbacksFinished++
              }
            },
          },
          options,
        )
      }
      await database.writeTransaction(async (tx) => {
        for (const row of nativeMutationInitialRows(h))
          await tx.execute(`INSERT INTO rows(id,value) VALUES (?,?)`, [
            row.id,
            h.timing === `initial` && row.id === keys.refusal ? -1 : row.value,
          ])
      })
      const validation: StandardSchemaV1<NativeMutationRow, NativeMutationRow> =
        {
          '~standard': {
            version: 1,
            vendor: `native-mutation-receiving`,
            validate(value) {
              const row = z
                .object({ id: z.string(), value: z.number() })
                .parse(value)
              if (row.value < 0) throw refusal
              return { value: row }
            },
          },
        }
      const options = powerSyncCollectionOptions({
        id,
        database,
        table: schema.props.rows,
        schema: z.object({ id: z.string(), value: z.number() }),
        deserializationSchema: validation,
        onDeserializationError: () => {},
        syncMode: h.mode,
      })
      const collection = createCollection({ ...options, startSync: false })
      const peerOptions =
        h.peer || h.activePeer
          ? powerSyncCollectionOptions({
              id: `${id}-peer`,
              database,
              table: schema.props.rows,
              schema: z.object({ id: z.string(), value: z.number() }),
              onDeserializationError: () => {},
              syncMode: `eager`,
            })
          : undefined
      if (peerOptions)
        peerTrackingName = peerOptions.utils.getMeta().trackedTableName
      const peer = peerOptions
        ? createCollection({ ...peerOptions, startSync: false })
        : undefined
      let peerSubscription:
        ReturnType<typeof collection.subscribeChanges> | undefined
      const peerMutation = {
        state: `pending` as NativeMutationObservation['mutation'],
      }
      const store = PendingOperationStore.GLOBAL
      const waitFor = store.waitFor
      const owned: Array<{
        operation: PendingOperation
        signal?: AbortSignal
      }> = []
      store.waitFor = (
        ...args: Parameters<PendingOperationStore['waitFor']>
      ) => {
        const [operation] = args
        if (operation.tableName === `rows`)
          owned.push({ operation, signal: args[1] })
        return waitFor.apply(store, args)
      }
      const mutation = {
        state: `pending` as NativeMutationObservation['mutation'],
        error: null as string | null,
      }
      const settlements: Array<Promise<unknown>> = []
      // Error text can name this randomly allocated trigger. Its identity is
      // private; keep the provider error while replacing only that exact name.
      const mutationError = (error: unknown) =>
        String(error).replaceAll(
          options.utils.getMeta().trackedTableName,
          `<tracking table>`,
        )
      let mutationStarted = false
      let admittedDuringRead = false
      let admittedAtRefusal = false
      let admittedAfterStop = false
      let admittedBeforeInitialReadReturned = false
      const startMutation = () => {
        if (mutationStarted)
          throw new Error(`native mutation was admitted twice`)
        mutationStarted = true
        try {
          const transaction =
            h.peerTransaction && peer
              ? createTransaction({
                  autoCommit: false,
                  mutationFn: ({ transaction: pending }) =>
                    new PowerSyncTransactor({ database }).applyTransaction(
                      pending,
                    ),
                })
              : h.kind === `insert`
                ? collection.insert({ id: keys.inserted, value: h.value + 10 })
                : h.kind === `update`
                  ? collection.update(keys.target, (row) => {
                      row.value = h.value + 10
                    })
                  : collection.delete(keys.target)
          if (h.peerTransaction && peer) {
            transaction.mutate(() => {
              peer.insert({ id: `peer-${h.coordinate}`, value: h.value + 200 })
              collection.update(keys.target, (row) => {
                row.value = h.value + 10
              })
            })
            settlements.push(transaction.commit().catch(() => undefined))
          }
          settlements.push(
            transaction.when(`settled`).then(
              () => {
                mutation.state = `fulfilled`
                if (h.peerTransaction) peerMutation.state = `fulfilled`
              },
              (error: unknown) => {
                mutation.state = `rejected`
                mutation.error = mutationError(error)
                if (h.peerTransaction) peerMutation.state = `rejected`
              },
            ),
          )
        } catch (error) {
          mutation.state = `rejected`
          mutation.error = mutationError(error)
        }
      }
      const stopWatchingHealth = collection.on(`health:change`, () => {
        if (
          h.timing === `at-refusal` &&
          collection.health.error &&
          !mutationStarted
        ) {
          admittedAtRefusal = true
          startMutation()
        }
      })
      const subscriptions: Array<
        ReturnType<typeof collection.subscribeChanges>
      > = []
      const start = () => {
        const sub = collection.subscribeChanges(() => {
          publications.push(sorted(collection.values()))
        })
        subscriptions.push(sub)
        let load: true | Promise<void> = collection.preload()
        if (h.mode === `on-demand`)
          sub.requestSnapshot({
            onLoadSubsetResult: (result) => {
              load = result
            },
          })
        return Promise.resolve(load).catch(() => undefined)
      }
      const drain = async () => {
        for (let i = 0; i < 8; i++) await turn()
        await database.writeTransaction(() => Promise.resolve())
        await untilStartup(
          () => executing === 0 && setup === 0 && disposal === 0,
        )
        for (let i = 0; i < 8; i++) await turn()
      }
      return retainNativeObservation(async () => {
        const loading = start()
        if (h.timing === `initial`) {
          await untilStartup(() => readHeld)
          admittedBeforeInitialReadReturned = collection.status === `loading`
          startMutation()
          read.release()
          await loading
        } else {
          await untilStartup(() => setupsCompleted > 0)
          await loading
          if (peer) {
            peerSubscription = peer.subscribeChanges(() => {})
            await peer.preload()
            await drain()
            blockPeer = true
          }
          publications.length = 0
          ownerCallbacksBefore = callbacksFinished
          peerCallbacksBefore = peerCallbacksFinished
          active = true
          blockCallbacks = true
          if (h.timing === `before-read`) {
            startMutation()
            await untilStartup(
              () => owned.length > 0 || mutation.state !== `pending`,
            )
            if (peer && h.peer && !h.peerTransaction) {
              const registrations = owned.length
              const transaction = peer.insert({
                id: `peer-${h.coordinate}`,
                value: h.value + 200,
              })
              settlements.push(
                transaction.when(`settled`).then(
                  () => {
                    peerMutation.state = `fulfilled`
                  },
                  () => {
                    peerMutation.state = `rejected`
                  },
                ),
              )
              await untilStartup(
                () =>
                  owned.length > registrations ||
                  peerMutation.state !== `pending`,
              )
            }
          }
          await database.writeTransaction((tx) =>
            tx.execute(`UPDATE rows SET value=? WHERE id=?`, [
              h.effect === `decode-refusal` ? -1 : 2,
              keys.refusal,
            ]),
          )
          await untilStartup(() => waitingCallbacks.length > 0)
          if (h.activePeer && peer) {
            // Both notifications originate in the installed SDK. The callback
            // gate is before production's SQL read, so the parked Collection
            // cannot yet have staged its own confirmation transaction.
            await untilStartup(() =>
              waitingCallbacks.some(
                (callback) => callback.peer === !h.peerFirst,
              ),
            )
            if (h.peerFirst) blockPeer = false
            else blockCallbacks = false
            releaseRole(Boolean(h.peerFirst))
            await untilStartup(() =>
              h.peerFirst
                ? peerCallbacksFinished > peerCallbacksBefore
                : callbacksFinished > ownerCallbacksBefore,
            )
            await drain()
            activePeerCut = {
              ownerHeld: waitingCallbacks.some((callback) => !callback.peer),
              peerHeld: waitingCallbacks.some((callback) => callback.peer),
              ownerObserved: callbacksFinished > ownerCallbacksBefore,
              peerObserved: peerCallbacksFinished > peerCallbacksBefore,
              mutation: mutation.state,
              rows: sorted(collection.values()),
              base: sorted(collection.base.values()),
              publications: publications.map((rows) => [...rows]),
              peerRows: sorted(peer.values()),
              peerBase: sorted(peer.base.values()),
              stopped: collection.health.error !== null,
              peerStopped: peer.health.error !== null,
            }
            blockPeer = false
            releaseAll()
          } else if (h.effect === `cleanup` || h.effect === `cleanup-return`) {
            if (h.effect === `cleanup-return`)
              await untilStartup(() => mutationReturnHeld)
            await collection.cleanup()
            for (let i = 0; i < 8; i++) await turn()
            transactionReturn.release()
            releaseAll()
          } else if (h.timing === `during-read`) {
            releaseOne()
            await untilStartup(() => readHeld)
            const submitted = writeSubmissions
            admittedDuringRead = !readFinished && readHeld
            startMutation()
            await untilStartup(
              () =>
                writeSubmissions > submitted || mutation.state !== `pending`,
            )
            read.release()
          } else releaseOne()
          await untilStartup(
            () =>
              (readFinished ||
                h.effect === `cleanup` ||
                h.effect === `cleanup-return`) &&
              executing === 0,
          )
        }
        // Only the rejected-read neighbor promises to remain unconfirmed at
        // this cut. Fatal refusal can settle before or after callback return.
        let pendingAtFirstRead: boolean | null = null
        const openAfterRead =
          collection._state.pendingSyncedTransactions.filter(
            (transaction) => !transaction.committed,
          ).length
        if (h.effect === `read-rejection`) {
          // Keep later real callbacks parked while observing the failed read.
          for (let i = 0; i < 8; i++) await turn()
          pendingAtFirstRead = mutation.state === `pending`
          const completedBeforeRetry = callbacksFinished
          releaseAll()
          await database.writeTransaction((tx) =>
            tx.execute(`UPDATE rows SET value=3 WHERE id=?`, [keys.refusal]),
          )
          await untilStartup(() => callbacksFinished > completedBeforeRetry)
        } else releaseAll()
        await drain()
        if (h.effect === `decode-refusal`)
          await untilStartup(
            () =>
              collection.health.error !== null &&
              (h.timing === `initial` || disposed > 0),
          )
        if (h.timing === `after-stop`) {
          admittedAfterStop = collection.health.error !== null && disposed > 0
          startMutation()
          await drain()
        }
        const reached: Array<string> = []
        if (
          h.activePeer &&
          activePeerCut &&
          owned.length > 0 &&
          activePeerCut.ownerHeld === Boolean(h.peerFirst) &&
          activePeerCut.peerHeld === !h.peerFirst &&
          activePeerCut.ownerObserved === !h.peerFirst &&
          activePeerCut.peerObserved === Boolean(h.peerFirst)
        )
          reached.push(
            `active-peer:${h.mode}:${h.peerFirst ? `peer-first` : `owner-first`}:${h.kind}`,
          )
        if (h.timing === `initial` && admittedBeforeInitialReadReturned)
          reached.push(`initial`)
        else if (
          h.effect !== `decode-refusal` &&
          (readHeld || h.effect === `cleanup` || mutationReturnHeld) &&
          (h.effect !== `read-rejection` || (readRejected && liveReads > 1))
        )
          reached.push(`${h.effect}:${h.mode}`)
        else if (
          h.effect === `decode-refusal` &&
          mutationStarted &&
          ((h.timing === `before-read` && owned.length > 0 && readHeld) ||
            (h.timing === `during-read` && admittedDuringRead) ||
            (h.timing === `at-refusal` && admittedAtRefusal) ||
            (h.timing === `after-stop` && admittedAfterStop))
        )
          reached.push(`refusal:${h.mode}:${h.timing}:${h.kind}`)
        if (
          peer &&
          owned.length > 1 &&
          (peerMutation.state === `pending` || h.peerTransaction) &&
          waitingCallbacks.some((callback) => callback.peer)
        )
          reached.push(
            h.peerTransaction
              ? `same-table-transaction`
              : `healthy-same-table-peer`,
          )
        const observed: NativeMutationObservation = {
          detachedErrors,
          reached,
          mutation: mutation.state,
          mutationError: mutation.error,
          pendingAtFirstRead,
          pendingStoreRegistrations: owned.length,
          openAfterRead,
          initialReadRejected: readRejected,
          sourceStopped: collection.health.error !== null,
          sourceCauseMatches: collection.health.error?.cause === refusal,
          status: collection.status,
          rows: sorted(collection.values()),
          base: sorted(collection.base.values()),
          afterCleanup: `pending`,
          afterRestart: `pending`,
          restartStatus: `pending`,
          restartMutation: `pending`,
          restartRow: null,
          mutationReturnHeld,
          activePeer: activePeerCut,
          sqliteRows: sorted(
            await database.getAll<NativeMutationRow>(
              `SELECT * FROM rows WHERE id IN (?,?)`,
              [keys.target, keys.inserted],
            ),
          ),
        }
        if (peer && h.peer) {
          const pendingAtStop = peerMutation.state === `pending`
          const completed = peerCallbacksFinished
          blockPeer = false
          releaseAll()
          await untilStartup(() => peerCallbacksFinished > completed)
          await drain()
          const row = peer.get(`peer-${h.coordinate}`)
          observed.peer = {
            pendingAtStop,
            mutation: peerMutation.state,
            stopped: peer.health.error !== null,
            row: row ? { id: row.id, value: row.value } : null,
          }
        }
        for (const sub of subscriptions) sub.unsubscribe()
        await collection.cleanup()
        observed.afterCleanup = mutation.state
        active = false
        await database.writeTransaction((tx) =>
          tx.execute(`UPDATE rows SET value=9 WHERE id=?`, [keys.refusal]),
        )
        const completedBefore = setupsCompleted
        // Observe provider setup, not the requested load's successful settlement:
        // a stranded retired mutation can itself keep the new receipt held.
        void start()
        await untilStartup(() => setupsCompleted > completedBefore)
        await drain()
        const fresh = {
          state: `pending` as NativeMutationObservation['mutation'],
        }
        const completedBeforeFreshMutation = callbacksFinished
        const transaction = collection.insert({
          id: keys.restarted,
          value: h.value + 100,
        })
        settlements.push(
          transaction.when(`settled`).then(
            () => {
              fresh.state = `fulfilled`
            },
            () => {
              fresh.state = `rejected`
            },
          ),
        )
        await untilStartup(
          () =>
            callbacksFinished > completedBeforeFreshMutation ||
            fresh.state === `rejected`,
        )
        await drain()
        observed.afterRestart = mutation.state
        observed.restartStatus = collection.status
        observed.restartMutation = fresh.state
        const row = collection.get(keys.restarted)
        observed.restartRow = row ? { id: row.id, value: row.value } : null
        return observed
      }, [
        async () => {
          read.release()
          transactionReturn.release()
          blockPeer = false
          releaseAll()
          stopWatchingHealth()
          for (const sub of subscriptions) sub.unsubscribe()
          peerSubscription?.unsubscribe()
          try {
            await collection.cleanup()
            await peer?.cleanup()
          } finally {
            store.waitFor = waitFor
            // Preserve the completed public cuts above before draining a defective
            // implementation's stranded private waiters for fixture teardown.
            for (const { operation, signal } of owned)
              store.resolvePendingFor([operation], signal)
            await Promise.allSettled(settlements)
          }
        },
      ])
    }, [source.dispose])
  } finally {
    for (let i = 0; i < 8; i++) await turn()
    if (typeof window === `undefined`)
      process.off(`unhandledRejection`, detached)
    else window.removeEventListener(`unhandledrejection`, onRejected)
  }
}

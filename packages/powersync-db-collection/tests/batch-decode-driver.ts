/**
 * Real SQLite supplies source pages/diff rows to the native decoder law. The
 * provider recorder forwards every original read unchanged. It records source
 * input order because SQLite's public contract supplies no scan ordering.
 * Collection publications, readiness, load results and watcher aborts are
 * captured independently of those input facts.
 */
import { Schema, Table, column } from '@powersync/common'
import { createCollection, eq } from '@tanstack/db'
import { z } from 'zod'
import { observeDecodeRows } from '../../db-adapter-conformance/tests/decode-refusal-oracle'
import { untilStartup } from '../../db-adapter-conformance/tests/persisted-startup-driver'
import { powerSyncCollectionOptions } from '../src'
import { retainNativeObservation } from './receiving-cleanup'
import {
  nativeDecodeBatch,
  nativeDecodeKey,
  nativeDecodeRecoveryBatch,
} from './batch-decode-oracle'
import type { LockContext } from '@powersync/common'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type {
  NativeDecodeHistory,
  NativeDecodeObservation,
} from './batch-decode-oracle'
import type { NativeReceivingOpen } from './hook-lifecycle-driver'

const schema = new Schema({
  rows: new Table({ flag: column.integer, when: column.text }),
})
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
export async function observeNativeBatchDecode(
  open: NativeReceivingOpen,
  h: NativeDecodeHistory,
  id: string,
): Promise<NativeDecodeObservation> {
  const source = await open(schema)
  return retainNativeObservation<NativeDecodeObservation>(async () => {
    const database = source.database
    const sourceKey = (key: string) =>
      h.transformKeys ? `provider:${key}` : key
    const applicationKey = (key: string) =>
      h.transformKeys ? key.slice(`provider:`.length) : key
    let recording = h.phase === `initial`
    let refuse = recording && h.outcome !== `valid`
    const sourceBatches: Array<Array<string>> = []
    const parsed: Array<string> = []
    let initialTrackingSettled = false
    let providerSetups = 0
    let decodedRows = 0
    const seenReads = new WeakSet<Array<unknown>>()
    const recordContext = <T extends LockContext>(context: T): T =>
      new Proxy(context, {
        get(target, property, receiver) {
          if (property === `getAll`)
            return async (sql: string, params?: Array<unknown>) => {
              const rows = await target.getAll<unknown>(sql, params)
              if (
                recording &&
                !seenReads.has(rows) &&
                (/SELECT \* FROM .* LIMIT \?/i.test(sql) ||
                  /ORDER BY operation_id ASC/i.test(sql))
              ) {
                seenReads.add(rows)
                if (rows.length)
                  sourceBatches.push(
                    rows.map((row) =>
                      applicationKey(String((row as { id: unknown }).id)),
                    ),
                  )
              }
              return rows
            }
          const value: unknown = Reflect.get(target, property, receiver)
          return typeof value === `function` ? value.bind(target) : value
        },
      })
    const createTrigger = database.triggers.createDiffTrigger.bind(
      database.triggers,
    )
    database.triggers.createDiffTrigger = async (options) => {
      providerSetups++
      try {
        return await createTrigger({
          ...options,
          hooks: {
            ...options.hooks,
            beforeCreate: async (context) =>
              options.hooks?.beforeCreate?.(recordContext(context)),
          },
        })
      } finally {
        providerSetups--
        initialTrackingSettled = true
      }
    }
    const transact = database.writeTransaction.bind(database)
    database.writeTransaction = (callback, timeout) =>
      transact((context) => callback(recordContext(context)), timeout)
    const writeLock = database.writeLock.bind(database)
    database.writeLock = (callback) =>
      writeLock((context) => callback(recordContext(context)))
    const watcherReleases: Array<number> = []
    let running = 0
    const register = database.onChangeWithCallback.bind(database)
    database.onChangeWithCallback = (handler, options) => {
      const index = watcherReleases.push(0) - 1
      options?.signal?.addEventListener(
        `abort`,
        () => {
          watcherReleases[index] = watcherReleases[index]! + 1
        },
        {
          once: true,
        },
      )
      return register(
        {
          ...handler,
          onChange: async (event) => {
            running++
            try {
              await handler?.onChange(event)
            } finally {
              running--
            }
          },
        },
        options,
      )
    }
    const writeSource = (initial: boolean) =>
      database.writeTransaction(async (tx) => {
        for (const row of nativeDecodeBatch(h, initial)) {
          if (initial || !h.overlap)
            await tx.execute(
              `INSERT INTO rows(id,flag,"when") VALUES (?,?,?)`,
              [sourceKey(row.id), Number(row.flag), row.when.toISOString()],
            )
          else
            await tx.execute(`UPDATE rows SET flag=?, "when"=? WHERE id=?`, [
              Number(row.flag),
              row.when.toISOString(),
              sourceKey(row.id),
            ])
        }
      })
    await writeSource(true)
    const refusalKey = nativeDecodeKey(h, h.refusalIndex, h.phase === `initial`)
    const refusal = new Error(`native decode refused ${h.coordinate}`)
    const inputSchema = z.object({
      id: z.string(),
      flag: z.number(),
      when: z.string(),
    })
    // A synchronous Standard Schema exposes a thrown user validator directly.
    // Zod's Standard adapter may turn a throwing transform into asynchronous
    // validation, which is a different, unsupported decoder premise here.
    const deserializationSchema: StandardSchemaV1<
      { id: string; flag: number; when: string },
      { id: string; flag: boolean; when: Date }
    > = {
      '~standard': {
        version: 1,
        vendor: `native-receiving`,
        validate(input) {
          decodedRows++
          const row = inputSchema.parse(input)
          const key = applicationKey(row.id)
          if (recording) parsed.push(key)
          if (refuse && key === refusalKey) {
            if (h.outcome === `throw`) throw refusal
            return { issues: [{ message: refusal.message }] }
          }
          return {
            value: { id: key, flag: row.flag === 1, when: new Date(row.when) },
          }
        },
      },
    }
    const options = powerSyncCollectionOptions({
      id,
      database,
      table: schema.props.rows,
      schema: z.object({ id: z.string(), flag: z.boolean(), when: z.date() }),
      deserializationSchema,
      syncMode: h.mode,
      syncBatchSize: h.batchSize,
      onDeserializationError: () => {},
    })
    const collection = createCollection({ ...options, startSync: false })
    const publications: NativeDecodeObservation['publications'] = []
    const subscription = collection.subscribeChanges(() => {
      if (recording) publications.push(observeDecodeRows(collection.toArray))
    })
    const subscriptions = [subscription]
    let load = `pending`
    let rejectedCauseMatches = false
    const noteLoad = (pending: true | Promise<void>) =>
      Promise.resolve(pending).then(
        () => {
          load = `fulfilled`
        },
        (error: unknown) => {
          load = `rejected`
          rejectedCauseMatches =
            error === refusal || String(error).includes(refusal.message)
        },
      )
    return retainNativeObservation<NativeDecodeObservation>(async () => {
      let initialLoad: Promise<void> | undefined
      if (h.mode === `eager`) initialLoad = noteLoad(collection.preload())
      else {
        await collection.preload()
        subscription.requestSnapshot({
          onLoadSubsetResult: (result) => {
            initialLoad = noteLoad(result)
          },
        })
      }
      if (h.phase === `live`) {
        await untilStartup(() => load === `fulfilled`)
        await initialLoad
        recording = true
        refuse = h.outcome !== `valid`
        await writeSource(false)
      }
      const requiredKeys = nativeDecodeBatch(h, h.phase === `initial`).map(
        (row) => row.id,
      )
      await untilStartup(() =>
        h.outcome === `valid`
          ? requiredKeys.every((key) => parsed.includes(key))
          : parsed.includes(refusalKey),
      )
      if (h.phase === `initial`)
        await untilStartup(() => initialTrackingSettled)
      await untilStartup(() => running === 0)
      // Let the startup catch and its disposal continuation reach their public cut.
      for (let index = 0; index < 8; index++) await turn()
      const reached: Array<string> = [`${h.mode}:${h.phase}:${h.outcome}`]
      if (h.transformKeys) reached.push(`transformed-key`)
      if (h.phase === `live`)
        reached.push(h.overlap ? `live-overlap` : `live-fresh`)
      if (h.outcome !== `valid`) {
        const order = sourceBatches.flat()
        if (order[0] === refusalKey) reached.push(`refusal-first`)
        if (order.at(-1) === refusalKey) reached.push(`refusal-last`)
        if (
          h.phase === `initial` &&
          sourceBatches.findIndex((batch) => batch.includes(refusalKey)) > 0
        )
          reached.push(`accepted-earlier-page`)
      }
      const terminalCause = collection.health.error?.cause
      const observed: NativeDecodeObservation = {
        sourceBatches: sourceBatches.map((batch) => [...batch]),
        parsed: [...parsed],
        rows: observeDecodeRows(collection.toArray),
        // Readiness may repeat the current direct snapshot. This instrument
        // records changing public cuts, preserving A/B/A regressions while
        // collapsing only adjacent identical callbacks whose count is outside
        // its law. Empty SQL reads likewise carry no page-admission input.
        publications: publications.filter(
          (cut, index) =>
            index === 0 ||
            JSON.stringify(cut) !== JSON.stringify(publications[index - 1]),
        ),
        status: collection.status,
        load,
        terminalError: collection.health.error !== null,
        failureReason: collection.health.failureReason !== null,
        rejectedCauseMatches,
        terminalCauseMatches:
          terminalCause === refusal ||
          String(terminalCause).includes(refusal.message),
        watcherReleases: [...watcherReleases],
        reached,
      }
      if (h.outcome !== `valid`) {
        // The original source has already refused. Correct the actual SQLite
        // table without changing the sync run. A source-row notification plus
        // real provider lock/drain cuts supplies opportunity for an improperly
        // live adapter; the expected stopped outcome is never a wait predicate.
        recording = false
        refuse = false
        const decodedBefore = decodedRows
        let sourceChanged!: () => void
        const sourceChange = new Promise<void>((resolve) => {
          sourceChanged = resolve
        })
        const barrierAbort = new AbortController()
        register(
          { onChange: () => sourceChanged() },
          {
            tables: [`rows`],
            signal: barrierAbort.signal,
            triggerImmediate: false,
          },
        )
        try {
          await database.writeTransaction(async (tx) => {
            await tx.execute(`DELETE FROM rows`)
            for (const row of nativeDecodeRecoveryBatch(h))
              await tx.execute(
                `INSERT INTO rows(id,flag,"when") VALUES (?,?,?)`,
                [sourceKey(row.id), Number(row.flag), row.when.toISOString()],
              )
          })
          await sourceChange
        } finally {
          barrierAbort.abort()
        }
        const laterSubsetLoads: Array<{
          empty: boolean
          outcome: string
          causeMatches: boolean
        }> = []
        if (h.mode === `on-demand`) {
          // New public subscriptions and distinct requests start acquisitions.
          // The empty predicate needs no decoder call, so decoder refusal alone
          // cannot accidentally enforce this admission law.
          for (const empty of [false, true]) {
            const later = collection.subscribeChanges(() => {})
            subscriptions.push(later)
            const result = { empty, outcome: `pending`, causeMatches: false }
            laterSubsetLoads.push(result)
            later.requestSnapshot({
              refetch: true,
              limit: h.count + (empty ? 2 : 1),
              ...(empty ? { where: eq(1, 2) } : {}),
              onLoadSubsetResult: (pending) => {
                void Promise.resolve(pending).then(
                  () => {
                    result.outcome = `fulfilled`
                  },
                  (error: unknown) => {
                    result.outcome = `rejected`
                    result.causeMatches = error === terminalCause
                  },
                )
              },
            })
          }
          reached.push(`empty-subset-after-refusal`)
        }
        for (let index = 0; index < 4; index++) await turn()
        await database.writeTransaction(() => Promise.resolve())
        await untilStartup(() => providerSetups === 0 && running === 0)
        for (let index = 0; index < 8; index++) await turn()
        const continuation = {
          sameRunRows: observeDecodeRows(collection.toArray),
          sameRunStatus: collection.status,
          sameRunTerminalError: collection.health.error !== null,
          sameRunCauseStable: collection.health.error?.cause === terminalCause,
          sameRunDecodedRows: decodedRows - decodedBefore,
          laterSubsetLoads: laterSubsetLoads.map((result) => ({ ...result })),
        }
        reached.push(`corrected-source-after-refusal`)

        // A new sync run is explicitly legal after cleanup. Retained reload
        // replacement has a different owner and is not claimed by this cut.
        for (const current of subscriptions) current.unsubscribe()
        await collection.cleanup()
        const firstRestartWatcher = watcherReleases.length
        initialTrackingSettled = false
        const restarted = collection.subscribeChanges(() => {})
        subscriptions.push(restarted)
        let restartLoad = `pending`
        const noteRestart = (pending: true | Promise<void>) => {
          void Promise.resolve(pending).then(
            () => {
              restartLoad = `fulfilled`
            },
            () => {
              restartLoad = `rejected`
            },
          )
        }
        if (h.mode === `eager`) noteRestart(collection.preload())
        else
          restarted.requestSnapshot({
            onLoadSubsetResult: noteRestart,
          })
        await untilStartup(() => initialTrackingSettled)
        await database.writeTransaction(() => Promise.resolve())
        for (let index = 0; index < 8; index++) await turn()
        observed.continuation = {
          ...continuation,
          restartRows: observeDecodeRows(collection.toArray),
          restartStatus: collection.status,
          restartTerminalError: collection.health.error !== null,
          restartFailureReason: collection.health.failureReason !== null,
          restartLoad,
          restartWatcherReleases: watcherReleases.slice(firstRestartWatcher),
        }
        reached.push(`restart-after-refusal`)
      }
      return observed
    }, [
      () => {
        for (const current of subscriptions) current.unsubscribe()
      },
      () => collection.cleanup(),
    ])
  }, [source.dispose])
}

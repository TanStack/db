/**
 * Native PowerSync receives the persisted-demand model through a real local
 * SQLite table. A public onLoadSubset hook holds or rejects acquisition before
 * the adapter reads that table. Without that hook, offline SQLite can legally
 * answer an uncovered demand immediately; network disconnection alone would
 * therefore supply the wrong premise for the wrapper's fallback law.
 *
 * Backend rows and hook invocations are source facts. SDK write-lock completion
 * is the provider-consumption barrier; it never awaits Collection readiness or
 * an applied receipt. The shared recorder owns those separate observations.
 * Node and Chromium inject their own actual PowerSync database factory.
 */
import { Schema, Table, column } from '@powersync/common'
import { createCollection } from '@tanstack/db'
import { z } from 'zod'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { powerSyncCollectionOptions } from '../src'
import type { LockContext } from '@powersync/common'
import type { LoadSubsetOptions } from '@tanstack/db'
import type {
  DemandReceivingFactory,
  DemandRow,
} from '../../db-adapter-conformance/tests/persisted-demand-receiving-types'
import type { NativeReceivingOpen } from './hook-lifecycle-driver'

const schema = new Schema({
  rows: new Table({
    group: column.text,
    rank: column.real,
    value: column.text,
  }),
})
const rowSchema = z.object({
  id: z.string(),
  group: z.string(),
  rank: z.number(),
  value: z.string(),
})
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

type Hook = { answer: () => void; reject: (cause: unknown) => void }

export function nativePowerSyncPersistedDemandSource(
  open: NativeReceivingOpen,
): DemandReceivingFactory {
  return async (input) => {
    const source = await open(schema)
    const database = source.database
    const failure = new Error(
      `PowerSync demand source unavailable: ${input.id}`,
    )
    let mode: `held` | `answer` | `reject` = `held`
    let requestCount = 0
    const pending = new Set<Hook>()
    const providerWork: Array<Promise<unknown>> = []
    const writeLock = database.writeLock.bind(database)
    database.writeLock = <T>(
      callback: (context: LockContext) => Promise<T>,
    ): Promise<T> => {
      const result = writeLock(callback)
      providerWork.push(result)
      // Observation of a failing SDK operation must not create a detached
      // rejection; production still receives its original result unchanged.
      void result.catch(() => undefined)
      return result
    }

    const hook = (request: LoadSubsetOptions): Promise<void> => {
      requestCount++
      if (mode === `answer`) return Promise.resolve()
      if (mode === `reject`) return Promise.reject(failure)
      return new Promise<void>((resolve, reject) => {
        const finish = (cause?: { error: unknown }) => {
          pending.delete(entry)
          request.signal?.removeEventListener(`abort`, abort)
          if (cause) reject(cause.error)
          else resolve()
        }
        const abort = () => {
          const error = new Error(`PowerSync demand hook aborted`)
          error.name = `AbortError`
          finish({ error })
        }
        const entry: Hook = {
          answer: () => finish(),
          reject: (error) => finish({ error }),
        }
        pending.add(entry)
        request.signal?.addEventListener(`abort`, abort, { once: true })
        if (request.signal?.aborted) abort()
      })
    }
    const options = powerSyncCollectionOptions({
      id: input.id,
      database,
      table: schema.props.rows,
      schema: rowSchema,
      deserializationSchema: rowSchema,
      onDeserializationError: () => {},
      syncMode: `on-demand`,
      onLoadSubset: hook,
    })
    const persisted = persistedCollectionOptions({
      ...options,
      sync: input.wrapSync(options.sync),
      persistence: input.persistence,
      initialRender: {
        strategy: `network-first`,
        networkTimeoutMs: input.waitMs,
      },
    })
    const collection = createCollection({
      ...persisted,
      sync: input.wrapPersistedSync(persisted.sync),
    })

    const barrier = async () => {
      // Hook continuations enter writeLock synchronously before awaiting the
      // worker. Drain the operations it actually admitted, including a later
      // acquisition admitted while an earlier read was crossing the worker.
      let consumed = 0
      for (;;) {
        await turn()
        const current = providerWork.slice(consumed)
        consumed += current.length
        await Promise.allSettled(current)
        await turn()
        if (consumed === providerWork.length) return
      }
    }

    return {
      collection,
      answer: async (rows: ReadonlyArray<DemandRow>) => {
        await database.writeTransaction(async (transaction) => {
          for (const row of rows) {
            const previous = await transaction.getOptional<{ id: string }>(
              `SELECT id FROM rows WHERE id=?`,
              [row.id],
            )
            if (previous)
              await transaction.execute(
                `UPDATE rows SET "group"=?,rank=?,value=? WHERE id=?`,
                [row.group, row.rank, row.value, row.id],
              )
            else
              await transaction.execute(
                `INSERT INTO rows(id,"group",rank,value) VALUES(?,?,?,?)`,
                [row.id, row.group, row.rank, row.value],
              )
          }
        })
        input.events.push({
          type: `rows`,
          rows: rows.map((row) => [row.id, { ...row }]),
        })
        mode = `answer`
        for (const entry of [...pending]) entry.answer()
        await barrier()
      },
      reject: async () => {
        mode = `reject`
        for (const entry of [...pending]) entry.reject(failure)
        await barrier()
      },
      requests: () => requestCount,
      barrier,
      dispose: async () => {
        for (const entry of [...pending]) entry.reject(failure)
        await barrier()
        database.writeLock = writeLock
        await source.dispose()
      },
    }
  }
}

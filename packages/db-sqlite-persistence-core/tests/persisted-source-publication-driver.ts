/** Records the idle source turn before any promise continuation can run. */
import { createCollection, createTransaction } from '@tanstack/db'
import { persistedCollectionOptions } from '../src'
import { describeOracleCleanupError } from '../../db/tests/oracle-cleanup'
import type { OpenSourceFifoStore } from './persisted-source-fifo-driver'
import type { Todo, TodoSyncParams } from './persisted-support'

export type SourcePublicationHistory = {
  operation: `insert` | `update` | `delete` | `truncate`
  held: boolean
  abort: boolean
  title: string
}
export type SourcePublicationFault = `corrupt-commit-then-read-fails`
export type SourcePublicationObservation = {
  afterCommit: Array<Todo> | null
  afterAbort: Array<Todo> | null
  final: Array<Todo> | null
  durable: Array<Todo> | null
  reached: Array<string>
  executionErrors: Array<string>
  outcome: string
  status: string
  cleanupErrors: Array<string>
  browserErrors?: ReadonlyArray<string>
}
function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
let sequence = 0
export async function runSourcePublicationHistory(
  h: SourcePublicationHistory,
  open: OpenSourceFifoStore,
  fault?: SourcePublicationFault,
): Promise<SourcePublicationObservation> {
  const id = `source-publication-${++sequence}`
  const store = await open(id, [], undefined)
  let source!: TodoSyncParams
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id,
      getKey: (row) => row.id,
      sync: {
        sync: (params) => {
          source = params
          params.markReady()
        },
      },
      persistence: { adapter: store.adapter },
    }),
  )
  const storage = gate(),
    mutation = gate()
  const local = createTransaction({ mutationFn: () => mutation.promise })
  let receipt: Promise<unknown> | undefined
  const result: SourcePublicationObservation = {
    afterCommit: null,
    afterAbort: null,
    final: null,
    durable: null,
    reached: [],
    executionErrors: [],
    outcome: `not-submitted`,
    status: collection.status,
    cleanupErrors: [],
  }
  const rows = () =>
    collection.toArray
      .map(({ id: key, title }) => ({ id: key, title }))
      .sort((a, b) => a.id.localeCompare(b.id))
  try {
    await collection.preload()
    source.begin()
    source.write({ type: `insert`, value: { id: `shared`, title: `before` } })
    source.write({ type: `insert`, value: { id: `peer`, title: `peer` } })
    await source.commit()
    // Setup drains the initial writer. The judged commit below has no await.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const apply = store.adapter.applyCommittedTx.bind(store.adapter)
    store.adapter.applyCommittedTx = async (...args) => {
      await storage.promise
      return apply(...args)
    }
    if (h.held)
      local.mutate(() => {
        collection.insert({ id: `local`, title: `optimistic` })
      })
    const signal = new AbortController()
    source.begin()
    if (h.operation === `truncate`) source.truncate()
    else if (h.operation === `delete`)
      source.write({ type: `delete`, key: `shared` })
    else
      source.write({
        type: h.operation,
        value: {
          id: h.operation === `insert` ? `new` : `shared`,
          title: h.title,
        },
      })
    receipt = Promise.resolve(source.commit(signal.signal))
    void receipt.catch(() => undefined)
    result.afterCommit = rows()
    const held = local.state === `persisting`
    result.reached.push(`${h.operation}:${held ? `held` : `visible`}`)
    if (fault) result.afterCommit = []
    if (h.abort) signal.abort()
    result.afterAbort = rows()
    result.reached.push(
      signal.signal.aborted ? `post-commit-abort` : `post-commit-live`,
    )
    storage.resolve()
    mutation.resolve()
    if (h.held) await local.when(`settled`)
    result.outcome = await receipt.then(
      () => `fulfilled`,
      (error: unknown) => (error instanceof Error ? error.name : `unknown`),
    )
    result.final = rows()
    const stored = await store.read()
    if (fault) throw new Error(`calibrated durable observation failure`)
    result.durable = stored.rows
      .map(({ id: key, title }) => ({ id: key, title }))
      .sort((a, b) => a.id.localeCompare(b.id))
  } catch (error) {
    result.executionErrors.push(describeOracleCleanupError(error))
  } finally {
    result.status = collection.status
    storage.resolve()
    mutation.resolve()
    for (const cleanup of [
      () => receipt?.catch(() => undefined),
      () => collection.cleanup(),
      () => store.close(),
    ]) {
      try {
        await cleanup()
      } catch (error) {
        result.cleanupErrors.push(describeOracleCleanupError(error))
      }
    }
  }
  return result
}

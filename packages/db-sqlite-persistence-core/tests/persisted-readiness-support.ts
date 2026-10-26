import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../src/index.js'
import type { PersistenceAdapter } from '../src/index.js'

// Helpers shared by the persisted-readiness oracle and its ordinary example
// tests. They build controlled adapters and collections and run cleanup. They
// compare nothing, so the oracle rule does not treat them as oracle parts.

export type Row = { id: string; value: string }

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

export function recordingAdapter(rows: ReadonlyArray<Row>) {
  const load = deferred<void>()
  const adapter: PersistenceAdapter = {
    loadSubset: async () => {
      await load.promise
      return rows.map((value) => ({ key: value.id, value }))
    },
    loadResumeSnapshot: async (_id, options) => {
      if (options?.includeRows !== false) await load.promise
      return {
        rows:
          options?.includeRows === false
            ? []
            : rows.map((value) => ({ key: value.id, value })),
        keySet: { status: `consistent` },
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }
    },
    applyCommittedTx: async () => {},
    ensureIndex: async () => {},
  }
  return { adapter, load }
}

export function source(
  id: string,
  adapter: PersistenceAdapter,
  optIn: boolean,
  networkTimeoutMs = 0,
) {
  return createCollection(
    persistedCollectionOptions<Row, string>({
      id,
      getKey: (row) => row.id,
      persistence: { adapter },
      ...(optIn
        ? {
            initialRender: {
              strategy: `network-first` as const,
              networkTimeoutMs,
            },
          }
        : {}),
      // Upstream never declares Collection readiness. Local restore is a
      // separately observable boundary even while this stays loading.
      sync: { sync: () => ({}) },
    }),
  )
}

export async function checkWithCleanup(
  check: () => Promise<void> | void,
  cleanups: ReadonlyArray<() => Promise<unknown> | unknown>,
): Promise<void> {
  let hasPrimaryFailure = false
  let primaryFailure: unknown
  try {
    await check()
  } catch (error) {
    hasPrimaryFailure = true
    primaryFailure = error
  }

  const cleanupFailures: Array<unknown> = []
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  if (hasPrimaryFailure) {
    if (cleanupFailures.length) {
      throw new AggregateError(
        [primaryFailure, ...cleanupFailures],
        `Persisted-readiness check and cleanup both failed`,
        { cause: primaryFailure },
      )
    }
    throw primaryFailure
  }
  if (cleanupFailures.length === 1) throw cleanupFailures[0]
  if (cleanupFailures.length > 1) {
    throw new AggregateError(
      cleanupFailures,
      `Persisted-readiness cleanup failed`,
    )
  }
}

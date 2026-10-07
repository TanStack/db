import { compileSingleRowExpression, toBooleanPredicate } from '@tanstack/db'
import type { PersistenceAdapter } from '../../db-sqlite-persistence-core/src'

export type TestRow = { id: number; name: string; stable: string }

// Controlled durable storage for the descriptor and installed-SDK oracles.
// This fixture records committed data; it does not compute expected behavior
// or stand in for a native SQLite host.
export function tagPersistence() {
  const rows = new Map<
    string | number,
    { value: TestRow; metadata?: unknown }
  >()
  const metadata = new Map<string, unknown>()
  let latestTerm = 0
  let latestSeq = 0
  let latestRowVersion = 0
  let resetEpoch = 0
  const adapter: PersistenceAdapter = {
    loadSubset: (_id, options) => {
      const predicate = options.where
        ? compileSingleRowExpression(options.where)
        : undefined
      return Promise.resolve(
        Array.from(rows, ([key, row]) => ({
          key,
          ...structuredClone(row),
        })).filter(({ value }) =>
          predicate
            ? toBooleanPredicate(predicate(value) as boolean | null)
            : true,
        ),
      )
    },
    loadResumeSnapshot: (_id, ctx) =>
      Promise.resolve({
        rows:
          ctx?.includeRows === false
            ? []
            : Array.from(rows, ([key, row]) => ({
                key,
                ...structuredClone(row),
              })),
        keySet: { status: `consistent` },
        collectionMetadata: Array.from(metadata, ([key, value]) => ({
          key,
          value: structuredClone(value),
        })),
        latestTerm,
        latestSeq,
        latestRowVersion,
        resetEpoch,
      }),
    loadCollectionMetadata: () =>
      Promise.resolve(
        Array.from(metadata, ([key, value]) => ({
          key,
          value: structuredClone(value),
        })),
      ),
    applyCommittedTx: (_id, transaction) => {
      if (transaction.truncate) {
        rows.clear()
        resetEpoch++
      }
      for (const mutation of transaction.mutations) {
        if (mutation.type === `delete`) rows.delete(mutation.key)
        else
          rows.set(mutation.key, {
            value: {
              ...rows.get(mutation.key)?.value,
              ...structuredClone(mutation.value),
            } as TestRow,
            metadata: structuredClone(
              mutation.metadata ?? rows.get(mutation.key)?.metadata,
            ),
          })
      }
      for (const mutation of transaction.rowMetadataMutations ?? []) {
        const row = rows.get(mutation.key)
        if (row)
          row.metadata =
            mutation.type === `delete`
              ? undefined
              : structuredClone(mutation.value)
      }
      for (const mutation of transaction.collectionMetadataMutations ?? []) {
        if (mutation.type === `delete`) metadata.delete(mutation.key)
        else metadata.set(mutation.key, structuredClone(mutation.value))
      }
      latestTerm = transaction.term
      latestSeq = transaction.seq
      latestRowVersion = transaction.rowVersion
      return Promise.resolve()
    },
    ensureIndex: () => Promise.resolve(),
  }
  return { rows, metadata, adapter }
}

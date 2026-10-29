/**
 * Driver support for the conformance oracles. An adapter's rows or keys may
 * differ from the conformance row: RxDB keys are strings, and a SQL backend
 * stores an absent field as `NULL`. A driver states that mapping once with
 * `observedView`, and the oracle reads the Collection through it. The mapping
 * must be one-to-one on the rows a history can produce, so it cannot hide a
 * defect: `conformanceKey` and `fromSqlRow` reject anything outside it.
 */
import type { ChangeMessage, HealthNode } from '@tanstack/db'
import type {
  ConformanceRow,
  ObservedCollection,
} from './eager-live-source-oracle'

/** The public Collection surface `observedView` reads. */
export interface AdapterCollection<
  TRow extends object,
  TKey extends string | number,
> {
  readonly status: string
  readonly health: HealthNode
  values: () => IterableIterator<TRow>
  preload: () => Promise<void>
  cleanup: () => Promise<void>
  subscribeChanges: (
    callback: (changes: Array<ChangeMessage<TRow, TKey>>) => void,
    options?: { includeInitialState?: boolean },
  ) => { unsubscribe: () => void }
  on: (event: `status:ready`, callback: () => void) => () => void
}

/** The Collection seen with conformance rows and keys. */
export function observedView<TRow extends object, TKey extends string | number>(
  collection: AdapterCollection<TRow, TKey>,
  mapping: {
    row: (row: TRow) => ConformanceRow
    key: (key: TKey) => number
  },
): ObservedCollection {
  return {
    get status() {
      return collection.status
    },
    get health() {
      return collection.health
    },
    *values() {
      for (const row of collection.values()) yield mapping.row(row)
    },
    preload: () => collection.preload(),
    cleanup: () => collection.cleanup(),
    on: (event, callback) => collection.on(event, callback),
    subscribeChanges: (callback, options) =>
      collection.subscribeChanges(
        (changes) =>
          callback(
            changes.map((change): ChangeMessage<ConformanceRow, number> => ({
              ...change,
              key: mapping.key(change.key),
              value: mapping.row(change.value),
              previousValue:
                change.previousValue && mapping.row(change.previousValue),
            })),
          ),
        options,
      ),
  }
}

/** Maps a string key `"n"` back to conformance id `n`; rejects anything else. */
export function conformanceKey(key: unknown): number {
  const id = Number(key)
  if (typeof key !== `string` || !Number.isInteger(id) || String(id) !== key) {
    throw new Error(`key ${JSON.stringify(key)} is not a conformance id`)
  }
  return id
}

/** A conformance row as a SQL row: an absent `note` is `NULL`. */
export function toSqlRow(row: ConformanceRow) {
  return {
    id: row.id,
    title: row.title,
    note: row.note ?? null,
    // A JSON column; present only when the driver declares value kinds.
    ...(Object.hasOwn(row, `value`) ? { value: row.value } : {}),
  }
}

/**
 * A SQL row back as a conformance row: `NULL` is an absent `note`. Every
 * other field passes through, so an extra or missing column still shows.
 */
export function fromSqlRow<TRow extends { note?: unknown }>(
  row: TRow,
): ConformanceRow {
  if (!Object.hasOwn(row, `note`)) {
    throw new Error(`SQL row ${JSON.stringify(row)} has no note column`)
  }
  const { note, ...rest } = row
  return (note === null ? rest : { ...rest, note }) as unknown as ConformanceRow
}

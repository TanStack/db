// Shared fixtures for the LocalStorage write-order tests. The law and its
// generated histories are owned by local-storage-order-oracle.test.ts.
import { expect } from 'vitest'

export type Row = { id: string; value: number }
export const initial: Array<Row> = [
  { id: 'a', value: 0 },
  { id: 'b', value: 0 },
]

export function sortedRows(values: Iterable<Row>) {
  return [...values]
    .map(({ id, value }) => ({ id, value }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function storedRows(raw: string | null): Array<Row> {
  expect(raw).not.toBeNull()
  const records = JSON.parse(raw!) as Record<string, { data: Row }>
  return sortedRows(Object.values(records).map(({ data }) => data))
}

export function makeStorage() {
  const values = new Map<string, string>()
  return {
    getItem(key: string) {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
    removeItem(key: string) {
      values.delete(key)
    },
  }
}

export function makeSeededStorage() {
  const storage = makeStorage()
  storage.setItem(
    'rows',
    JSON.stringify(
      Object.fromEntries(
        initial.map((row) => [
          `s:${row.id}`,
          { versionKey: `initial-${row.id}`, data: row },
        ]),
      ),
    ),
  )
  return storage
}

import { BasicIndex, createCollection } from '../src'
import type { Collection } from '../src'

// Source collections for index-metadata tests. Each test file that uses them
// cleans them up in its own afterEach, so every collection ends with its test.
type Row = { id: string; stamp: unknown }
export const collections: Array<Collection<Row, string>> = []

export function createSource() {
  const result = createCollection({
    getKey: (row: Row) => row.id,
    sync: { sync: ({ markReady }) => markReady() },
    defaultIndexType: BasicIndex,
  })
  collections.push(result)
  return result
}

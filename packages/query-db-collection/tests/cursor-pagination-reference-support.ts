// Fixed rows and scope shared by the opaque cursor pager oracle
// (cursor-pagination.oracle.test.ts) and its ordinary reference tests
// (cursor-pagination-reference.test.ts).
import type { Row, Scope } from './cursor-pagination/model-oracle.js'

export const fixtureRows: Array<Row> = Array.from({ length: 9 }, (_, id) => ({
  id,
  rank: Math.floor(id / 6),
  group: id % 2,
}))
export const allAscending: Scope = { group: undefined, descending: false }

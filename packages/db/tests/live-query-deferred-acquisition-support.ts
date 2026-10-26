// Shared helpers for the oracle file and the ordinary tests moved from it.
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
  eq,
} from '../src'
import type { Collection } from '../src'

export type Row = { id: string; rank: number; group: string }
export const ROWS: Array<Row> = [
  { id: `a`, rank: 1, group: `g` },
  { id: `b`, rank: 2, group: `g` },
  { id: `c`, rank: 3, group: `g` },
]
/**
 * ## Source states
 *
 * `-running` and `-holding` source Collections already started their sync
 * run, by `startSync: true`, before any live-query Collection exists. An eager
 * source Collection writes every row when its sync run starts. An on-demand
 * source Collection writes rows only for an acquisition attempt, except that
 * `on-demand-holding` already holds every row, as it would after another
 * consumer's acquisition. Each fixture counts sync-run starts and acquisition
 * attempts: those are its provider work.
 */
export type SourceState =
  | `eager-idle`
  | `eager-running`
  | `on-demand-idle`
  | `on-demand-running`
  | `on-demand-holding`
/**
 * ## Query shapes
 *
 * `all` reads every row. `window` orders by rank and keeps a limit of two,
 * which uses the ordered loading path.
 */
export type QueryShape = `all` | `window`
export const QUERY_SHAPES: Array<QueryShape> = [`all`, `window`]
export const EXPECTED_IDS: Record<QueryShape, Array<string>> = {
  all: [`a`, `b`, `c`],
  window: [`a`, `b`],
}
/**
 * ## Production driver
 *
 * Real Collections only. The source Collection counts its own provider work.
 * The driver reads the outer live-query Collection's status right after each
 * command returns, for the synchronous observation cut, and its status and
 * rows again after the history settles.
 */
let sequence = 0
export function makeSource(state: SourceState) {
  const counts = { starts: 0, acquisitions: 0 }
  const onDemand = state.startsWith(`on-demand`)
  const written = new Set<string>()
  // Set while a sync run is active: replaces the source's rows, as a
  // must-refetch does. An eager source writes every row again.
  let truncateRows: (() => void) | undefined
  const collection = createCollection<Row>({
    id: `deferred-acquisition-${sequence++}`,
    getKey: (row) => row.id,
    syncMode: onDemand ? `on-demand` : `eager`,
    startSync: state !== `eager-idle` && state !== `on-demand-idle`,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    gcTime: 0,
    sync: {
      sync: ({ begin, write, commit, markReady, truncate }) => {
        counts.starts++
        const writeAll = () => {
          begin()
          for (const row of ROWS) {
            if (written.has(row.id)) continue
            written.add(row.id)
            write({ type: `insert`, value: row })
          }
          commit()
        }
        if (!onDemand || state === `on-demand-holding`) writeAll()
        truncateRows = () => {
          begin()
          truncate()
          commit()
          written.clear()
          if (!onDemand) writeAll()
        }
        markReady()
        if (!onDemand) return
        return {
          loadSubset: () => {
            counts.acquisitions++
            writeAll()
            return true
          },
        }
      },
    },
  })
  return { collection, counts, truncate: () => truncateRows?.() }
}
export function makeLiveQuery(
  source: Collection<Row, string | number, any>,
  shape: QueryShape,
  depth: 1 | 2,
): {
  outer: Collection<Row, string | number, any>
  collections: Array<Collection<Row, string | number, any>>
} {
  const read = (q: any, from: unknown) => {
    const base = q
      .from({ row: from })
      .orderBy(({ row }: any) => row.rank, `asc`)
    return shape === `window` ? base.limit(2) : base
  }
  const inner = createLiveQueryCollection({
    query: (q) => read(q, source),
    gcTime: 0,
  })
  if (depth === 1) return { outer: inner, collections: [inner] }
  const outer = createLiveQueryCollection({
    query: (q) => read(q, inner),
    gcTime: 0,
  })
  return { outer, collections: [outer, inner] }
}
export async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}
export const pooledQuery =
  (source: Collection<Row, string | number, any>) => (q: any) =>
    q
      .from({ row: source })
      .where(({ row }: any) => eq(row.group, `g`))
      .orderBy(({ row }: any) => row.rank, `asc`)

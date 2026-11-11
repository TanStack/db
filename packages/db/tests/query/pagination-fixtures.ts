/**
 * Controlled-provider fixtures shared by `pagination-oracle.property.test.ts`
 * and its ordinary tests in `pagination-recomputation.test.ts`, moved
 * unchanged from the oracle file. They supply source behavior and row shapes;
 * they compute no expected window. This module registers no tests and keeps no
 * state.
 */
import { BTreeIndex } from '../../src/index.js'
import { createCollection } from '../../src/collection/index.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import type { createDeferred } from '../../src/deferred.js'
import type { PageRow } from './pagination-support.js'
import type { LoadSubsetOptions } from '../../src/types.js'

export type PublicPageRow = Pick<PageRow, `id` | `rank`>

export type MultiOrderRow = {
  id: number
  primary: number | null
  secondary: number | null
}

export type LocaleCursorRow = {
  id: number
  label: string
}

// responseStarted is driver bookkeeping: provider response processing has started (delivery or rejection), although the
// acquisition promise may remain pending until its writes apply.
export type PendingCursorLoad = {
  options: LoadSubsetOptions
  deferred: ReturnType<typeof createDeferred<void>>
  responseStarted?: boolean
}

export function projectPageRow(row: PageRow): PublicPageRow {
  return { id: row.id, rank: row.rank }
}

export function rowsForLoadSubset<TRow extends { id: number }>(
  rows: ReadonlyArray<TRow>,
  options: LoadSubsetOptions,
): Array<TRow> {
  const matchingRows = options.where
    ? rows.filter(
        (row) => evaluateReferenceExpression(options.where!, row) === true,
      )
    : rows
  if (!options.cursor) {
    const start = options.offset ?? 0
    const end =
      options.limit === undefined ? matchingRows.length : start + options.limit
    return matchingRows.slice(start, end)
  }

  const current = matchingRows.filter((row) =>
    Boolean(evaluateReferenceExpression(options.cursor!.whereCurrent, row)),
  )
  const from = matchingRows.filter((row) =>
    Boolean(evaluateReferenceExpression(options.cursor!.whereFrom, row)),
  )
  const limitedFrom =
    options.limit === undefined ? from : from.slice(0, options.limit)
  const requested = new Map<number, TRow>()
  for (const row of [...current, ...limitedFrom]) requested.set(row.id, row)
  return [...requested.values()]
}

export function createConformingOrderedSource<TRow extends { id: number }>(
  id: string,
  rows: ReadonlyArray<TRow>,
  autoIndex: `eager` | `off` = `eager`,
) {
  const requests: Array<LoadSubsetOptions> = []
  const delivered = new Set<number>()
  const source = createCollection<TRow>({
    id,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            requests.push(options)
            const requested = rowsForLoadSubset(rows, options)
            begin()
            for (const row of requested) {
              if (delivered.has(row.id)) continue
              delivered.add(row.id)
              write({ type: `insert`, value: row })
            }
            const receipt = commit(options.signal)
            return receipt === true ? Promise.resolve() : receipt
          },
        }
      },
    },
  })

  return { requests, source }
}

export type CustomCollationRow = {
  id: number
  groupId: number
  label: string
  keep: boolean
}

export const customCollationProviderRows = [
  { id: 0, groupId: 1, label: `3`, keep: false },
  { id: 1, groupId: 1, label: `pillow fort`, keep: true },
  { id: 3, groupId: 1, label: `+3 power`, keep: true },
  { id: 4, groupId: 1, label: `pillowfort`, keep: true },
  { id: 2, groupId: 1, label: `3`, keep: true },
] satisfies ReadonlyArray<CustomCollationRow>

export const customCollationRanks = new Map<string, number>([
  [`3`, 0],
  [`+3 power`, 0],
  [`pillowfort`, 1],
  [`pillow fort`, 2],
])

export function compareCustomCollationStrings(a: string, b: string): number {
  return customCollationRanks.get(a)! - customCollationRanks.get(b)!
}

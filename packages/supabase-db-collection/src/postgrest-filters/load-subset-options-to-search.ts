import { appendOffset, paramsToSearch, toPostgrestParams } from './common'
import { subsetParamsToSearch } from './subset-params-to-search'
import type { LoadSubsetOptions } from '@tanstack/db'

/**
 * Render the cursor's `whereFrom` (keyset "rows after boundary") filters.
 *
 * Uses the adapter's own {@link toPostgrestParams} renderer so it handles the
 * composite cursors core emits for multi-column `orderBy`
 * (`or(gt(c1,v1), and(eq(c1,v1), gt(c2,v2)))`) and serialises Date boundaries
 * as ISO 8601 — both of which the pre-flattening `extractSimpleComparisons`
 * path could not. `strict` surfaces any un-pushable cursor rather than silently
 * dropping a predicate and widening the window.
 */
export function cursorWhereFromToSearch(
  cursor: LoadSubsetOptions['cursor'],
): URLSearchParams {
  if (!cursor) return new URLSearchParams()
  return paramsToSearch(toPostgrestParams(cursor.whereFrom, { strict: true }))
}

/**
 * Build the full read query string for a TanStack DB subset load: the shared
 * subset params ({@link subsetParamsToSearch}) plus `select=*` and the cursor's
 * keyset (`whereFrom`) filters, or `offset` for cursor-less requests.
 */
export function loadSubsetOptionsToSearch(
  options: LoadSubsetOptions,
): URLSearchParams {
  const search = new URLSearchParams()
  search.set('select', '*')
  for (const [key, value] of subsetParamsToSearch(options)) {
    search.append(key, value)
  }

  for (const [key, value] of cursorWhereFromToSearch(options.cursor)) {
    search.append(key, value)
  }

  // Cursor and offset are mutually exclusive: core may send both, but the
  // cursor already pins the window start, so an offset on top of it re-skips
  // rows the cursor has already moved past. Honour offset only without a cursor.
  if (options.offset && !options.cursor) {
    appendOffset(search, options.offset)
  }
  return search
}

/**
 * Build the read query string for the boundary-tie request that accompanies a
 * cursor load: the same `where`/`order` as the main request plus the cursor's
 * `whereCurrent` (rows equal to the boundary value), and deliberately **no
 * limit** — every tied row must come back or a row sharing the boundary value
 * with `orderBy` would be skipped. Returns `null` when there is no cursor or no
 * tie predicate, so the caller can fall back to the single main request.
 */
export function cursorCurrentToSearch(
  options: LoadSubsetOptions,
): URLSearchParams | null {
  if (!options.cursor) return null
  const currentParams = toPostgrestParams(options.cursor.whereCurrent, {
    strict: true,
  })
  if (currentParams.length === 0) return null

  const search = new URLSearchParams()
  search.set('select', '*')
  // where + order only — no limit, no offset, no `whereFrom`.
  for (const [key, value] of subsetParamsToSearch({
    where: options.where,
    orderBy: options.orderBy,
  })) {
    search.append(key, value)
  }
  for (const [key, value] of paramsToSearch(currentParams)) {
    search.append(key, value)
  }
  return search
}

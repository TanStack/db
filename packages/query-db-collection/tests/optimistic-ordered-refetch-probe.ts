import { applyPredicates } from '../e2e/query-filter.js'
import type { LoadSubsetOptions } from '@tanstack/db'

export type Row = { id: number; folder: `inbox` | `archive`; at: number }

// A boundary probe may omit ordering, but its predicate must select one rank.
// Add another row at that rank so a key-specific request cannot masquerade as
// a rank-tie probe. Evaluate the whole predicate scope, not the capped answer.
export function isNarrowRankTieProbe(
  options: LoadSubsetOptions,
  remote: Array<Row>,
): boolean {
  if (options.orderBy !== undefined || options.where === undefined) return false
  const matches = applyPredicates(remote, { where: options.where })
  if (matches.length === 0) return false
  const rank = matches[0]!.at
  if (matches.some((row) => row.at !== rank)) return false
  const additionalTie: Row = { ...matches[0]!, id: 1000 }
  return applyPredicates([...remote, additionalTie], {
    where: options.where,
  }).some((row) => row.id === additionalTie.id)
}

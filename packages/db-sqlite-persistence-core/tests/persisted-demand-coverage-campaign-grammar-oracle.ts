/**
 * The demands of the generated persisted demand coverage campaign in
 * persisted-demand-coverage-campaign-oracle.test.ts: the row groups, the
 * three demands that live queries read, and the query each demand sends.
 * Owns nothing: the campaign drives production with them, and
 * persisted-demand-coverage-campaign-calibration.test.ts calibrates the shared
 * comparison with them.
 */
import type { QuerySpec } from './persisted-demand-coverage-model-oracle.js'

export type Group = `a` | `b`
// The demands that live queries read: each group unordered, and the window
// `group = 'a' orderBy rank limit 2`.
export type Demand = `a` | `b` | `w`
export const WINDOW_LIMIT = 2

export const SPECS: Record<Demand, QuerySpec> = {
  a: { group: `a` },
  b: { group: `b` },
  w: { group: `a`, orderByRank: true, limit: WINDOW_LIMIT },
}

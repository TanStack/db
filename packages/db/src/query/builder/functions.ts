// Re-export all operators from their individual modules
// Each module auto-registers its evaluator when imported
export { eq } from "./operators/eq.js"
export { gt } from "./operators/gt.js"
export { gte } from "./operators/gte.js"
export { lt } from "./operators/lt.js"
export { lte } from "./operators/lte.js"
export { and } from "./operators/and.js"
export { or } from "./operators/or.js"
export { not } from "./operators/not.js"
export { inArray } from "./operators/in.js"
export { like } from "./operators/like.js"
export { ilike } from "./operators/ilike.js"
export { upper } from "./operators/upper.js"
export { lower } from "./operators/lower.js"
export { length } from "./operators/length.js"
export { concat } from "./operators/concat.js"
export { coalesce } from "./operators/coalesce.js"
export { add } from "./operators/add.js"
export { subtract } from "./operators/subtract.js"
export { multiply } from "./operators/multiply.js"
export { divide } from "./operators/divide.js"
export { isNull } from "./operators/isNull.js"
export { isUndefined } from "./operators/isUndefined.js"

// Re-export all aggregates from their individual modules
// Each module auto-registers its config when imported
export { count } from "./aggregates/count.js"
export { avg } from "./aggregates/avg.js"
export { sum } from "./aggregates/sum.js"
export { min } from "./aggregates/min.js"
export { max } from "./aggregates/max.js"

/**
 * List of comparison function names that can be used with indexes
 */
export const comparisonFunctions = [
  `eq`,
  `gt`,
  `gte`,
  `lt`,
  `lte`,
  `in`,
  `like`,
  `ilike`,
] as const

/**
 * All supported operator names in TanStack DB expressions
 */
export const operators = [
  // Comparison operators
  `eq`,
  `gt`,
  `gte`,
  `lt`,
  `lte`,
  `in`,
  `like`,
  `ilike`,
  // Logical operators
  `and`,
  `or`,
  `not`,
  // Null checking
  `isNull`,
  `isUndefined`,
  // String functions
  `upper`,
  `lower`,
  `length`,
  `concat`,
  // Numeric functions
  `add`,
  `subtract`,
  `multiply`,
  `divide`,
  // Utility functions
  `coalesce`,
  // Aggregate functions
  `count`,
  `avg`,
  `sum`,
  `min`,
  `max`,
] as const

export type OperatorName = (typeof operators)[number]

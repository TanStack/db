// Re-export all operators
// Each operator is a function that creates Func IR nodes with embedded evaluators

// Comparison operators
export { eq } from './eq.js'
export { gt } from './gt.js'
export { gte } from './gte.js'
export { lt } from './lt.js'
export { lte } from './lte.js'

// Boolean operators
export { and } from './and.js'
export { or } from './or.js'
export { not } from './not.js'

// Array operators
export { inArray } from './in.js'

// String pattern operators
export { like } from './like.js'
export { ilike } from './ilike.js'

// String functions
export { upper } from './upper.js'
export { lower } from './lower.js'
export { length } from './length.js'
export { concat } from './concat.js'
export { coalesce } from './coalesce.js'

// Math functions
export { add } from './add.js'
export { subtract } from './subtract.js'
export { multiply } from './multiply.js'
export { divide } from './divide.js'

// Null checking functions
export { isNull } from './isNull.js'
export { isUndefined } from './isUndefined.js'

// Factory generators for custom operators
export {
  isUnknown,
  comparison,
  booleanOp,
  transform,
  numeric,
  pattern,
} from './factories.js'

// Public API for defining custom operators
export { defineOperator, defineAggregate } from './define.js'
export type {
  OperatorConfig,
  AggregateDefinition,
  ExpressionArg,
  ExpressionArgs,
  TypedCompiledExpression,
  CompiledArgsFor,
  TypedEvaluatorFactory,
} from './define.js'

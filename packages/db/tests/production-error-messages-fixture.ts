import * as Errors from '../src/index'

// The error classes the package exports, shared by the production-message oracle and its ordinary coverage test.
export const exportedErrorClasses = Object.entries(Errors).filter(
  ([, value]) =>
    typeof value === `function` && value.prototype instanceof Error,
)

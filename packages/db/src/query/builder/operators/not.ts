import { defineOperator } from './define.js'
import { isUnknown, transform } from './factories.js'

// NOT: returns null for unknown, negates boolean values
// Note: Runtime returns null for unknown values (3-valued logic),
// but typed as boolean for backward compatibility
export const not = /* #__PURE__*/ defineOperator<boolean, [value: unknown]>({
  name: `not`,
  compile: transform((v) => (isUnknown(v) ? null : !v)),
})

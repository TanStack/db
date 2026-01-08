import { defineOperator } from './define.js'
import { transform } from './factories.js'

export const isUndefined = /* #__PURE__*/ defineOperator<
  boolean,
  [value: unknown]
>({
  name: `isUndefined`,
  compile: transform((v) => v === undefined),
})

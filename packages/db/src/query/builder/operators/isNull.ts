import { defineOperator } from './define.js'
import { transform } from './factories.js'

export const isNull = /* #__PURE__*/ defineOperator<boolean, [value: unknown]>({
  name: `isNull`,
  compile: transform((v) => v === null),
})

import { fileURLToPath } from 'node:url'
import base from '../../eslint.config.js'

// Limit TypeScript resolver discovery to the prepared instrument. Preserve
// every repository rule, including the oracle rules and import-cycle checks.
export default [
  ...base,
  {
    settings: {
      'import-x/resolver': {
        typescript: {
          project: fileURLToPath(new URL(`./tsconfig.json`, import.meta.url)),
        },
      },
    },
  },
]

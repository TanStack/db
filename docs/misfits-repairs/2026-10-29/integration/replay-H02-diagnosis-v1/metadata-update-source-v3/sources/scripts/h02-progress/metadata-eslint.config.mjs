import { fileURLToPath } from 'node:url'
import base from '../../eslint.config.js'

// Preserve every rule. Limit both parser and resolver programs to this static
// instrument instead of discovering all workspace tsconfigs through symlinks.
const project = fileURLToPath(
  new URL(`./metadata-tsconfig.json`, import.meta.url),
)
export default [
  ...base,
  {
    files: [`**/*.ts`, `**/*.tsx`],
    languageOptions: {
      parserOptions: {
        project,
        tsconfigRootDir: fileURLToPath(new URL(`../../`, import.meta.url)),
      },
    },
    settings: { 'import-x/resolver': { typescript: { project } } },
  },
]

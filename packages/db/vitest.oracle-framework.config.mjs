import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import base from './vite.config'

// The oracleProperty self-oracle, outside the package's default test run. It
// runs synthetic properties in child Vitest processes, which use the default
// config.
const config = mergeConfig(
  base,
  defineConfig({
    test: { coverage: { enabled: false }, typecheck: { enabled: false } },
  }),
)
// mergeConfig concatenates arrays, so the default run's exclusion of this
// file is replaced, not extended.
config.test.include = [`**/oracle-property-self-oracle.test.ts`]
config.test.exclude = [...configDefaults.exclude]
export default config

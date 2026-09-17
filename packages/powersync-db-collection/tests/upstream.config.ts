import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: `powersync-upstream-contract-repros`,
    dir: `./tests`,
    include: [`**/*.repro.ts`],
    environment: `node`,
    coverage: { enabled: false },
    typecheck: { enabled: false },
  },
})

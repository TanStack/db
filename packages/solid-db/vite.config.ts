import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/vite-config'
import solidPlugin from '@solidjs/vite-plugin'
import packageJson from './package.json'

const config = defineConfig({
  plugins: [solidPlugin()],
  test: {
    name: packageJson.name,
    dir: `./tests`,
    environment: `jsdom`,
    setupFiles: [`./tests/test-setup.ts`],
    coverage: { enabled: true, provider: `istanbul`, include: [`src/**/*`] },
    typecheck: { enabled: true },
    // The plugin inlines Solid's runtime into the test module graph and
    // leaves `@solid-primitives` to Node, which loads a second copy: a
    // `ReactiveMap` then notifies no computation of the first. Inlined, the
    // keyed view `state` is reactive in tests, as it is in an application.
    server: { deps: { inline: [/@solid-primitives\//] } },
  },
})

export default mergeConfig(
  config,
  tanstackViteConfig({
    entry: `./src/index.ts`,
    srcDir: `./src`,
    cjs: false,
  }),
)

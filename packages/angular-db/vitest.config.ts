import angular from '@analogjs/vite-plugin-angular'
import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/vite-config'
import packageJson from './package.json'

export default mergeConfig(
  defineConfig({
    esbuild: {
      target: 'es2022',
    },
    plugins: [
      angular({
        tsconfig: './tsconfig.spec.json',
        jit: false,
      }),
    ],
    test: {
      name: packageJson.name,
      dir: './tests',
      environment: 'jsdom',
      setupFiles: ['./tests/test-setup.ts'],
      coverage: { enabled: true, provider: 'istanbul', include: ['src/**/*'] },
      typecheck: { enabled: true },
    },
  }),
  tanstackViteConfig({
    entry: `./src/index.ts`,
    srcDir: `./src`,
  }),
)

import { tanstackConfig } from '@tanstack/eslint-config'
import oraclePlugin from '@tanstack/eslint-plugin-oracles'
import {
  oracleLintSettings,
  registrationExceptionConfig,
} from './scripts/oracle-lint-settings.mjs'

export default [
  ...tanstackConfig,
  {
    ignores: [
      `**/dist/**`,
      `packages/convex-db-collection/e2e/backend/convex/_generated/**`,
      `**/.output/**`,
      `**/.nitro/**`,
      `**/traildepot/**`,
      `examples/angular/**`,
      // The gap report CLI's evidence store and workspace bundles.
      `**/.oracle-gaps/**`,
      `**/.oracle-gaps-*`,
      `packages/db-collection-e2e/vite.config.ts`,
      // Third-party adapter source vendored unchanged as a conformance fixture.
      `packages/db-adapter-conformance/tests/neon/vendor/**`,
      `packages/capacitor-db-sqlite-persistence/e2e/app/android/**`,
      `packages/capacitor-db-sqlite-persistence/e2e/app/ios/**`,
      // Expo expects Metro config in CommonJS format.
      `packages/expo-db-sqlite-persistence/e2e/expo-runtime-app/metro.config.js`,
    ],
  },
  {
    settings: {
      // import-x/* settings required for import/no-cycle.
      'import-x/resolver': { typescript: true },
      'import-x/extensions': ['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs'],
    },
    rules: {
      'pnpm/enforce-catalog': `off`,
      'pnpm/json-enforce-catalog': `off`,
    },
  },
  {
    files: [`**/*.ts`, `**/*.tsx`],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        `error`,
        { argsIgnorePattern: `^_`, varsIgnorePattern: `^_` },
      ],
      '@typescript-eslint/naming-convention': [
        `error`,
        {
          selector: `typeParameter`,
          format: [`PascalCase`],
          leadingUnderscore: `allow`,
        },
      ],
      'import/no-cycle': `error`,
    },
  },
  // The oracle rules come from @tanstack/eslint-plugin-oracles; the settings
  // give it TanStack DB's environment prefix and framework modules.
  { settings: oracleLintSettings },
  oraclePlugin.configs.recommended,
  oraclePlugin.configs.production,
  // The reviewed exception list: see scripts/oracle-lint-settings.mjs.
  registrationExceptionConfig,
  // Receiving witnesses for runtimes that are not Vitest on Node (maintainer
  // decision, 2026-11-11). oracleProperty registers through Vitest and its
  // main entry is Node-only, so Playwright specs and the shared suites that
  // the Capacitor and Tauri WebView apps bundle keep their plain tests. Each
  // compares production with the shared check of its Vitest oracle owner.
  // They are not oracle files, so oracle/no-unit-test does not apply; every
  // other oracle rule does.
  {
    name: `db/receiving-witnesses`,
    files: [
      `packages/db-collection-e2e/src/suites/*-witness.suite.ts`,
      `packages/db/e2e/**/*-witness.spec.ts`,
      `packages/browser-db-sqlite-persistence/e2e/*-witness.*.ts`,
    ],
    plugins: { oracle: oraclePlugin },
    linterOptions: { noInlineConfig: true },
    rules: {
      'oracle/no-disabled': `error`,
      'oracle/no-oracle-disable': `error`,
      'oracle/oracle-property-only': `error`,
      'oracle/pure-model': `error`,
      'oracle/replayable-seed': `error`,
    },
  },
]

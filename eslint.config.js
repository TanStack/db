import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  ...tanstackConfig,
  {
    ignores: [
      `**/dist/**`,
      `**/.output/**`,
      `**/.nitro/**`,
      `**/traildepot/**`,
      `examples/angular/**`,
      `packages/db-collection-e2e/vite.config.ts`,
      `packages/capacitor-db-persistence/e2e/app/android/**`,
      `packages/capacitor-db-persistence/e2e/app/ios/**`,
      // Expo expects Metro config in CommonJS format.
      `packages/expo-db-persistence/e2e/expo-runtime-app/metro.config.js`,
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
]

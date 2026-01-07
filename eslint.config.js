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

import js from '@eslint/js'
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import globals from 'globals'
import tanstackArchitecturePlugin from './eslint-rules/index.js'

export default [
  {
    ignores: ['dist', 'node_modules'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'tanstack-architecture': tanstackArchitecturePlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['src/features/**/*.{ts,tsx}'],
    rules: {
      // Features can read from collections, but write operations must go through actions.
      'tanstack-architecture/no-direct-collection-mutations': [
        'error',
        {
          collectionImportPatterns: ['^@/db/collections/'],
          mutationMethods: ['insert', 'update', 'delete', 'upsert'],
        },
      ],
      // Alternative (stricter) approach: ban collection imports in features entirely.
      // This forces all reads/writes through query hooks and action modules.
      // 'no-restricted-imports': [
      //   'error',
      //   {
      //     patterns: [
      //       {
      //         group: ['@/db/collections/*'],
      //         message:
      //           'Feature modules cannot import collections directly. Use query hooks and action modules.',
      //       },
      //     ],
      //   },
      // ],
    },
  },
]

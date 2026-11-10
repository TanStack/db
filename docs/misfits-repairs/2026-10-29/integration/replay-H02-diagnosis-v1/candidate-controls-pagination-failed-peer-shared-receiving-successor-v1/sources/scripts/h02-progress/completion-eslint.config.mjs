import { fileURLToPath } from 'node:url'
import base from './eslint.config.mjs'

// Keep every repository rule. Restrict both TypeScript program construction
// and resolver discovery to this prepared source packet, rather than the whole
// package test tree. This changes no test or receiving execution allowance.
const project = fileURLToPath(
  new URL('./completion-tsconfig.json', import.meta.url),
)
export default [
  ...base,
  {
    files: ['**/*.ts'],
    languageOptions: { parserOptions: { project } },
    settings: { 'import-x/resolver': { typescript: { project } } },
  },
]

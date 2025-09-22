// Singleton detection to prevent multiple instances of @tanstack/db
// This helps catch issues where multiple versions are installed
// import { MultipleInstancesError } from "./errors"

const TANSTACK_DB_SINGLETON_KEY = Symbol.for('@tanstack/db_singleton_v1')
const globalScope = (
  typeof globalThis !== 'undefined' ? globalThis :
  typeof window !== 'undefined' ? window :
  typeof global !== 'undefined' ? global :
  // eslint-disable-next-line @typescript-eslint/prefer-as-const
  {} as any
) as any

// Get package info for better debugging
const currentInstance = {
  version: 'workspace',
  loadedAt: new Date().toISOString(),
  source: typeof __filename !== 'undefined' ? __filename : 'index.ts'
}

// Check if another instance is already loaded
if (globalScope[TANSTACK_DB_SINGLETON_KEY]) {
  const existingInstance = globalScope[TANSTACK_DB_SINGLETON_KEY]
  console.error(
    `Multiple instances of @tanstack/db detected!`,
    `\nThis usually happens when different packages depend on different versions of @tanstack/db.`,
    `\nExisting instance:`, existingInstance,
    `\nCurrent instance:`, currentInstance,
    `\n\nTo fix this issue:`,
    `\n1. Ensure all packages use the same version of @tanstack/db`,
    `\n2. In workspaces, use pnpm overrides to force a single version:`,
    `\n   "pnpm": { "overrides": { "@tanstack/db": "workspace:*" } }`,
    `\n3. Clear node_modules and reinstall dependencies`
  )
  // Temporarily disable error to test global registry solution
  // throw new MultipleInstancesError(existingInstance, currentInstance)
}

// Mark this instance as loaded
globalScope[TANSTACK_DB_SINGLETON_KEY] = currentInstance

// Re-export all public APIs
export * from "./collection"
export * from "./SortedMap"
export * from "./transactions"
export * from "./types"
export * from "./proxy"
export * from "./query/index.js"
export * from "./optimistic-action"
export * from "./local-only"
export * from "./local-storage"
export * from "./errors"

// Index system exports
export * from "./indexes/base-index.js"
export * from "./indexes/btree-index.js"
export * from "./indexes/lazy-index.js"
export { type IndexOptions } from "./indexes/index-options.js"

// Re-export some stuff explicitly to ensure the type & value is exported
export type { Collection } from "./collection"

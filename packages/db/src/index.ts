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

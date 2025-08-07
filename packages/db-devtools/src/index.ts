// Core exports
export * from "./types"
export * from "./constants"
export * from "./devtools"
export * from "./registry"

// Components
export { Explorer } from "./components/Explorer"

// Main Devtools Class (follows TanStack pattern)
export { TanstackDbDevtools } from "./TanstackDbDevtools"
export type { TanstackDbDevtoolsConfig } from "./TanstackDbDevtools"
export type { DbDevtoolsConfig } from "./types"
export { onDevtoolsEvent } from "../../db/src/devtools-events"

// Export the initialization function
export { initializeDbDevtools } from "./devtools"

// Core exports
export * from "./types"
export * from "./constants"
export * from "./devtools"
export * from "./registry"
export * from "./BaseTanStackDbDevtoolsPanel"

// Components
export { Explorer } from "./components/Explorer"

// Main Devtools Class (follows TanStack pattern)
export { TanstackDbDevtools } from "./TanstackDbDevtools"
export type { TanstackDbDevtoolsConfig } from "./TanstackDbDevtools"

// Export the initialization function
export { initializeDbDevtools } from "./devtools"

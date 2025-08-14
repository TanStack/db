import type { CollectionImpl } from "../../db/src/collection"
import type { DevtoolsStore } from "./types"

// Global type definitions for devtools
declare global {
  interface Window {
    __TANSTACK_DB_DEVTOOLS__?: {
      // Minimal surface area exposed globally
      registerCollection: (
        collection: CollectionImpl<any, any, any>
      ) => (() => void) | undefined
      unregisterCollection: (id: string) => void
      // Core package may call this while devtools are initializing
      store: DevtoolsStore
    }
  }
}

// Export the type for use in other files
export type TanStackDbDevtools = NonNullable<Window['__TANSTACK_DB_DEVTOOLS__']>

// Helper function for accessing devtools with proper typing
export function getDevtools(): TanStackDbDevtools | undefined {
  if (typeof window === `undefined`) return undefined
  return window.__TANSTACK_DB_DEVTOOLS__
}

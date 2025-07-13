import { initializeDevtoolsRegistry } from "./registry"
import type { CollectionImpl } from "../../db/src/collection"
import type { DbDevtoolsRegistry } from "./types"

/**
 * Initialize the DB devtools registry.
 * This should be called once in your application, typically in your main entry point.
 * Collections will automatically register themselves if this registry is present.
 */
export function initializeDbDevtools(): void {
  initializeDevtoolsRegistry()
}

/**
 * Manually register a collection with the devtools.
 * This is automatically called by collections when they are created if devtools are enabled.
 */
export function registerCollection(
  collection: CollectionImpl<any, any, any>
): void {
  if (typeof window === 'undefined') return
  
  const registry = (window as any).__TANSTACK_DB_DEVTOOLS__ as DbDevtoolsRegistry | undefined
  if (registry) {
    registry.registerCollection(collection)
  }
}

/**
 * Manually unregister a collection from the devtools.
 * This is automatically called when collections are garbage collected.
 */
export function unregisterCollection(id: string): void {
  if (typeof window === 'undefined') return
  
  const registry = (window as any).__TANSTACK_DB_DEVTOOLS__ as DbDevtoolsRegistry | undefined
  if (registry) {
    registry.unregisterCollection(id)
  }
}

/**
 * Check if devtools are currently enabled (registry is present).
 */
export function isDevtoolsEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return !!(window as any).__TANSTACK_DB_DEVTOOLS__
}

/**
 * Get the current devtools registry instance.
 */
export function getDevtoolsRegistry(): DbDevtoolsRegistry | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as any).__TANSTACK_DB_DEVTOOLS__ as DbDevtoolsRegistry | undefined
}

/**
 * Clean up the devtools registry and all references.
 * This is useful for testing or when you want to completely reset the devtools state.
 */
export function cleanupDevtools(): void {
  if (typeof window === 'undefined') return
  
  const registry = (window as any).__TANSTACK_DB_DEVTOOLS__ as DbDevtoolsRegistry | undefined
  if (registry) {
    registry.cleanup()
    delete (window as any).__TANSTACK_DB_DEVTOOLS__
  }
}

import type { CollectionImpl } from '@tanstack/db'
import { initializeDevtoolsRegistry } from './registry'

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
export function registerCollection(collection: CollectionImpl<any, any, any>): void {
  const registry = window.__TANSTACK_DB_DEVTOOLS__
  if (registry) {
    registry.registerCollection(collection)
  }
}

/**
 * Manually unregister a collection from the devtools.
 * This is automatically called when collections are garbage collected.
 */
export function unregisterCollection(id: string): void {
  const registry = window.__TANSTACK_DB_DEVTOOLS__
  if (registry) {
    registry.unregisterCollection(id)
  }
}

/**
 * Check if devtools are currently enabled (registry is present).
 */
export function isDevtoolsEnabled(): boolean {
  return !!window.__TANSTACK_DB_DEVTOOLS__
}

/**
 * Get the current devtools registry instance.
 */
export function getDevtoolsRegistry() {
  return window.__TANSTACK_DB_DEVTOOLS__
}

/**
 * Clean up the devtools registry and all references.
 * This is useful for testing or when you want to completely reset the devtools state.
 */
export function cleanupDevtools(): void {
  const registry = window.__TANSTACK_DB_DEVTOOLS__
  if (registry) {
    registry.cleanup()
    delete window.__TANSTACK_DB_DEVTOOLS__
  }
}
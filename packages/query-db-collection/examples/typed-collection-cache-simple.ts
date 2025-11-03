/**
 * Simple Example: Typed Collection Cache with ReturnType
 *
 * This shows the essential pattern for getting properly typed collections in a cache.
 */

import { createCollection } from "@tanstack/db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"

// ============================================================================
// The Pattern
// ============================================================================

// Step 1: Create a factory function that returns your collection
const createUserTodoCollection = (userId: string) => {
  const options = queryCollectionOptions({
    // ... your configuration here
  })

  return createCollection(options)
}

// Step 2: Extract the type using ReturnType
type UserTodoCollection = ReturnType<typeof createUserTodoCollection>

// Step 3: Use the type in your cache
const cache = new Map<string, UserTodoCollection>()

// Step 4: Create a getter function
export const getUserTodoCollection = (userId: string): UserTodoCollection => {
  if (!cache.has(userId)) {
    const collection = createUserTodoCollection(userId)

    // Optional: Auto-cleanup when collection is disposed
    collection.on("status:change", ({ status }) => {
      if (status === "cleaned-up") {
        cache.delete(userId)
      }
    })

    cache.set(userId, collection)
  }

  return cache.get(userId)!
}

// ============================================================================
// Usage
// ============================================================================

const collection = getUserTodoCollection("user-123")

// Now everything is fully typed!
const todos = collection.toArray
collection.utils.writeInsert({
  /* typed object */
})

/**
 * Example: Creating a Typed Collection Cache with ReturnType
 *
 * This example demonstrates how to create a properly typed cache of collections
 * using ReturnType to extract the collection type from a factory function.
 *
 * Key concepts:
 * 1. Schema-based type inference for automatic typing
 * 2. Using ReturnType with factory functions for type extraction
 * 3. Managing a cache of dynamically created collections
 * 4. Automatic cleanup when collections are no longer needed
 */

import { createCollection } from "@tanstack/db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { QueryClient } from "@tanstack/query-core"
import { z } from "zod"

// ============================================================================
// Step 1: Define your schema
// ============================================================================

const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  completed: z.boolean(),
  userId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

// The inferred TypeScript type from the schema
type Todo = z.infer<typeof todoSchema>

// ============================================================================
// Step 2: Create a QueryClient instance
// ============================================================================

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      retry: 3,
    },
  },
})

// ============================================================================
// Step 3: Create a factory function for your collections
// ============================================================================

/**
 * Factory function that creates a todo collection for a specific user.
 * The return type of this function will be used to type the cache.
 *
 * @param userId - The ID of the user whose todos to fetch
 * @returns A fully typed Collection instance
 */
const createUserTodoCollection = (userId: string) => {
  return createCollection(
    queryCollectionOptions({
      // Unique ID for this collection instance
      id: `todos-${userId}`,

      // Query key for TanStack Query
      queryKey: ["todos", userId] as const,

      // Fetch function - returns array of todos
      queryFn: async () => {
        const response = await fetch(`/api/users/${userId}/todos`)
        if (!response.ok) {
          throw new Error(`Failed to fetch todos for user ${userId}`)
        }
        const data = await response.json()

        // Transform dates from ISO strings to Date objects
        return data.map((todo: any) => ({
          ...todo,
          createdAt: new Date(todo.createdAt),
          updatedAt: new Date(todo.updatedAt),
        }))
      },

      // Schema for automatic type inference and validation
      schema: todoSchema,

      // Function to extract unique key from each item
      getKey: (item) => item.id,

      // TanStack Query client
      queryClient,

      // Query options
      refetchInterval: 30000, // Refetch every 30 seconds
      enabled: true,

      // ======================================================================
      // Persistence handlers - sync local changes to the server
      // ======================================================================

      onInsert: async ({ transaction }) => {
        // Send insert to server
        const todo = transaction.mutations[0].modified
        const { id, ...todoData } = todo // Exclude id from payload

        await fetch(`/api/users/${userId}/todos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(todoData),
        })
      },

      onUpdate: async ({ transaction }) => {
        // Send updates to server
        await Promise.all(
          transaction.mutations.map(async ({ changes, original }) => {
            await fetch(`/api/users/${userId}/todos/${original.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(changes),
            })
          })
        )
      },

      onDelete: async ({ transaction }) => {
        // Send deletes to server
        await Promise.all(
          transaction.mutations.map(async ({ original }) => {
            await fetch(`/api/users/${userId}/todos/${original.id}`, {
              method: "DELETE",
            })
          })
        )
      },
    })
  )
}

// ============================================================================
// Step 4: Extract the type using ReturnType
// ============================================================================

/**
 * This is the key pattern!
 * ReturnType extracts the actual Collection type with all generic parameters
 * properly inferred from the factory function.
 */
type UserTodoCollection = ReturnType<typeof createUserTodoCollection>

// ============================================================================
// Step 5: Create a typed cache
// ============================================================================

/**
 * Cache to store collections per user ID.
 * Each collection is automatically typed thanks to ReturnType.
 */
const collectionCache = new Map<string, UserTodoCollection>()

/**
 * Get or create a todo collection for a specific user.
 * Returns a fully typed Collection instance.
 *
 * @param userId - The ID of the user
 * @returns A typed Collection instance
 */
export const getUserTodoCollection = (userId: string): UserTodoCollection => {
  // Check if collection already exists in cache
  if (!collectionCache.has(userId)) {
    // Create new collection
    const collection = createUserTodoCollection(userId)

    // Set up automatic cleanup when collection is cleaned up
    collection.on("status:change", ({ status }) => {
      if (status === "cleaned-up") {
        collectionCache.delete(userId)
        console.log(`Removed collection for user ${userId} from cache`)
      }
    })

    // Add to cache
    collectionCache.set(userId, collection)
    console.log(`Created new collection for user ${userId}`)
  }

  // TypeScript knows this is UserTodoCollection, not undefined
  return collectionCache.get(userId)!
}

// ============================================================================
// Step 6: Usage examples
// ============================================================================

// Example 1: Basic usage with type inference
export function example1() {
  const userId = "user-123"
  const collection = getUserTodoCollection(userId)

  // TypeScript knows the exact type of items in the collection
  const todos = collection.toArray
  // todos is typed as: Todo[]

  // Access properties with full type safety
  todos.forEach((todo) => {
    console.log(todo.title) // ✅ TypeScript knows this property exists
    console.log(todo.completed) // ✅ TypeScript knows this is a boolean
    // console.log(todo.nonExistent) // ❌ TypeScript error!
  })
}

// Example 2: Using utils for manual operations
export function example2() {
  const collection = getUserTodoCollection("user-456")

  // Access typed utility methods
  collection.utils.writeInsert({
    id: "todo-1",
    title: "Buy groceries",
    completed: false,
    userId: "user-456",
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  // Update a todo
  collection.utils.writeUpdate({
    id: "todo-1",
    completed: true,
  })

  // Delete a todo
  collection.utils.writeDelete("todo-1")

  // Batch operations
  collection.utils.writeBatch(() => {
    collection.utils.writeInsert({
      id: "todo-2",
      title: "Walk the dog",
      completed: false,
      userId: "user-456",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    collection.utils.writeUpdate({
      id: "todo-2",
      completed: true,
    })
  })
}

// Example 3: Refetching and error handling
export async function example3() {
  const collection = getUserTodoCollection("user-789")

  // Check for errors
  if (collection.utils.isError()) {
    const error = collection.utils.lastError()
    const errorCount = collection.utils.errorCount()
    console.error(`Collection has ${errorCount} errors:`, error)

    // Try to recover
    try {
      await collection.utils.clearError()
      console.log("Successfully recovered from error")
    } catch (err) {
      console.error("Failed to recover:", err)
    }
  }

  // Manual refetch
  const result = await collection.utils.refetch()
  if (result && result.isSuccess) {
    console.log("Refetch successful")
  }
}

// Example 4: Reactive subscriptions
export function example4() {
  const collection = getUserTodoCollection("user-999")

  // Subscribe to all todos
  const unsubscribe = collection.subscribe(() => {
    const todos = collection.toArray
    console.log(`Total todos: ${todos.length}`)

    // TypeScript knows the exact shape of each todo
    const completedCount = todos.filter((t) => t.completed).length
    console.log(`Completed: ${completedCount}`)
  })

  // Later: cleanup
  return () => {
    unsubscribe()
  }
}

// Example 5: With select option for wrapped API responses
const createUserTodoCollectionWithSelect = (userId: string) => {
  type ApiResponse = {
    metadata: {
      total: number
      page: number
    }
    items: Todo[]
  }

  return createCollection(
    queryCollectionOptions({
      id: `todos-${userId}`,
      queryKey: ["todos", userId] as const,

      // queryFn returns wrapped response
      queryFn: async (): Promise<ApiResponse> => {
        const response = await fetch(`/api/users/${userId}/todos`)
        return response.json()
      },

      // select extracts the array from the wrapped response
      select: (data) => data.items,

      schema: todoSchema,
      getKey: (item) => item.id,
      queryClient,
    })
  )
}

// Extract type for the select variant
type UserTodoCollectionWithSelect = ReturnType<
  typeof createUserTodoCollectionWithSelect
>

// ============================================================================
// Advanced: Multiple collection types in one cache
// ============================================================================

// Define different collection types
type CollectionType = "todos" | "notes" | "tasks"

// Create a generic cache that can hold different collection types
const multiCache = new Map<string, UserTodoCollection>()

/**
 * Get a collection with a compound key
 */
export const getCollection = (
  type: CollectionType,
  userId: string
): UserTodoCollection => {
  const cacheKey = `${type}-${userId}`

  if (!multiCache.has(cacheKey)) {
    const collection = createUserTodoCollection(userId)

    collection.on("status:change", ({ status }) => {
      if (status === "cleaned-up") {
        multiCache.delete(cacheKey)
      }
    })

    multiCache.set(cacheKey, collection)
  }

  return multiCache.get(cacheKey)!
}

// ============================================================================
// Summary
// ============================================================================

/**
 * Key takeaways:
 *
 * 1. Define a factory function that creates your collection
 * 2. Use ReturnType to extract the collection type from the factory
 * 3. Use that type for your cache (Map, object, etc.)
 * 4. Optionally set up cleanup listeners to remove from cache
 *
 * This pattern gives you:
 * - Full type inference from schema or queryFn
 * - Type-safe cache operations
 * - Automatic cleanup
 * - No need to manually specify generic parameters
 */

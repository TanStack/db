import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import {
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing"
import { createCollection } from "@tanstack/db"
import { firebaseCollectionOptions } from "../src/firestore"
import type { Firestore } from "firebase/firestore"

interface TestTodo {
  id: string
  text: string
  completed: boolean
  createdAt?: Date
  updatedAt?: Date
}

describe("Firebase Collection Integration", () => {
  let testEnv: RulesTestEnvironment
  let firestore: Firestore
  const projectId = "test-project"

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId,
      firestore: {
        host: "localhost",
        port: 8080,
      },
    })
    firestore = testEnv
      .unauthenticatedContext()
      .firestore() as unknown as Firestore
  })

  afterAll(async () => {
    await testEnv.cleanup()
  })

  beforeEach(async () => {
    await testEnv.clearFirestore()
  })

  describe("Basic Operations", () => {
    it("should create a collection and sync initial data", async () => {
      const collection = createCollection(
        firebaseCollectionOptions<TestTodo>({
          id: "todos",
          firestore,
          collectionName: "todos",
          getKey: (item) => item.id,
        })
      )

      // Wait for initial sync
      await collection.preload()

      // Collection should be empty initially
      expect(collection.getAll()).toEqual([])
    })

    it("should insert items and sync them", async () => {
      const collection = createCollection(
        firebaseCollectionOptions<TestTodo>({
          id: "todos",
          firestore,
          collectionName: "todos",
          getKey: (item) => item.id,
        })
      )

      await collection.preload()

      // Insert an item
      const todo: TestTodo = {
        id: "1",
        text: "Test todo",
        completed: false,
      }

      await collection.insert(todo)

      // Item should be in the collection
      const items = collection.getAll()
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({
        id: "1",
        text: "Test todo",
        completed: false,
      })
    })

    it("should update items", async () => {
      const collection = createCollection(
        firebaseCollectionOptions<TestTodo>({
          id: "todos",
          firestore,
          collectionName: "todos",
          getKey: (item) => item.id,
        })
      )

      await collection.preload()

      // Insert an item
      const todo: TestTodo = {
        id: "1",
        text: "Test todo",
        completed: false,
      }
      await collection.insert(todo)

      // Update the item
      await collection.update("1", { completed: true })

      // Check the update
      const updated = collection.getById("1")
      expect(updated?.completed).toBe(true)
    })

    it("should delete items", async () => {
      const collection = createCollection(
        firebaseCollectionOptions<TestTodo>({
          id: "todos",
          firestore,
          collectionName: "todos",
          getKey: (item) => item.id,
        })
      )

      await collection.preload()

      // Insert an item
      const todo: TestTodo = {
        id: "1",
        text: "Test todo",
        completed: false,
      }
      await collection.insert(todo)

      // Delete the item
      await collection.delete("1")

      // Item should be gone
      expect(collection.getAll()).toEqual([])
    })
  })

  describe("Real-time Sync", () => {
    it("should sync changes between collections", async () => {
      // Create two collections pointing to the same Firestore collection
      const collection1 = createCollection(
        firebaseCollectionOptions<TestTodo>({
          id: "todos-1",
          firestore,
          collectionName: "todos",
          getKey: (item) => item.id,
        })
      )

      const collection2 = createCollection(
        firebaseCollectionOptions<TestTodo>({
          id: "todos-2",
          firestore,
          collectionName: "todos",
          getKey: (item) => item.id,
        })
      )

      await Promise.all([collection1.preload(), collection2.preload()])

      // Insert in collection1
      const todo: TestTodo = {
        id: "1",
        text: "Synced todo",
        completed: false,
      }
      await collection1.insert(todo)

      // Wait for sync
      await collection1.utils.waitForSync?.()

      // Should appear in collection2
      const items = collection2.getAll()
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({
        id: "1",
        text: "Synced todo",
        completed: false,
      })
    })
  })

  describe("Batch Operations", () => {
    it("should handle batch inserts within limit", async () => {
      const collection = createCollection(
        firebaseCollectionOptions<TestTodo>({
          id: "todos",
          firestore,
          collectionName: "todos",
          getKey: (item) => item.id,
        })
      )

      await collection.preload()

      // Create 100 todos
      const todos: TestTodo[] = Array.from({ length: 100 }, (_, i) => ({
        id: `todo-${i}`,
        text: `Todo ${i}`,
        completed: false,
      }))

      // Insert all at once
      await collection.transaction.run(async (tx) => {
        todos.forEach((todo) => tx.insert(todo))
      })

      // All should be inserted
      expect(collection.getAll()).toHaveLength(100)
    })

    it("should handle batch operations exceeding Firestore limit", async () => {
      const collection = createCollection(
        firebaseCollectionOptions<TestTodo>({
          id: "todos",
          firestore,
          collectionName: "todos",
          getKey: (item) => item.id,
        })
      )

      await collection.preload()

      // Create 600 todos (exceeds Firestore's 500 batch limit)
      const todos: TestTodo[] = Array.from({ length: 600 }, (_, i) => ({
        id: `todo-${i}`,
        text: `Todo ${i}`,
        completed: false,
      }))

      // Insert all at once - should be split into multiple batches
      await collection.transaction.run(async (tx) => {
        todos.forEach((todo) => tx.insert(todo))
      })

      // All should be inserted
      expect(collection.getAll()).toHaveLength(600)
    })
  })

  describe("Type Conversions", () => {
    it("should handle date conversions", async () => {
      const collection = createCollection(
        firebaseCollectionOptions<TestTodo>({
          id: "todos",
          firestore,
          collectionName: "todos",
          getKey: (item) => item.id,
          parse: {
            createdAt: (timestamp: any) => timestamp?.toDate?.() || timestamp,
            updatedAt: (timestamp: any) => timestamp?.toDate?.() || timestamp,
          },
        })
      )

      await collection.preload()

      const todo: TestTodo = {
        id: "1",
        text: "Test todo",
        completed: false,
        createdAt: new Date(),
      }

      await collection.insert(todo)

      const retrieved = collection.getById("1")
      expect(retrieved?.createdAt).toBeInstanceOf(Date)
    })
  })

  describe("Error Handling", () => {
    it("should handle permission errors gracefully", async () => {
      // This would require setting up security rules
      // For now, we'll test basic error handling
      const collection = createCollection(
        firebaseCollectionOptions<TestTodo>({
          id: "todos",
          firestore,
          collectionName: "todos",
          getKey: (item) => item.id,
        })
      )

      await collection.preload()

      // Try to update non-existent item
      await expect(
        collection.update("non-existent", { completed: true })
      ).rejects.toThrow()
    })
  })

  describe("Cleanup", () => {
    it("should properly clean up listeners", async () => {
      const collection = createCollection(
        firebaseCollectionOptions<TestTodo>({
          id: "todos",
          firestore,
          collectionName: "todos",
          getKey: (item) => item.id,
        })
      )

      await collection.preload()

      // Clean up
      collection.utils.cancel()

      // Collection should still work for local operations
      const todo: TestTodo = {
        id: "1",
        text: "Test todo",
        completed: false,
      }

      // This should work (optimistic update)
      collection.transaction.run((tx) => {
        tx.insert(todo)
      })

      expect(collection.getAll()).toHaveLength(1)
    })
  })
})

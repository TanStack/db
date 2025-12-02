import { type } from "arktype"
import { describe, expect, expectTypeOf, it } from "vitest"
import { z } from "zod"
import { createCollection } from "../src/collection/index.js"
import { SchemaValidationError } from "../src/errors"
import { createTransaction } from "../src/transactions"
import type {
  OperationType,
  PendingMutation,
  ResolveTransactionChanges,
} from "../src/types"

describe(`Collection Schema Validation`, () => {
  it(`should apply transformations for both insert and update operations`, () => {
    // Create a schema with transformations
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
      created_at: z.string().transform((val) => new Date(val)),
      updated_at: z.string().transform((val) => new Date(val)),
    })

    const collection = createCollection({
      getKey: (item) => item.id,
      mutations: true,
      schema: userSchema,
      sync: { sync: () => {} },
    })

    // Test insert validation
    const insertData = {
      id: `1`,
      name: `John Doe`,
      email: `john@example.com`,
      created_at: `2023-01-01T00:00:00.000Z`,
      updated_at: `2023-01-01T00:00:00.000Z`,
    }

    const validatedInsert = collection.validateData(insertData, `insert`)

    // Verify that the inserted data has been transformed
    expect(validatedInsert.created_at).toBeInstanceOf(Date)
    expect(validatedInsert.updated_at).toBeInstanceOf(Date)
    expect(validatedInsert.name).toBe(`John Doe`)
    expect(validatedInsert.email).toBe(`john@example.com`)

    // Test update validation - use a schema that accepts both string and Date for existing data
    const updateSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
      created_at: z
        .union([z.string(), z.date()])
        .transform((val) => (typeof val === `string` ? new Date(val) : val)),
      updated_at: z
        .union([z.string(), z.date()])
        .transform((val) => (typeof val === `string` ? new Date(val) : val)),
    })

    const updateCollection = createCollection({
      getKey: (item) => item.id,
      mutations: true,
      schema: updateSchema,
      sync: { sync: () => {} },
    })

    // Add the validated insert data to the update collection
    updateCollection._state.syncedData.set(`1`, validatedInsert)

    const updateData = {
      name: `Jane Doe`,
      email: `jane@example.com`,
      updated_at: `2023-01-02T00:00:00.000Z`,
    }

    const validatedUpdate = updateCollection.validateData(
      updateData,
      `update`,
      `1`
    )

    // Verify that the updated data has been transformed
    expect(validatedUpdate.updated_at).toBeInstanceOf(Date)
    expect(validatedUpdate.name).toBe(`Jane Doe`)
    expect(validatedUpdate.email).toBe(`jane@example.com`)
  })

  it(`should extract only modified keys from validated update result`, () => {
    // Create a schema with transformations that can handle both string and Date inputs
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
      created_at: z
        .union([z.string(), z.date()])
        .transform((val) => (typeof val === `string` ? new Date(val) : val)),
      updated_at: z
        .union([z.string(), z.date()])
        .transform((val) => (typeof val === `string` ? new Date(val) : val)),
    })

    const collection = createCollection({
      getKey: (item) => item.id,
      mutations: true,
      schema: userSchema,
      sync: { sync: () => {} },
    })

    // First, we need to add an item to the collection for update validation
    const insertData = {
      id: `1`,
      name: `John Doe`,
      email: `john@example.com`,
      created_at: `2023-01-01T00:00:00.000Z`,
      updated_at: `2023-01-01T00:00:00.000Z`,
    }

    const validatedInsert = collection.validateData(insertData, `insert`)

    // Manually add the item to the collection's synced data for testing
    collection._state.syncedData.set(`1`, validatedInsert)

    // Test update validation with only modified fields
    const updateData = {
      name: `Jane Doe`,
      updated_at: `2023-01-02T00:00:00.000Z`,
    }

    const validatedUpdate = collection.validateData(updateData, `update`, `1`)

    // Verify that only the modified fields are returned
    expect(validatedUpdate).toHaveProperty(`name`)
    expect(validatedUpdate).toHaveProperty(`updated_at`)
    expect(validatedUpdate).not.toHaveProperty(`id`)
    expect(validatedUpdate).not.toHaveProperty(`email`)
    expect(validatedUpdate).not.toHaveProperty(`created_at`)

    // Verify the changes contain the transformed values
    expect(validatedUpdate.name).toBe(`Jane Doe`)
    expect(validatedUpdate.updated_at).toBeInstanceOf(Date)
  })

  it(`should handle schemas with default values correctly`, () => {
    // Create a schema with default values that can handle both existing Date objects and new string inputs
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
      created_at: z
        .union([z.date(), z.string()])
        .transform((val) => (typeof val === `string` ? new Date(val) : val))
        .default(() => new Date()),
      updated_at: z
        .union([z.date(), z.string()])
        .transform((val) => (typeof val === `string` ? new Date(val) : val))
        .default(() => new Date()),
    })

    const collection = createCollection({
      getKey: (item) => item.id,
      mutations: true,
      schema: userSchema,
      sync: { sync: () => {} },
    })

    // Test insert validation without providing defaulted fields
    const insertData = {
      id: `1`,
      name: `John Doe`,
      email: `john@example.com`,
    }

    const validatedInsert = collection.validateData(insertData, `insert`)

    // Verify that default values are applied
    expect(validatedInsert.created_at).toBeInstanceOf(Date)
    expect(validatedInsert.updated_at).toBeInstanceOf(Date)
    expect(validatedInsert.name).toBe(`John Doe`)
    expect(validatedInsert.email).toBe(`john@example.com`)

    // Manually add the item to the collection's synced data for testing
    collection._state.syncedData.set(`1`, validatedInsert)

    // Test update validation without providing defaulted fields
    const updateData = {
      name: `Jane Doe`,
    }

    const validatedUpdate = collection.validateData(updateData, `update`, `1`)

    // Verify that only the modified field is returned
    expect(validatedUpdate).toHaveProperty(`name`)
    expect(validatedUpdate).not.toHaveProperty(`updated_at`)
    expect(validatedUpdate.name).toBe(`Jane Doe`)

    // Test update validation with explicit updated_at field
    const updateDataWithTimestamp = {
      name: `Jane Smith`,
      updated_at: `2023-01-02T00:00:00.000Z`,
    }

    const validatedUpdateWithTimestamp = collection.validateData(
      updateDataWithTimestamp,
      `update`,
      `1`
    )

    // Verify that both modified fields are returned with transformations applied
    expect(validatedUpdateWithTimestamp).toHaveProperty(`name`)
    expect(validatedUpdateWithTimestamp).toHaveProperty(`updated_at`)
    expect(validatedUpdateWithTimestamp.name).toBe(`Jane Smith`)
    expect(validatedUpdateWithTimestamp.updated_at).toBeInstanceOf(Date)
  })

  it(`should validate schema input types for both insert and update`, () => {
    // Create a schema with different input and output types that can handle both string and Date inputs
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
      age: z.number().int().positive(),
      created_at: z
        .union([z.string(), z.date()])
        .transform((val) => (typeof val === `string` ? new Date(val) : val)),
      updated_at: z
        .union([z.string(), z.date()])
        .transform((val) => (typeof val === `string` ? new Date(val) : val)),
    })

    const collection = createCollection({
      getKey: (item) => item.id,
      mutations: true,
      schema: userSchema,
      sync: { sync: () => {} },
    })

    // Test that insert validation accepts input type (with string dates)
    const insertData = {
      id: `1`,
      name: `John Doe`,
      email: `john@example.com`,
      age: 30,
      created_at: `2023-01-01T00:00:00.000Z`,
      updated_at: `2023-01-01T00:00:00.000Z`,
    }

    const validatedInsert = collection.validateData(insertData, `insert`)

    // Verify that the output type has Date objects
    expect(validatedInsert.created_at).toBeInstanceOf(Date)
    expect(validatedInsert.updated_at).toBeInstanceOf(Date)
    expect(typeof validatedInsert.age).toBe(`number`)

    // Add to collection for update testing
    collection._state.syncedData.set(`1`, validatedInsert)

    // Test that update validation accepts input type for new fields
    const updateData = {
      name: `Jane Doe`,
      age: 31,
      updated_at: `2023-01-02T00:00:00.000Z`,
    }

    const validatedUpdate = collection.validateData(updateData, `update`, `1`)

    // Verify that the output type has Date objects and only modified fields
    expect(validatedUpdate).toHaveProperty(`name`)
    expect(validatedUpdate).toHaveProperty(`age`)
    expect(validatedUpdate).toHaveProperty(`updated_at`)
    expect(validatedUpdate.updated_at).toBeInstanceOf(Date)
    expect(typeof validatedUpdate.age).toBe(`number`)
    expect(validatedUpdate.name).toBe(`Jane Doe`)
    expect(validatedUpdate.age).toBe(31)
  })
})

describe(`Collection with schema validation`, () => {
  it(`should validate data against arktype schema on insert`, () => {
    // Create a Zod schema for a user
    const userSchema = type({
      name: `string > 0`,
      age: `number.integer > 0`,
      "email?": `string.email`,
    })

    // Create a collection with the schema
    const collection = createCollection({
      id: `test`,
      getKey: (item) => item.name,
      mutations: true,
      startSync: true,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: userSchema,
    })
    const mutationFn = async () => {}

    // Valid data should work
    const validUser = {
      name: `Alice`,
      age: 30,
      email: `alice@example.com`,
    }

    const tx1 = createTransaction({ mutationFn })
    tx1.mutate(() => collection.insert(validUser))

    // Invalid data should throw SchemaValidationError
    const invalidUser = {
      name: ``, // Empty name (fails min length)
      age: -5, // Negative age (fails positive)
      email: `not-an-email`, // Invalid email
    }

    try {
      const tx2 = createTransaction({ mutationFn })
      tx2.mutate(() => collection.insert(invalidUser))
      // Should not reach here
      expect(true).toBe(false)
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError)
      if (error instanceof SchemaValidationError) {
        expect(error.type).toBe(`insert`)
        expect(error.issues.length).toBeGreaterThan(0)
        // Check that we have validation errors for each invalid field
        expect(error.issues.some((issue) => issue.path?.includes(`name`))).toBe(
          true
        )
        expect(error.issues.some((issue) => issue.path?.includes(`age`))).toBe(
          true
        )
        expect(
          error.issues.some((issue) => issue.path?.includes(`email`))
        ).toBe(true)
      }
    }

    // Partial updates should work with valid data
    const tx3 = createTransaction({ mutationFn })
    tx3.mutate(() =>
      collection.update(`Alice`, (draft) => {
        draft.age = 31
      })
    )

    // Partial updates should fail with invalid data
    try {
      const tx4 = createTransaction({ mutationFn })
      tx4.mutate(() =>
        collection.update(`Alice`, (draft) => {
          draft.age = -1
        })
      )
      // Should not reach here
      expect(true).toBe(false)
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError)
      if (error instanceof SchemaValidationError) {
        expect(error.type).toBe(`update`)
        expect(error.issues.length).toBeGreaterThan(0)
        expect(error.issues.some((issue) => issue.path?.includes(`age`))).toBe(
          true
        )
      }
    }
  })

  it(`should validate data against schema on insert`, () => {
    // Create a Zod schema for a user
    const userSchema = z.object({
      name: z.string().min(1),
      age: z.number().int().positive(),
      email: z.string().email().optional(),
    })

    // Create a collection with the schema
    const collection = createCollection({
      id: `test`,
      getKey: (item) => item.name,
      mutations: true,
      startSync: true,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: userSchema,
    })
    const mutationFn = async () => {}

    // Valid data should work
    const validUser = {
      name: `Alice`,
      age: 30,
      email: `alice@example.com`,
    }

    const tx1 = createTransaction({ mutationFn })
    tx1.mutate(() => collection.insert(validUser))

    // Invalid data should throw SchemaValidationError
    const invalidUser = {
      name: ``, // Empty name (fails min length)
      age: -5, // Negative age (fails positive)
      email: `not-an-email`, // Invalid email
    }

    try {
      const tx2 = createTransaction({ mutationFn })
      tx2.mutate(() => collection.insert(invalidUser))
      // Should not reach here
      expect(true).toBe(false)
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError)
      if (error instanceof SchemaValidationError) {
        expect(error.type).toBe(`insert`)
        expect(error.issues.length).toBeGreaterThan(0)
        // Check that we have validation errors for each invalid field
        expect(error.issues.some((issue) => issue.path?.includes(`name`))).toBe(
          true
        )
        expect(error.issues.some((issue) => issue.path?.includes(`age`))).toBe(
          true
        )
        expect(
          error.issues.some((issue) => issue.path?.includes(`email`))
        ).toBe(true)
      }
    }

    // Partial updates should work with valid data
    const tx3 = createTransaction({ mutationFn })
    tx3.mutate(() =>
      collection.update(`Alice`, (draft) => {
        draft.age = 31
      })
    )

    // Partial updates should fail with invalid data
    try {
      const tx4 = createTransaction({ mutationFn })
      tx4.mutate(() =>
        collection.update(`Alice`, (draft) => {
          draft.age = -1
        })
      )
      // Should not reach here
      expect(true).toBe(false)
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError)
      if (error instanceof SchemaValidationError) {
        expect(error.type).toBe(`update`)
        expect(error.issues.length).toBeGreaterThan(0)
        expect(error.issues.some((issue) => issue.path?.includes(`age`))).toBe(
          true
        )
      }
    }
  })

  it(`should apply schema defaults on insert`, () => {
    const todoSchema = z.object({
      id: z
        .string()
        .default(() => `todo-${Math.random().toString(36).substr(2, 9)}`),
      text: z.string(),
      completed: z.boolean().default(false),
      createdAt: z.coerce.date().default(() => new Date()),
      updatedAt: z.coerce.date().default(() => new Date()),
    })

    // Define inferred types for clarity and use in assertions
    type Todo = z.infer<typeof todoSchema>
    type TodoInput = z.input<typeof todoSchema>

    // NOTE: `createCollection<Todo>` breaks the schema type inference.
    // We have to use only the schema, and not the type generic, like so:
    const collection = createCollection({
      id: `defaults-test`,
      getKey: (item) => item.id,
      mutations: true,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema: todoSchema,
    })

    // Type test: should allow inserting input type (with missing fields that have defaults)
    // Important: Input type is different from the output type (which is inferred using z.infer)
    // For more details, @see https://github.com/colinhacks/zod/issues/4179#issuecomment-2811669261
    type InsertParam = Parameters<typeof collection.insert>[0]
    expectTypeOf<InsertParam>().toEqualTypeOf<TodoInput | Array<TodoInput>>()

    const mutationFn = async () => {}

    // Minimal data
    const tx1 = createTransaction<Todo>({ mutationFn })
    tx1.mutate(() => collection.insert({ text: `task-1` }))

    // Type assertions on the mutation structure
    expect(tx1.mutations).toHaveLength(1)
    const mutation = tx1.mutations[0]!

    // Test the mutation type structure
    expectTypeOf(mutation).toExtend<PendingMutation<Todo>>()
    expectTypeOf(mutation.type).toEqualTypeOf<OperationType>()
    expectTypeOf(mutation.changes).toEqualTypeOf<
      ResolveTransactionChanges<Todo>
    >()
    expectTypeOf(mutation.modified).toEqualTypeOf<Todo>()

    // Runtime assertions for actual values
    expect(mutation.type).toBe(`insert`)
    expect(mutation.changes).toEqual({ text: `task-1` })
    expect(mutation.modified.text).toBe(`task-1`)
    expect(mutation.modified.completed).toBe(false)
    expect(mutation.modified.id).toBeDefined()
    expect(mutation.modified.createdAt).toBeInstanceOf(Date)
    expect(mutation.modified.updatedAt).toBeInstanceOf(Date)

    let insertedItems = Array.from(collection.state.values())
    expect(insertedItems).toHaveLength(1)
    const insertedItem = insertedItems[0]!
    expect(insertedItem.text).toBe(`task-1`)
    expect(insertedItem.completed).toBe(false)
    expect(insertedItem.id).toBeDefined()
    expect(typeof insertedItem.id).toBe(`string`)
    expect(insertedItem.createdAt).toBeInstanceOf(Date)
    expect(insertedItem.updatedAt).toBeInstanceOf(Date)

    // Partial data
    const tx2 = createTransaction<Todo>({ mutationFn })
    tx2.mutate(() => collection.insert({ text: `task-2`, completed: true }))

    insertedItems = Array.from(collection.state.values())
    expect(insertedItems).toHaveLength(2)

    const secondItem = insertedItems.find((item) => item.text === `task-2`)!
    expect(secondItem).toBeDefined()
    expect(secondItem.text).toBe(`task-2`)
    expect(secondItem.completed).toBe(true)
    expect(secondItem.id).toBeDefined()
    expect(typeof secondItem.id).toBe(`string`)
    expect(secondItem.createdAt).toBeInstanceOf(Date)
    expect(secondItem.updatedAt).toBeInstanceOf(Date)

    // All fields provided
    const tx3 = createTransaction<Todo>({ mutationFn })

    tx3.mutate(() =>
      collection.insert({
        id: `task-id-3`,
        text: `task-3`,
        completed: true,
        createdAt: new Date(`2023-01-01T00:00:00Z`),
        updatedAt: new Date(`2023-01-01T00:00:00Z`),
      })
    )
    insertedItems = Array.from(collection.state.values())
    expect(insertedItems).toHaveLength(3)

    // using insertedItems[2] was finding wrong item for some reason.
    const thirdItem = insertedItems.find((item) => item.text === `task-3`)
    expect(thirdItem).toBeDefined()
    expect(thirdItem!.text).toBe(`task-3`)
    expect(thirdItem!.completed).toBe(true)
    expect(thirdItem!.createdAt).toEqual(new Date(`2023-01-01T00:00:00Z`))
    expect(thirdItem!.updatedAt).toEqual(new Date(`2023-01-01T00:00:00Z`))
    expect(thirdItem!.id).toBe(`task-id-3`)
  })

  it(`should apply schema transformations on insert operations`, () => {
    // Create a schema with transformations
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
      age: z.number().int().positive(),
      created_at: z.string().transform((val) => new Date(val)),
      updated_at: z.string().transform((val) => new Date(val)),
      tags: z
        .array(z.string())
        .transform((val) => val.map((tag) => tag.toLowerCase())),
      metadata: z
        .record(z.string())
        .transform((val) => ({ ...val, processed: true })),
    })

    const collection = createCollection({
      getKey: (item) => item.id,
      mutations: true,
      schema: userSchema,
      startSync: true,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
    })

    const mutationFn = async () => {}

    // Test insert with data that should be transformed
    const insertData = {
      id: `1`,
      name: `John Doe`,
      email: `john@example.com`,
      age: 30,
      created_at: `2023-01-01T00:00:00.000Z`,
      updated_at: `2023-01-01T00:00:00.000Z`,
      tags: [`IMPORTANT`, `USER`],
      metadata: { source: `manual` } as any,
    }

    const tx = createTransaction({ mutationFn })
    tx.mutate(() => collection.insert(insertData))

    // Verify that transformations were applied
    expect(tx.mutations).toHaveLength(1)
    const mutation = tx.mutations[0]!

    expect(mutation.type).toBe(`insert`)
    expect(mutation.modified.created_at).toBeInstanceOf(Date)
    expect(mutation.modified.updated_at).toBeInstanceOf(Date)
    expect(mutation.modified.tags).toEqual([`important`, `user`])
    expect(mutation.modified.metadata).toEqual({
      source: `manual`,
      processed: true,
    })
    expect(mutation.modified.name).toBe(`John Doe`)
    expect(mutation.modified.age).toBe(30)
  })

  it(`should apply schema transformations on update operations`, async () => {
    // Create a schema with transformations that can handle both input and existing data
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
      age: z.number().int().positive(),
      created_at: z
        .union([z.string(), z.date()])
        .transform((val) => (typeof val === `string` ? new Date(val) : val)),
      updated_at: z
        .union([z.string(), z.date()])
        .transform((val) => (typeof val === `string` ? new Date(val) : val)),
      tags: z
        .union([
          z.array(z.string()),
          z
            .array(z.string())
            .transform((val) => val.map((tag) => tag.toLowerCase())),
        ])
        .transform((val) => val.map((tag) => tag.toLowerCase())),
      metadata: z
        .union([
          z.record(z.string()),
          z
            .record(z.string())
            .transform((val) => ({ ...val, processed: true })),
        ])
        .transform((val) => ({ ...val, processed: true })),
    })

    const collection = createCollection({
      getKey: (item) => item.id,
      mutations: true,
      schema: userSchema,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit }) => {
          begin()
          // Insert initial data
          write({
            type: `insert`,
            value: {
              id: `1`,
              name: `John Doe`,
              email: `john@example.com`,
              age: 30,
              created_at: new Date(`2023-01-01T00:00:00.000Z`),
              updated_at: new Date(`2023-01-01T00:00:00.000Z`),
              tags: [`user`],
              metadata: { source: `manual` } as any,
            },
          })
          commit()
        },
      },
    })

    await collection.stateWhenReady()

    const mutationFn = async () => {}

    // Test update with data that should be transformed
    const tx = createTransaction({ mutationFn })
    tx.mutate(() =>
      collection.update(`1`, (draft) => {
        draft.name = `Jane Doe`
        draft.age = 31
        draft.updated_at = `2023-01-02T00:00:00.000Z`
        draft.tags = [`IMPORTANT`, `ADMIN`]
        draft.metadata = { role: `admin` } as Record<string, string>
      })
    )

    // Verify that transformations were applied and only modified fields are returned
    expect(tx.mutations).toHaveLength(1)
    const mutation = tx.mutations[0]!

    expect(mutation.type).toBe(`update`)
    expect(mutation.changes).toHaveProperty(`name`)
    expect(mutation.changes).toHaveProperty(`age`)
    expect(mutation.changes).toHaveProperty(`updated_at`)
    expect(mutation.changes).toHaveProperty(`tags`)
    expect(mutation.changes).toHaveProperty(`metadata`)

    // Verify transformations
    expect(mutation.changes.updated_at).toBeInstanceOf(Date)
    expect(mutation.changes.tags).toEqual([`important`, `admin`])
    expect(mutation.changes.metadata).toEqual({
      role: `admin`,
      processed: true,
    })
    expect(mutation.changes.name).toBe(`Jane Doe`)
    expect(mutation.changes.age).toBe(31)
  })

  it(`should handle complex nested transformations on insert and update`, async () => {
    // Create a schema with complex nested transformations
    const addressSchema = z.object({
      street: z.string(),
      city: z.string(),
      country: z.string().transform((val) => val.toUpperCase()),
    })

    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
      addresses: z
        .array(addressSchema)
        .transform((val) => val.map((addr) => ({ ...addr, normalized: true }))),
      preferences: z
        .object({
          theme: z.string().transform((val) => val.toLowerCase()),
          notifications: z.boolean(),
        })
        .transform((val) => ({ ...val, version: `1.0` })),
      created_at: z.string().transform((val) => new Date(val)),
    })

    const collection = createCollection({
      getKey: (item) => item.id,
      mutations: true,
      schema: userSchema,
      startSync: true,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
    })

    const mutationFn = async () => {}

    // Test insert with complex nested data
    const insertData = {
      id: `1`,
      name: `John Doe`,
      email: `john@example.com`,
      addresses: [
        { street: `123 Main St`, city: `New York`, country: `usa` },
        { street: `456 Oak Ave`, city: `Los Angeles`, country: `usa` },
      ],
      preferences: {
        theme: `DARK`,
        notifications: true,
      },
      created_at: `2023-01-01T00:00:00.000Z`,
    }

    const insertTx = createTransaction({ mutationFn })
    insertTx.mutate(() => collection.insert(insertData))

    // Verify complex transformations were applied
    expect(insertTx.mutations).toHaveLength(1)
    const insertMutation = insertTx.mutations[0]!

    expect(insertMutation.type).toBe(`insert`)
    expect(insertMutation.modified.created_at).toBeInstanceOf(Date)
    expect((insertMutation.modified as any).addresses).toHaveLength(2)
    expect((insertMutation.modified as any).addresses[0].country).toBe(`USA`)
    expect((insertMutation.modified as any).addresses[0].normalized).toBe(true)
    expect((insertMutation.modified as any).addresses[1].country).toBe(`USA`)
    expect((insertMutation.modified as any).addresses[1].normalized).toBe(true)
    expect((insertMutation.modified as any).preferences.theme).toBe(`dark`)
    expect((insertMutation.modified as any).preferences.version).toBe(`1.0`)
    expect((insertMutation.modified as any).preferences.notifications).toBe(
      true
    )

    // Now test update with the same schema that can handle existing transformed data
    const updateSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
      addresses: z
        .array(
          z.object({
            street: z.string(),
            city: z.string(),
            country: z.string().transform((val) => val.toUpperCase()),
            normalized: z.boolean().optional(),
          })
        )
        .transform((val) => val.map((addr) => ({ ...addr, normalized: true }))),
      preferences: z
        .object({
          theme: z.string().transform((val) => val.toLowerCase()),
          notifications: z.boolean(),
          version: z.string().optional(),
        })
        .transform((val) => ({ ...val, version: `1.0` })),
      created_at: z
        .union([z.string(), z.date()])
        .transform((val) => (typeof val === `string` ? new Date(val) : val)),
    })

    const updateCollection = createCollection({
      getKey: (item) => item.id,
      mutations: true,
      schema: updateSchema,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit }) => {
          begin()
          // Add the transformed insert data
          write({
            type: `insert`,
            value: insertMutation.modified as any,
          })
          commit()
        },
      },
    })

    await updateCollection.stateWhenReady()

    // Test update with new nested data
    const updateTx = createTransaction({ mutationFn })
    updateTx.mutate(() =>
      updateCollection.update(`1`, (draft) => {
        draft.name = `Jane Doe`
        draft.addresses = [
          { street: `789 Pine St`, city: `Chicago`, country: `usa` },
        ]
        draft.preferences = {
          theme: `LIGHT`,
          notifications: false,
        }
      })
    )

    // Verify update transformations
    expect(updateTx.mutations).toHaveLength(1)
    const updateMutation = updateTx.mutations[0]!

    expect(updateMutation.type).toBe(`update`)
    expect(updateMutation.changes).toHaveProperty(`name`)
    expect(updateMutation.changes).toHaveProperty(`addresses`)
    expect(updateMutation.changes).toHaveProperty(`preferences`)

    expect(updateMutation.changes.name).toBe(`Jane Doe`)
    expect((updateMutation.changes as any).addresses).toHaveLength(1)
    expect((updateMutation.changes as any).addresses[0].country).toBe(`USA`)
    expect((updateMutation.changes as any).addresses[0].normalized).toBe(true)
    expect((updateMutation.changes as any).preferences.theme).toBe(`light`)
    expect((updateMutation.changes as any).preferences.version).toBe(`1.0`)
    expect((updateMutation.changes as any).preferences.notifications).toBe(
      false
    )
  })
})

describe(`Collection schema callback type tests`, () => {
  it(`should correctly type all callback parameters with schema`, () => {
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
      age: z.number().int().positive(),
    })

    type ExpectedType = z.infer<typeof userSchema>
    type ExpectedInput = z.input<typeof userSchema>

    createCollection({
      getKey: (item) => item.id,
      mutations: true,
      schema: userSchema,
      sync: { sync: () => {} },
      onInsert: (params) => {
        expectTypeOf(params.transaction).toHaveProperty(`mutations`)
        const mutation = params.transaction.mutations[0]
        expectTypeOf(mutation).toHaveProperty(`modified`)
        expectTypeOf(mutation.modified).toEqualTypeOf<ExpectedType>()
        return Promise.resolve()
      },
      onUpdate: (params) => {
        expectTypeOf(params.transaction).toHaveProperty(`mutations`)
        const mutation = params.transaction.mutations[0]
        expectTypeOf(mutation).toHaveProperty(`modified`)
        expectTypeOf(mutation.modified).toEqualTypeOf<ExpectedType>()
        expectTypeOf(mutation).toHaveProperty(`changes`)
        expectTypeOf(mutation.changes).toEqualTypeOf<Partial<ExpectedInput>>()
        return Promise.resolve()
      },
      onDelete: (params) => {
        expectTypeOf(params.transaction).toHaveProperty(`mutations`)
        const mutation = params.transaction.mutations[0]
        expectTypeOf(mutation).toHaveProperty(`original`)
        expectTypeOf(mutation.original).toEqualTypeOf<ExpectedType>()
        return Promise.resolve()
      },
    })
  })

  it(`should correctly type callbacks with schema transformations`, () => {
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
      created_at: z.date().or(z.string().transform((val) => new Date(val))),
      updated_at: z.date().or(z.string().transform((val) => new Date(val))),
    })

    type ExpectedType = z.infer<typeof userSchema>

    createCollection({
      getKey: (item) => item.id,
      mutations: true,
      schema: userSchema,
      sync: { sync: () => {} },
      onInsert: (params) => {
        const mutation = params.transaction.mutations[0]
        // Modified should be the output type (with Date objects)
        expectTypeOf(mutation.modified).toEqualTypeOf<ExpectedType>()
        return Promise.resolve()
      },
      onUpdate: (params) => {
        const mutation = params.transaction.mutations[0]
        // Modified should be the output type (with Date objects)
        expectTypeOf(mutation.modified).toEqualTypeOf<ExpectedType>()
        return Promise.resolve()
      },
      onDelete: (params) => {
        const mutation = params.transaction.mutations[0]
        // Original should be the output type (with Date objects)
        expectTypeOf(mutation.original).toEqualTypeOf<ExpectedType>()
        return Promise.resolve()
      },
    })
  })

  it(`should correctly type callbacks with schema defaults`, () => {
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
      created_at: z.date().default(() => new Date()),
      updated_at: z.date().default(() => new Date()),
    })

    type ExpectedType = z.infer<typeof userSchema>
    type ExpectedInput = z.input<typeof userSchema>

    createCollection({
      getKey: (item) => item.id,
      mutations: true,
      schema: userSchema,
      sync: { sync: () => {} },
      onInsert: (params) => {
        const mutation = params.transaction.mutations[0]
        // Modified should be the output type (with all fields including defaults)
        expectTypeOf(mutation.modified).toEqualTypeOf<ExpectedType>()
        return Promise.resolve()
      },
      onUpdate: (params) => {
        const mutation = params.transaction.mutations[0]
        // Modified should be the output type (with all fields including defaults)
        expectTypeOf(mutation.modified).toEqualTypeOf<ExpectedType>()
        // Changes should be the input type (without defaulted fields)
        expectTypeOf(mutation.changes).toEqualTypeOf<Partial<ExpectedInput>>()
        return Promise.resolve()
      },
      onDelete: (params) => {
        const mutation = params.transaction.mutations[0]
        // Original should be the output type (with all fields including defaults)
        expectTypeOf(mutation.original).toEqualTypeOf<ExpectedType>()
        return Promise.resolve()
      },
    })
  })
})

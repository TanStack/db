import { describe, expect, it } from "vitest"
import { z } from "zod"
import { createCollection } from "../src/collection"

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
      schema: updateSchema,
      sync: { sync: () => {} },
    })

    // Add the validated insert data to the update collection
    ;(updateCollection as any).syncedData.set(`1`, validatedInsert)

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
    ;(collection as any).syncedData.set(`1`, validatedInsert)

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
    ;(collection as any).syncedData.set(`1`, validatedInsert)

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
    ;(collection as any).syncedData.set(`1`, validatedInsert)

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

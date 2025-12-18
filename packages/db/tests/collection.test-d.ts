import { assertType, describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { createCollection } from '../src/collection/index.js'
import type { OperationConfig } from '../src/types'
import type { StandardSchemaV1 } from '@standard-schema/spec'

describe(`Collection.update type tests`, () => {
  type TypeTestItem = { id: string; value: number; optional?: boolean }

  const testCollection = createCollection<TypeTestItem, string>({
    getKey: (item) => item.id,
    sync: { sync: () => {} },
  })
  const updateMethod = testCollection.update

  it(`should correctly type drafts for multi-item update with callback (Overload 1)`, () => {
    updateMethod([`id1`, `id2`], (drafts) => {
      expectTypeOf(drafts).toEqualTypeOf<Array<TypeTestItem>>()
      // @ts-expect-error - This line should error because drafts is an array, not a single item.
      assertType<TypeTestItem>(drafts)
    })
  })

  it(`should correctly type drafts for multi-item update with config and callback (Overload 2)`, () => {
    const config: OperationConfig = { metadata: { test: true } }
    updateMethod([`id1`, `id2`], config, (drafts) => {
      expectTypeOf(drafts).toEqualTypeOf<Array<TypeTestItem>>()
      // @ts-expect-error - This line should error.
      assertType<TypeTestItem>(drafts)
    })
  })

  it(`should correctly type draft for single-item update with callback (Overload 3)`, () => {
    updateMethod(`id1`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<TypeTestItem>()
      // @ts-expect-error - This line should error because draft is a single item, not an array.
      assertType<Array<TypeTestItem>>(draft)
    })
  })

  it(`should correctly type draft for single-item update with config and callback (Overload 4)`, () => {
    const config: OperationConfig = { metadata: { test: true } }
    updateMethod(`id1`, config, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<TypeTestItem>()
      // @ts-expect-error - This line should error.
      assertType<Array<TypeTestItem>>(draft)
    })
  })
})

describe(`Collection type resolution tests`, () => {
  // Define test types
  type ExplicitType = { id: string; explicit: boolean }

  const testSchema = z.object({
    id: z.string(),
    schema: z.boolean(),
  })

  type SchemaType = StandardSchemaV1.InferOutput<typeof testSchema>
  type ItemOf<T> = T extends Array<infer U> ? U : T

  it(`should use explicit type when provided without schema`, () => {
    const _collection = createCollection<ExplicitType, string>({
      getKey: (item) => {
        expectTypeOf(item).toEqualTypeOf<ExplicitType>()
        return item.id
      },
      sync: { sync: () => {} },
    })

    expectTypeOf(_collection.toArray).toEqualTypeOf<Array<ExplicitType>>()

    type Key = Parameters<typeof _collection.get>[0]
    expectTypeOf<Key>().toEqualTypeOf<string>()

    type Param = Parameters<typeof _collection.insert>[0]
    expectTypeOf<ItemOf<Param>>().toEqualTypeOf<ExplicitType>()
  })

  it(`should use schema type when explicit type is not provided`, () => {
    const _collection = createCollection({
      getKey: (item) => {
        expectTypeOf(item).toEqualTypeOf<SchemaType>()
        return item.id
      },
      sync: { sync: () => {} },
      schema: testSchema,
    })

    expectTypeOf(_collection.toArray).toEqualTypeOf<Array<SchemaType>>()

    type Key = Parameters<typeof _collection.get>[0]
    expectTypeOf<Key>().toEqualTypeOf<string>()

    type Param = Parameters<typeof _collection.insert>[0]
    expectTypeOf<ItemOf<Param>>().toEqualTypeOf<SchemaType>()
  })

  it(`should automatically infer type from Zod schema with optional fields`, () => {
    // Test with a Zod schema that has optional fields
    const userSchema = z.object({
      id: z.number(),
      name: z.string(),
      email: z.string().email().optional(),
      created_at: z.date().optional(),
    })

    const _collection = createCollection({
      getKey: (item) => item.id,
      sync: { sync: () => {} },
      schema: userSchema,
    })

    type Param = Parameters<typeof _collection.insert>[0]
    type ExpectedType = {
      id: number
      name: string
      email?: string
      created_at?: Date
    }

    // Should automatically infer the complete Zod schema type
    expectTypeOf<ItemOf<Param>>().toEqualTypeOf<ExpectedType>()
  })

  it(`should automatically infer type from Zod schema with nullable fields`, () => {
    // Test with nullable fields (different from optional)
    const postSchema = z.object({
      id: z.string(),
      title: z.string(),
      author_id: z.string().nullable(),
      published_at: z.date().nullable(),
    })

    const _collection = createCollection({
      getKey: (item) => item.id,
      sync: { sync: () => {} },
      schema: postSchema,
    })

    type Param = Parameters<typeof _collection.insert>[0]
    type ExpectedType = {
      id: string
      title: string
      author_id: string | null
      published_at: Date | null
    }

    // Should automatically infer nullable types correctly
    expectTypeOf<ItemOf<Param>>().toEqualTypeOf<ExpectedType>()
  })
})

describe(`Schema Input/Output Type Distinction`, () => {
  // Define schema with different input/output types
  const userSchemaWithDefaults = z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
    created_at: z.date().default(() => new Date()),
    updated_at: z.date().default(() => new Date()),
  })

  // Define schema with transformations
  const userSchemaTransform = z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
    created_at: z.string().transform((val) => new Date(val)),
    updated_at: z.string().transform((val) => new Date(val)),
  })

  it(`should handle schema with default values correctly for insert`, () => {
    type ExpectedOutputType = StandardSchemaV1.InferOutput<
      typeof userSchemaWithDefaults
    >
    type ExpectedInputType = StandardSchemaV1.InferInput<
      typeof userSchemaWithDefaults
    >

    const collection = createCollection({
      getKey: (item) => {
        expectTypeOf(item).toEqualTypeOf<ExpectedOutputType>()
        return item.id
      },
      sync: { sync: () => {} },
      schema: userSchemaWithDefaults,
    })

    type InsertArg = Parameters<typeof collection.insert>[0]

    // Input type should not include defaulted fields
    expectTypeOf<ExpectedInputType>().toEqualTypeOf<{
      id: string
      name: string
      email: string
      created_at?: Date
      updated_at?: Date
    }>()

    // Output type should include all fields
    expectTypeOf<ExpectedOutputType>().toEqualTypeOf<{
      id: string
      name: string
      email: string
      created_at: Date
      updated_at: Date
    }>()

    // Insert should accept ExpectedInputType or array thereof
    expectTypeOf<InsertArg>().toEqualTypeOf<
      ExpectedInputType | Array<ExpectedInputType>
    >()

    // Collection items should be ExpectedOutputType
    expectTypeOf(collection.toArray).toEqualTypeOf<Array<ExpectedOutputType>>()
  })

  it(`should handle schema with transformations correctly for insert`, () => {
    const collection = createCollection({
      getKey: (item) => item.id,
      sync: { sync: () => {} },
      schema: userSchemaTransform,
    })

    type ExpectedInputType = StandardSchemaV1.InferInput<
      typeof userSchemaTransform
    >
    type ExpectedOutputType = StandardSchemaV1.InferOutput<
      typeof userSchemaTransform
    >
    type InsertArg = Parameters<typeof collection.insert>[0]

    // Input type should be the raw input (before transformation)
    expectTypeOf<ExpectedInputType>().toEqualTypeOf<{
      id: string
      name: string
      email: string
      created_at: string
      updated_at: string
    }>()

    // Output type should be the transformed output
    expectTypeOf<ExpectedOutputType>().toEqualTypeOf<{
      id: string
      name: string
      email: string
      created_at: Date
      updated_at: Date
    }>()

    // Insert should accept ExpectedInputType or array thereof
    expectTypeOf<InsertArg>().toEqualTypeOf<
      ExpectedInputType | Array<ExpectedInputType>
    >()

    // Collection items should be ExpectedOutputType
    expectTypeOf(collection.toArray).toEqualTypeOf<Array<ExpectedOutputType>>()
  })

  it(`should handle schema with default values correctly for update method`, () => {
    const collection = createCollection({
      getKey: (item) => item.id,
      sync: { sync: () => {} },
      schema: userSchemaWithDefaults,
    })

    type ExpectedOutputType = StandardSchemaV1.InferOutput<
      typeof userSchemaWithDefaults
    >
    type ExpectedInputType = StandardSchemaV1.InferInput<
      typeof userSchemaWithDefaults
    >

    // Input type should not include defaulted fields
    expectTypeOf<ExpectedInputType>().toEqualTypeOf<{
      id: string
      name: string
      email: string
      created_at?: Date
      updated_at?: Date
    }>()

    // Output type should include all fields
    expectTypeOf<ExpectedOutputType>().toEqualTypeOf<{
      id: string
      name: string
      email: string
      created_at: Date
      updated_at: Date
    }>()

    // Test update method with schema types
    const updateMethod: typeof collection.update = (() => {}) as any
    updateMethod(`test-id`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<ExpectedInputType>()
    })

    updateMethod([`test-id1`, `test-id2`], (drafts) => {
      expectTypeOf(drafts).toEqualTypeOf<Array<ExpectedInputType>>()
    })

    // Collection items should be ExpectedOutputType
    expectTypeOf(collection.toArray).toEqualTypeOf<Array<ExpectedOutputType>>()
  })

  it(`should handle schema with transformations correctly for update method`, () => {
    const collection = createCollection({
      getKey: (item) => item.id,
      sync: { sync: () => {} },
      schema: userSchemaTransform,
    })

    type ExpectedInputType = StandardSchemaV1.InferInput<
      typeof userSchemaTransform
    >
    type ExpectedOutputType = StandardSchemaV1.InferOutput<
      typeof userSchemaTransform
    >

    // Input type should be the raw input (before transformation)
    expectTypeOf<ExpectedInputType>().toEqualTypeOf<{
      id: string
      name: string
      email: string
      created_at: string
      updated_at: string
    }>()

    // Output type should be the transformed output
    expectTypeOf<ExpectedOutputType>().toEqualTypeOf<{
      id: string
      name: string
      email: string
      created_at: Date
      updated_at: Date
    }>()

    // Test update method with schema types
    const updateMethod: typeof collection.update = (() => {}) as any
    updateMethod(`test-id`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<ExpectedInputType>()
    })

    updateMethod([`test-id1`, `test-id2`], (drafts) => {
      expectTypeOf(drafts).toEqualTypeOf<Array<ExpectedInputType>>()
    })

    // Collection items should be ExpectedOutputType
    expectTypeOf(collection.toArray).toEqualTypeOf<Array<ExpectedOutputType>>()
  })
})

describe(`Collection callback type tests`, () => {
  type TypeTestItem = { id: string; value: number; optional?: boolean }

  it(`should correctly type onInsert callback parameters`, () => {
    createCollection<TypeTestItem>({
      getKey: (item) => item.id,
      sync: { sync: () => {} },
      onInsert: (params) => {
        expectTypeOf(params.transaction).toHaveProperty(`mutations`)
        const mutation = params.transaction.mutations[0]
        expectTypeOf(mutation).toHaveProperty(`modified`)
        expectTypeOf(mutation.modified).toEqualTypeOf<TypeTestItem>()
        return Promise.resolve()
      },
    })
  })

  it(`should correctly type onUpdate callback parameters`, () => {
    createCollection<TypeTestItem>({
      getKey: (item) => item.id,
      sync: { sync: () => {} },
      onUpdate: (params) => {
        expectTypeOf(params.transaction).toHaveProperty(`mutations`)
        const mutation = params.transaction.mutations[0]
        expectTypeOf(mutation).toHaveProperty(`modified`)
        expectTypeOf(mutation.modified).toEqualTypeOf<TypeTestItem>()
        expectTypeOf(mutation).toHaveProperty(`changes`)
        expectTypeOf(mutation.changes).toEqualTypeOf<Partial<TypeTestItem>>()
        return Promise.resolve()
      },
    })
  })

  it(`should correctly type onDelete callback parameters`, () => {
    createCollection<TypeTestItem>({
      getKey: (item) => item.id,
      sync: { sync: () => {} },
      onDelete: (params) => {
        expectTypeOf(params.transaction).toHaveProperty(`mutations`)
        const mutation = params.transaction.mutations[0]
        expectTypeOf(mutation).toHaveProperty(`original`)
        expectTypeOf(mutation.original).toEqualTypeOf<TypeTestItem>()
        return Promise.resolve()
      },
    })
  })
})

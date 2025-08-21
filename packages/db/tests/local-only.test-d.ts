import { describe, expectTypeOf, it } from "vitest"
import { z } from "zod"
import { createCollection } from "../src/index"
import { localOnlyCollectionOptions } from "../src/local-only"
import type { LocalOnlyCollectionUtils } from "../src/local-only"

interface TestItem extends Record<string, unknown> {
  id: number
  name: string
  completed?: boolean
}

type ItemOf<T> = T extends Array<infer U> ? U : T

describe(`LocalOnly Collection Types`, () => {
  it(`should have correct return type from localOnlyCollectionOptions`, () => {
    const options = localOnlyCollectionOptions({
      id: `test-local-only`,
      getKey: (item: TestItem) => item.id,
    })

    // Test that options has the expected structure
    expectTypeOf(options).toHaveProperty(`sync`)
    expectTypeOf(options).toHaveProperty(`onInsert`)
    expectTypeOf(options).toHaveProperty(`onUpdate`)
    expectTypeOf(options).toHaveProperty(`onDelete`)
    expectTypeOf(options).toHaveProperty(`utils`)
    expectTypeOf(options).toHaveProperty(`getKey`)

    // Test that getKey returns the correct type
    expectTypeOf(options.getKey).parameter(0).toEqualTypeOf<TestItem>()
    expectTypeOf(options.getKey).returns.toEqualTypeOf<number>()
  })

  it(`should be compatible with createCollection`, () => {
    const options = localOnlyCollectionOptions<TestItem, number>({
      id: `test-local-only`,
      getKey: (item) => item.id,
    })

    const collection = createCollection(options)

    // Test that the collection has the essential methods and properties
    expectTypeOf(collection.insert).toBeFunction()
    expectTypeOf(collection.update).toBeFunction()
    expectTypeOf(collection.delete).toBeFunction()
    expectTypeOf(collection.get).returns.toEqualTypeOf<TestItem | undefined>()
    expectTypeOf(collection.toArray).toEqualTypeOf<Array<TestItem>>()

    // Test insert parameter type
    type InsertParam = Parameters<typeof collection.insert>[0]
    expectTypeOf<ItemOf<InsertParam>>().toEqualTypeOf<TestItem>()

    // Test update draft type
    collection.update(1, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<TestItem>()
    })
  })

  it(`should work with custom callbacks`, () => {
    const configWithCallbacks = {
      id: `test-with-callbacks`,
      getKey: (item: TestItem) => item.id,
      onInsert: () => Promise.resolve({}),
      onUpdate: () => Promise.resolve({}),
      onDelete: () => Promise.resolve({}),
    }

    const options = localOnlyCollectionOptions(configWithCallbacks)
    const collection = createCollection<
      TestItem,
      number,
      LocalOnlyCollectionUtils
    >(options)

    // Test that the collection has the essential methods and properties
    expectTypeOf(collection.insert).toBeFunction()
    expectTypeOf(collection.update).toBeFunction()
    expectTypeOf(collection.delete).toBeFunction()
    expectTypeOf(collection.get).returns.toEqualTypeOf<TestItem | undefined>()
    expectTypeOf(collection.toArray).toEqualTypeOf<Array<TestItem>>()

    // Test insert parameter type
    type InsertParam2 = Parameters<typeof collection.insert>[0]
    expectTypeOf<ItemOf<InsertParam2>>().toEqualTypeOf<TestItem>()

    // Test update draft type
    collection.update(1, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<TestItem>()
    })
  })

  it(`should work with initial data`, () => {
    const configWithInitialData = {
      id: `test-with-initial-data`,
      getKey: (item: TestItem) => item.id,
      initialData: [{ id: 1, name: `Test` }] as Array<TestItem>,
    }

    const options = localOnlyCollectionOptions(configWithInitialData)
    const collection = createCollection(options)

    // Test that the collection has the essential methods and properties
    expectTypeOf(collection.insert).toBeFunction()
    expectTypeOf(collection.update).toBeFunction()
    expectTypeOf(collection.delete).toBeFunction()
    expectTypeOf(collection.get).returns.toEqualTypeOf<TestItem | undefined>()
    expectTypeOf(collection.toArray).toEqualTypeOf<Array<TestItem>>()
  })

  it(`should infer key type from getKey function`, () => {
    const config = {
      id: `test-string-key`,
      getKey: (item: TestItem) => `item-${item.id}`,
    }

    const options = localOnlyCollectionOptions(config)
    const collection = createCollection(options)

    // Test that the collection has the essential methods and properties
    expectTypeOf(collection.insert).toBeFunction()
    expectTypeOf(collection.update).toBeFunction()
    expectTypeOf(collection.delete).toBeFunction()
    expectTypeOf(collection.get).returns.toEqualTypeOf<TestItem | undefined>()
    expectTypeOf(collection.toArray).toEqualTypeOf<Array<TestItem>>()
    expectTypeOf(options.getKey).toBeFunction()
  })

  it(`should work with schema and infer correct types`, () => {
    const testSchema = z.object({
      id: z.string(),
      entityId: z.string(),
      value: z.string(),
      createdAt: z.date().optional().default(new Date()),
    })

    // We can trust that zod infers the correct types for the schema
    type ExpectedType = z.infer<typeof testSchema>
    type ExpectedInput = z.input<typeof testSchema>

    const collection = createCollection(
      localOnlyCollectionOptions({
        id: `test-with-schema`,
        getKey: (item: any) => item.id,
        schema: testSchema,
        onInsert: (params) => {
          expectTypeOf(
            params.transaction.mutations[0].modified
          ).toEqualTypeOf<ExpectedType>()
          return Promise.resolve()
        },
        onUpdate: (params) => {
          expectTypeOf(
            params.transaction.mutations[0].modified
          ).toEqualTypeOf<ExpectedType>()
          return Promise.resolve()
        },
        onDelete: (params) => {
          expectTypeOf(
            params.transaction.mutations[0].modified
          ).toEqualTypeOf<ExpectedType>()
          return Promise.resolve()
        },
      })
    )

    collection.insert({
      id: `1`,
      entityId: `1`,
      value: `1`,
    })

    // Test insert parameter type
    type InsertParam = Parameters<typeof collection.insert>[0]
    type ItemOf<T> = T extends Array<infer U> ? U : T
    expectTypeOf<ItemOf<InsertParam>>().toEqualTypeOf<ExpectedInput>()

    // Check that the update method accepts the expected input type
    collection.update(`1`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<ExpectedInput>()
    })

    // Test that the collection has the correct inferred type from schema
    expectTypeOf(collection.toArray).toEqualTypeOf<Array<ExpectedType>>()
  })
})

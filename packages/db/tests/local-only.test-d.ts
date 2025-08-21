import { describe, expectTypeOf, it } from "vitest"
import { z } from "zod"
import { createCollection } from "../src/index"
import { localOnlyCollectionOptions } from "../src/local-only"
import type { LocalOnlyCollectionUtils } from "../src/local-only"
import type { Collection } from "../src/index"
import type { InsertConfig } from "../src/types"

interface TestItem extends Record<string, unknown> {
  id: number
  name: string
  completed?: boolean
}

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

    // Test that the collection has the expected type
    expectTypeOf(collection).toExtend<
      Collection<TestItem, number, LocalOnlyCollectionUtils>
    >()
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

    expectTypeOf(collection).toExtend<
      Collection<TestItem, number, LocalOnlyCollectionUtils>
    >()
  })

  it(`should work with initial data`, () => {
    const configWithInitialData = {
      id: `test-with-initial-data`,
      getKey: (item: TestItem) => item.id,
      initialData: [{ id: 1, name: `Test` }] as Array<TestItem>,
    }

    const options = localOnlyCollectionOptions(configWithInitialData)
    const collection = createCollection(options)

    expectTypeOf(collection).toExtend<
      Collection<TestItem, number, LocalOnlyCollectionUtils>
    >()
  })

  it(`should infer key type from getKey function`, () => {
    const config = {
      id: `test-string-key`,
      getKey: (item: TestItem) => `item-${item.id}`,
    }

    const options = localOnlyCollectionOptions(config)
    const collection = createCollection(options)

    expectTypeOf(collection).toExtend<
      Collection<TestItem, string, LocalOnlyCollectionUtils>
    >()
    expectTypeOf(options.getKey).toExtend<(item: TestItem) => string>()
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

    // Check that the insert method accepts the expected input type
    expectTypeOf(collection.insert).parameters.toExtend<
      [ExpectedInput | Array<ExpectedInput>, InsertConfig?]
    >()

    // Check that the update method accepts the expected input type
    collection.update(`1`, (draft) => {
      expectTypeOf(draft).toExtend<ExpectedInput>()
    })

    // Test that the collection has the correct inferred type from schema
    expectTypeOf(collection.toArray).toExtend<Array<ExpectedType>>()
  })
})

import { describe, expectTypeOf, it } from "vitest"
import { z } from "zod"
import { createCollection } from "../src/index"
import { localOnlyCollectionOptions } from "../src/local-only"
import type { LocalOnlyCollectionUtils } from "../src/local-only"
import type { Collection } from "../src/index"
import type { Query } from "../src/query/builder"

interface TestItem extends Record<string, unknown> {
  id: number
  name: string
  completed?: boolean
}

describe(`LocalOnly Collection Types`, () => {
  it(`should have correct return type from localOnlyCollectionOptions`, () => {
    const config = {
      id: `test-local-only`,
      getKey: (item: TestItem) => item.id,
    }

    const options = localOnlyCollectionOptions<
      TestItem,
      never,
      TestItem,
      number
    >(config)

    // Test that options has the expected structure
    expectTypeOf(options).toHaveProperty(`sync`)
    expectTypeOf(options).toHaveProperty(`onInsert`)
    expectTypeOf(options).toHaveProperty(`onUpdate`)
    expectTypeOf(options).toHaveProperty(`onDelete`)
    expectTypeOf(options).toHaveProperty(`utils`)
    expectTypeOf(options).toHaveProperty(`getKey`)

    // Test that getKey returns the correct type
    expectTypeOf(options.getKey).toExtend<(item: TestItem) => number>()
  })

  it(`should be compatible with createCollection`, () => {
    const config = {
      id: `test-local-only`,
      getKey: (item: TestItem) => item.id,
    }

    const options = localOnlyCollectionOptions<
      TestItem,
      never,
      TestItem,
      number
    >(config)

    const collection = createCollection<
      TestItem,
      number,
      LocalOnlyCollectionUtils
    >(options)

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

    const options = localOnlyCollectionOptions<
      TestItem,
      never,
      TestItem,
      number
    >(configWithCallbacks)
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

    const options = localOnlyCollectionOptions<
      TestItem,
      never,
      TestItem,
      number
    >(configWithInitialData)
    const collection = createCollection<
      TestItem,
      number,
      LocalOnlyCollectionUtils
    >(options)

    expectTypeOf(collection).toExtend<
      Collection<TestItem, number, LocalOnlyCollectionUtils>
    >()
  })

  it(`should infer key type from getKey function`, () => {
    const config = {
      id: `test-string-key`,
      getKey: (item: TestItem) => `item-${item.id}`,
    }

    const options = localOnlyCollectionOptions<
      TestItem,
      never,
      TestItem,
      string
    >(config)
    const collection = createCollection<
      TestItem,
      string,
      LocalOnlyCollectionUtils
    >(options)

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
    })

    const config = {
      id: `test-with-schema`,
      getKey: (item: any) => item.id,
      schema: testSchema,
    }

    const options = localOnlyCollectionOptions(config)
    const collection = createCollection(options)

    // Test that the collection has the correct inferred type from schema
    expectTypeOf(collection).toExtend<
      Collection<
        {
          id: string
          entityId: string
          value: string
        },
        string,
        LocalOnlyCollectionUtils
      >
    >()
  })

  it(`should work with schema and query builder type inference (bug report reproduction)`, () => {
    const testSchema = z.object({
      id: z.string(),
      entityId: z.string(),
      value: z.string(),
      createdAt: z.date(),
    })

    const config = {
      id: `test-with-schema-query`,
      getKey: (item: any) => item.id,
      schema: testSchema,
    }

    const options = localOnlyCollectionOptions(config)
    const collection = createCollection(options)

    // This should work without type errors - the query builder should infer the correct type
    const query = (q: InstanceType<typeof Query>) =>
      q
        .from({ bookmark: collection })
        .orderBy(({ bookmark }) => bookmark.createdAt, `desc`)

    // Test that the collection has the correct inferred type from schema
    expectTypeOf(collection).toExtend<
      Collection<
        {
          id: string
          entityId: string
          value: string
          createdAt: Date
        },
        string,
        LocalOnlyCollectionUtils
      >
    >()

    // Test that the query builder can access the createdAt property
    expectTypeOf(query).toBeFunction()
  })

  it(`should reproduce exact bug report scenario`, () => {
    // This reproduces the exact scenario from the bug report
    const selectUrlSchema = z.object({
      id: z.string(),
      url: z.string(),
      title: z.string(),
      createdAt: z.date(),
    })

    const initialData = [
      {
        id: `1`,
        url: `https://example.com`,
        title: `Example`,
        createdAt: new Date(),
      },
    ]

    const bookmarkCollection = createCollection(
      localOnlyCollectionOptions({
        initialData,
        getKey: (url: any) => url.id,
        schema: selectUrlSchema,
      })
    )

    // This should work without type errors - the query builder should infer the correct type
    const query = (q: InstanceType<typeof Query>) =>
      q
        .from({ bookmark: bookmarkCollection })
        .orderBy(({ bookmark }) => bookmark.createdAt, `desc`)

    // Test that the collection has the correct inferred type from schema
    expectTypeOf(bookmarkCollection).toExtend<
      Collection<
        {
          id: string
          url: string
          title: string
          createdAt: Date
        },
        string,
        LocalOnlyCollectionUtils
      >
    >()

    // Test that the query builder can access the createdAt property
    expectTypeOf(query).toBeFunction()
  })
})

import { describe, expectTypeOf, it } from "vitest"
import { createCollection } from "@tanstack/db"
import { localOnlyCollectionOptions } from "../src/local-only"
import type { LocalOnlyCollectionUtils } from "../src/local-only"
import type { Collection } from "@tanstack/db"

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
    expectTypeOf(options.getKey).toMatchTypeOf<(item: TestItem) => number>()
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
    expectTypeOf(collection).toMatchTypeOf<
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

    expectTypeOf(collection).toMatchTypeOf<
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

    expectTypeOf(collection).toMatchTypeOf<
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

    expectTypeOf(collection).toMatchTypeOf<
      Collection<TestItem, string, LocalOnlyCollectionUtils>
    >()
    expectTypeOf(options.getKey).toMatchTypeOf<(item: TestItem) => string>()
  })
})

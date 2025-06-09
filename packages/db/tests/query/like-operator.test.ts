import { describe, expect, it } from "vitest"
import {
  Antichain,
  D2,
  MessageType,
  MultiSet,
  output,
  v,
} from "@electric-sql/d2ts"
import { compileQueryPipeline } from "../../src/query/pipeline-compiler.js"
import type { Condition, Query } from "../../src/query/schema.js"
import type { Message } from "@electric-sql/d2ts"

describe(`Query - LIKE Operator`, () => {
  // Sample test data
  type TestItem = {
    id: number
    name: string
    description: string
    SKU: string
    category: string
  }

  type Context = {
    baseSchema: {
      items: TestItem
    }
    schema: {
      items: TestItem
    }
  }

  // Sample products for testing
  const testData: Array<TestItem> = [
    {
      id: 1,
      name: `Laptop Pro 15"`,
      description: `A professional laptop with 15-inch screen`,
      SKU: `TECH-LP15-2023`,
      category: `Electronics`,
    },
    {
      id: 2,
      name: `Smartphone X`,
      description: `Latest smartphone with AI features`,
      SKU: `TECH-SPX-2023`,
      category: `Electronics`,
    },
    {
      id: 3,
      name: `Office Desk 60%`,
      description: `60% discount on this ergonomic desk!`,
      SKU: `FURN-DSK-60PCT`,
      category: `Furniture`,
    },
    {
      id: 4,
      name: `Programming 101`,
      description: `Learn programming basics`,
      SKU: `BOOK-PRG-101`,
      category: `Books`,
    },
    {
      id: 5,
      name: `USB-C Cable (2m)`,
      description: `2-meter USB-C cable for fast charging`,
      SKU: `ACC-USBC-2M`,
      category: `Accessories`,
    },
  ]

  function runQuery(query: Query): Array<any> {
    const graph = new D2({ initialFrontier: v([0, 0]) })
    const input = graph.newInput<[number, TestItem]>()
    const pipeline = compileQueryPipeline(query, { [query.from]: input })

    const messages: Array<Message<any>> = []
    pipeline.pipe(
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      v([1, 0]),
      new MultiSet(testData.map((item) => [[item.id, item], 1]))
    )
    input.sendFrontier(new Antichain([v([1, 0])]))

    graph.run()

    const dataMessages = messages.filter((m) => m.type === MessageType.DATA)
    return (
      dataMessages[0]?.data.collection.getInner().map(([data]) => data[1]) || []
    )
  }

  it(`should handle basic percent wildcard matching`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@name`],
      from: `items`,
      where: [`@name`, `like`, `Laptop%`] as Condition,
    }

    const results = runQuery(query)

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe(1)
    expect(results[0].name).toBe(`Laptop Pro 15"`)
  })

  it(`should handle wildcards at the beginning and middle of pattern`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@name`, `@description`],
      from: `items`,
      where: [`@description`, `like`, `%laptop%`] as Condition,
    }

    const results = runQuery(query)

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe(1)
  })

  it(`should handle underscore wildcard (single character)`, () => {
    // Let's generate more items with different SKUs to test the underscore pattern precisely
    const skuTestItems: Array<TestItem> = [
      {
        id: 101,
        name: `Test Item 1`,
        description: `Test description`,
        SKU: `TECH-ABC-2023`,
        category: `Test`,
      },
      {
        id: 102,
        name: `Test Item 2`,
        description: `Test description`,
        SKU: `TECH-XYZ-2023`,
        category: `Test`,
      },
    ]

    const query: Query<Context> = {
      select: [`@id`, `@SKU`],
      from: `items`,
      where: [`@SKU`, `like`, `TECH-___-2023`] as Condition,
    }

    // Create a separate graph for this test with our specific SKU test items
    const graph = new D2({ initialFrontier: v([0, 0]) })
    const input = graph.newInput<[number, TestItem]>()
    const pipeline = compileQueryPipeline(query, { [query.from]: input })

    const messages: Array<Message<any>> = []
    pipeline.pipe(
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    // Use the special SKU test items
    input.sendData(
      v([1, 0]),
      new MultiSet(skuTestItems.map((item) => [[item.id, item], 1]))
    )
    input.sendFrontier(new Antichain([v([1, 0])]))

    graph.run()

    const dataMessages = messages.filter((m) => m.type === MessageType.DATA)
    const results =
      dataMessages[0]?.data.collection.getInner().map(([data]) => data[1]) || []

    // Both 'TECH-ABC-2023' and 'TECH-XYZ-2023' should match 'TECH-___-2023'
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.id).sort()).toEqual([101, 102])
  })

  it(`should handle mixed underscore and percent wildcards`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@SKU`],
      from: `items`,
      where: [`@SKU`, `like`, `TECH-__%-____`] as Condition,
    }

    const results = runQuery(query)

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.id).sort()).toEqual([1, 2])
  })

  it(`should handle escaped special characters`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@name`],
      from: `items`,
      where: [`@name`, `like`, `Office Desk 60\\%`] as Condition,
    }

    const results = runQuery(query)

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe(3)
  })

  it(`should handle NOT LIKE operator correctly`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@name`, `@category`],
      from: `items`,
      where: [`@category`, `not like`, `Elec%`] as Condition,
    }

    const results = runQuery(query)

    expect(results).toHaveLength(3)
    expect(results.map((r) => r.id).sort()).toEqual([3, 4, 5])
  })

  it(`should handle regex special characters in patterns`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@name`, `@description`],
      from: `items`,
      where: [`@description`, `like`, `%[0-9]%`] as Condition, // Using regex special char
    }

    const results = runQuery(query)

    // Now with proper regex escaping, this should match descriptions with literal [0-9]
    // None of our test data contains this pattern, so expecting 0 results
    expect(results).toHaveLength(0)
  })

  it(`should match numeric values in descriptions`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@name`, `@description`],
      from: `items`,
      where: [`@description`, `like`, `%2-%`] as Condition, // Looking for "2-" in description
    }

    const results = runQuery(query)

    // Should match "2-meter USB-C cable..."
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe(5)
  })

  it(`should do case-insensitive matching`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@name`],
      from: `items`,
      where: [`@name`, `like`, `laptop%`] as Condition, // lowercase, but data has uppercase
    }

    const results = runQuery(query)

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe(1)
  })
})

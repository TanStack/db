import { describe, expect, it } from "vitest"
import { D2, MultiSet, output } from "@electric-sql/d2mini"
import { compileQueryPipeline } from "../../src/query/pipeline-compiler.js"
import type { Condition, Query } from "../../src/query/schema.js"

describe(`Query - IN Operator`, () => {
  // Sample test data
  type TestItem = {
    id: number
    name: string
    tags: Array<string>
    category: string
    price: number
    isActive?: boolean
    metadata?: Record<string, any>
    createdAt?: Date
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
      name: `Laptop`,
      tags: [`electronics`, `tech`, `portable`],
      category: `Electronics`,
      price: 1200,
      isActive: true,
      metadata: { brand: `TechBrand`, model: `X15` },
    },
    {
      id: 2,
      name: `Smartphone`,
      tags: [`electronics`, `tech`, `mobile`],
      category: `Electronics`,
      price: 800,
      isActive: true,
      metadata: { brand: `PhoneCo`, model: `P10` },
    },
    {
      id: 3,
      name: `Desk`,
      tags: [`furniture`, `office`, `wood`],
      category: `Furniture`,
      price: 350,
      isActive: false,
    },
    {
      id: 4,
      name: `Book`,
      tags: [`education`, `reading`],
      category: `Books`,
      price: 25,
      isActive: true,
    },
    {
      id: 5,
      name: `Headphones`,
      tags: [`electronics`, `audio`],
      category: `Electronics`,
      price: 150,
      isActive: undefined,
    },
  ]

  it(`should handle basic IN operator with simple values`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@name`, `@category`],
      from: `items`,
      where: [[`@category`, `in`, [`Electronics`, `Books`]] as Condition],
    }

    const graph = new D2()
    const input = graph.newInput<[number, TestItem]>()
    const pipeline = compileQueryPipeline(query, { [query.from]: input })

    const messages: Array<MultiSet<any>> = []
    pipeline.pipe(
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(new MultiSet(testData.map((item) => [[item.id, item], 1])))

    graph.run()

    const results = messages[0]!.getInner().map(([data]) => data[1])

    // Should return items in Electronics or Books categories (1, 2, 4, 5)
    expect(results).toHaveLength(4)
    expect(results.map((item) => item.id).sort()).toEqual([1, 2, 4, 5])
  })

  it(`should use case-sensitive string matching by default`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@name`],
      from: `items`,
      where: [[`@category`, `in`, [`electronics`, `books`]] as Condition], // lowercase categories
    }

    const graph = new D2()
    const input = graph.newInput<[number, TestItem]>()
    const pipeline = compileQueryPipeline(query, { [query.from]: input })

    const messages: Array<MultiSet<any>> = []
    pipeline.pipe(
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(new MultiSet(testData.map((item) => [[item.id, item], 1])))

    graph.run()

    const results = messages[0]!.getInner().map(([data]) => data[1])

    // Should NOT match 'Electronics' or 'Books' with lowercase 'electronics' and 'books'
    // (case-sensitive matching)
    expect(results).toHaveLength(0) // No results due to case-sensitivity
  })

  it(`should handle NOT IN operator correctly`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@name`, `@category`],
      from: `items`,
      where: [[`@category`, `not in`, [`Electronics`, `Books`]] as Condition],
    }

    const graph = new D2()
    const input = graph.newInput<[number, TestItem]>()
    const pipeline = compileQueryPipeline(query, { [query.from]: input })

    const messages: Array<MultiSet<any>> = []
    pipeline.pipe(
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(new MultiSet(testData.map((item) => [[item.id, item], 1])))

    graph.run()

    const results = messages[0]!.getInner().map(([data]) => data[1])

    // Should return items NOT in Electronics or Books categories (just Furniture - id 3)
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe(3)
    expect(results[0].category).toBe(`Furniture`)
  })

  it(`should handle type coercion between numbers and strings`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@name`],
      from: `items`,
      where: [[`@id`, `in`, [`1`, `2`, `3`]] as Condition], // String IDs instead of numbers
    }

    const graph = new D2()
    const input = graph.newInput<[number, TestItem]>()
    const pipeline = compileQueryPipeline(query, { [query.from]: input })

    const messages: Array<MultiSet<any>> = []
    pipeline.pipe(
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(new MultiSet(testData.map((item) => [[item.id, item], 1])))

    graph.run()

    const results = messages[0]!.getInner().map(([data]) => data[1])

    // Should return items with IDs 1, 2, and 3, despite string vs number difference
    expect(results).toHaveLength(3)
    expect(results.map((item) => item.id).sort()).toEqual([1, 2, 3])
  })

  it(`should handle array-to-array comparisons with IN operator`, () => {
    // Note: This test is still experimental. The proper syntax for array-to-array
    // comparisons needs further investigation. Currently, Query doesn't handle
    // the array-to-array case in the way we tried to test here.
    //
    // FUTURE ENHANCEMENT: Implement a specialized function or operator for checking
    // if any element of array1 exists in array2.
    const query: Query<Context> = {
      select: [`@id`, `@name`, `@tags`],
      from: `items`,
      where: [
        [
          [`@tags`, `in`, [[`electronics`], [`audio`]]] as unknown as Condition,
        ] as unknown as Condition,
      ],
    }

    const graph = new D2()
    const input = graph.newInput<[number, TestItem]>()
    const pipeline = compileQueryPipeline(query, { [query.from]: input })

    const messages: Array<MultiSet<any>> = []
    pipeline.pipe(
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(new MultiSet(testData.map((item) => [[item.id, item], 1])))

    graph.run()

    // const results = messages[0]!.getInner().map(([data]) => data[1])

    // TODO: Finish this test!
  })

  it(`should handle null values correctly with IN operator`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@name`, `@isActive`],
      from: `items`,
      where: [[`@isActive`, `in`, [null, false]] as Condition],
    }

    const graph = new D2()
    const input = graph.newInput<[number, TestItem]>()
    const pipeline = compileQueryPipeline(query, { [query.from]: input })

    const messages: Array<MultiSet<any>> = []
    pipeline.pipe(
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(new MultiSet(testData.map((item) => [[item.id, item], 1])))

    graph.run()

    const results = messages[0]!.getInner().map(([data]) => data[1])

    // Should return items with isActive that is null/undefined or false (items 3 and 5)
    expect(results).toHaveLength(2)
    expect(results.map((item) => item.id).sort()).toEqual([3, 5])
  })

  it(`should handle object comparison with IN operator`, () => {
    // Note: This test is still experimental. The current JSON stringification approach
    // for comparing objects is not perfect. It doesn't handle object key ordering differences
    // and may have limitations with nested or circular structures.
    //
    // FUTURE ENHANCEMENT: Implement a more robust deep equality check that can handle
    // object key ordering, nested structures, and special cases like Date objects.
    const query: Query<Context> = {
      select: [`@id`, `@name`, `@metadata`],
      from: `items`,
      where: [
        [
          `@metadata`,
          `in`,
          [
            { value: { brand: `TechBrand`, model: `X15` } },
            { value: { brand: `OtherBrand`, model: `Y20` } },
          ],
        ] as Condition,
      ],
    }

    const graph = new D2()
    const input = graph.newInput<[number, TestItem]>()
    const pipeline = compileQueryPipeline(query, { [query.from]: input })

    const messages: Array<MultiSet<any>> = []
    pipeline.pipe(
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(new MultiSet(testData.map((item) => [[item.id, item], 1])))

    graph.run()

    // const dataMessages = messages.filter((m) => m.type === MessageType.DATA)
    // const results =
    //   dataMessages[0]?.data.collection.getInner().map(([data]) => data[1]) || []

    // TODO: Finish this test!
  })

  it(`should handle empty arrays correctly`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@name`],
      from: `items`,
      where: [[`@category`, `in`, []] as Condition], // Empty array
    }

    const graph = new D2()
    const input = graph.newInput<[number, TestItem]>()
    const pipeline = compileQueryPipeline(query, { [query.from]: input })

    const messages: Array<MultiSet<any>> = []
    pipeline.pipe(
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(new MultiSet(testData.map((item) => [[item.id, item], 1])))

    graph.run()

    const results = messages[0]!.getInner().map(([data]) => data[1])

    // Nothing should be in an empty array
    expect(results).toHaveLength(0)
  })

  it(`should handle complex nested conditions with IN operator`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@name`, `@category`, `@price`],
      from: `items`,
      where: [
        [
          [`@category`, `in`, [`Electronics`, `Books`]],
          `and`,
          [`@price`, `>`, 100],
        ] as unknown as Condition,
      ],
    }

    const graph = new D2()
    const input = graph.newInput<[number, TestItem]>()
    const pipeline = compileQueryPipeline(query, { [query.from]: input })

    const messages: Array<MultiSet<any>> = []
    pipeline.pipe(
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(new MultiSet(testData.map((item) => [[item.id, item], 1])))

    graph.run()

    const results = messages[0]!.getInner().map(([data]) => data[1])

    // Should return items that are in category Electronics or Books AND have price > 100
    // This matches items 1, 2, and 5:
    // - Laptop (id: 1): Electronics, price 1200
    // - Smartphone (id: 2): Electronics, price 800
    // - Headphones (id: 5): Electronics, price 150
    expect(results).toHaveLength(3)
    expect(results.map((item) => item.id).sort()).toEqual([1, 2, 5])
  })
})

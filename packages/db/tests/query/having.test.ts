import { describe, expect, it } from "vitest"
import { D2, MultiSet, output } from "@electric-sql/d2mini"
import { compileQueryPipeline } from "../../src/query/pipeline-compiler.js"
import type { Condition, Query } from "../../src/query/schema.js"

describe(`Query - HAVING Clause`, () => {
  // Define a sample data type for our tests
  type Product = {
    id: number
    name: string
    price: number
    category: string
    inStock: boolean
    rating: number
    tags: Array<string>
    discount?: number
  }

  type Context = {
    baseSchema: {
      products: Product
    }
    schema: {
      products: Product
    }
  }

  // Sample products for testing
  const sampleProducts: Array<Product> = [
    {
      id: 1,
      name: `Laptop`,
      price: 1200,
      category: `Electronics`,
      inStock: true,
      rating: 4.5,
      tags: [`tech`, `device`],
    },
    {
      id: 2,
      name: `Smartphone`,
      price: 800,
      category: `Electronics`,
      inStock: true,
      rating: 4.2,
      tags: [`tech`, `mobile`],
    },
    {
      id: 3,
      name: `Desk`,
      price: 350,
      category: `Furniture`,
      inStock: false,
      rating: 3.8,
      tags: [`home`, `office`],
    },
    {
      id: 4,
      name: `Book`,
      price: 25,
      category: `Books`,
      inStock: true,
      rating: 4.7,
      tags: [`education`, `reading`],
    },
    {
      id: 5,
      name: `Monitor`,
      price: 300,
      category: `Electronics`,
      inStock: true,
      rating: 4.0,
      tags: [`tech`, `display`],
    },
    {
      id: 6,
      name: `Chair`,
      price: 150,
      category: `Furniture`,
      inStock: true,
      rating: 3.5,
      tags: [`home`, `comfort`],
    },
    {
      id: 7,
      name: `Tablet`,
      price: 500,
      category: `Electronics`,
      inStock: false,
      rating: 4.3,
      tags: [`tech`, `mobile`],
    },
  ]

  it(`should filter products with HAVING clause`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@name`, `@price`, `@category`],
      from: `products`,
      having: [[`@price`, `>`, 300] as Condition],
    }

    const graph = new D2()
    const input = graph.newInput<[number, Product]>()
    const pipeline = compileQueryPipeline(query, { [query.from]: input })

    const messages: Array<MultiSet<any>> = []
    pipeline.pipe(
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      new MultiSet(sampleProducts.map((product) => [[product.id, product], 1]))
    )

    graph.run()

    // Check the filtered results
    const results = messages[0]!.getInner().map(([data]) => data[1])

    expect(results).toHaveLength(4)
    expect(results.every((p) => p.price > 300)).toBe(true)
    expect(results.map((p) => p.id)).toContain(1) // Laptop
    expect(results.map((p) => p.id)).toContain(2) // Smartphone
    expect(results.map((p) => p.id)).toContain(7) // Tablet
    expect(results.map((p) => p.id)).toContain(3) // Desk
  })

  it(`should apply WHERE and HAVING in sequence`, () => {
    // Query to find in-stock products with price > 200
    const query: Query<Context> = {
      select: [`@id`, `@name`, `@price`, `@category`, `@inStock`],
      from: `products`,
      where: [[`@inStock`, `=`, true] as Condition],
      having: [[`@price`, `>`, 200] as Condition],
    }

    const graph = new D2()
    const input = graph.newInput<[number, Product]>()
    const pipeline = compileQueryPipeline(query, { [query.from]: input })

    const messages: Array<MultiSet<any>> = []
    pipeline.pipe(
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      new MultiSet(sampleProducts.map((product) => [[product.id, product], 1]))
    )

    graph.run()

    // Check the filtered results
    const results = messages[0]!.getInner().map(([data]) => data[1])

    expect(results).toHaveLength(3)
    expect(results.every((p) => p.inStock === true)).toBe(true)
    expect(results.every((p) => p.price > 200)).toBe(true)
    expect(results.map((p) => p.id)).toContain(1) // Laptop
    expect(results.map((p) => p.id)).toContain(2) // Smartphone
    expect(results.map((p) => p.id)).toContain(5) // Monitor
  })

  it(`should support complex conditions in HAVING`, () => {
    // Query with complex HAVING condition
    const query: Query<Context> = {
      select: [`@id`, `@name`, `@price`, `@category`, `@rating`],
      from: `products`,
      having: [
        [
          [`@price`, `>`, 100],
          `and`,
          [`@price`, `<`, 600],
          `and`,
          [`@rating`, `>=`, 4.0],
        ] as unknown as Condition,
      ],
    }

    const graph = new D2()
    const input = graph.newInput<[number, Product]>()
    const pipeline = compileQueryPipeline(query, { [query.from]: input })

    const messages: Array<MultiSet<any>> = []
    pipeline.pipe(
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      new MultiSet(sampleProducts.map((product) => [[product.id, product], 1]))
    )

    graph.run()

    // Check the filtered results
    const results = messages[0]!.getInner().map(([data]) => data[1])

    expect(results).toHaveLength(2)

    // Individual assertions for more clarity
    const resultIds = results.map((p) => p.id)
    expect(resultIds).toContain(5) // Monitor: price 300, rating 4.0
    expect(resultIds).toContain(7) // Tablet: price 500, rating 4.3

    // Verify each result meets all conditions
    results.forEach((p) => {
      expect(p.price).toBeGreaterThan(100)
      expect(p.price).toBeLessThan(600)
      expect(p.rating).toBeGreaterThanOrEqual(4.0)
    })
  })

  it(`should support nested conditions in HAVING`, () => {
    // Query with nested HAVING condition
    const query: Query<Context> = {
      select: [`@id`, `@name`, `@price`, `@category`, `@inStock`],
      from: `products`,
      having: [
        [
          [[`@category`, `=`, `Electronics`], `and`, [`@price`, `<`, 600]],
          `or`,
          [[`@category`, `=`, `Furniture`], `and`, [`@inStock`, `=`, true]],
        ] as unknown as Condition,
      ],
    }

    const graph = new D2()
    const input = graph.newInput<[number, Product]>()
    const pipeline = compileQueryPipeline(query, { [query.from]: input })

    const messages: Array<MultiSet<any>> = []
    pipeline.pipe(
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      new MultiSet(sampleProducts.map((product) => [[product.id, product], 1]))
    )

    graph.run()

    // Check the filtered results
    const results = messages[0]!.getInner().map(([data]) => data[1])

    // Expected: inexpensive electronics or in-stock furniture
    expect(results).toHaveLength(3)

    // Get result IDs for easier assertions
    const resultIds = results.map((p) => p.id)
    expect(resultIds).toContain(5) // Monitor: Electronics, price 300
    expect(resultIds).toContain(6) // Chair: Furniture, inStock true
    expect(resultIds).toContain(7) // Tablet: Electronics, price 500

    // Check that each product matches either condition
    results.forEach((product) => {
      // Check if it matches either condition
      const matchesCondition1 =
        product.category === `Electronics` && product.price < 600
      const matchesCondition2 =
        product.category === `Furniture` && product.inStock === true
      expect(matchesCondition1 || matchesCondition2).toBeTruthy()
    })
  })
})

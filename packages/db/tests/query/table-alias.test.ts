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
import type { Message } from "@electric-sql/d2ts"
import type { Condition, Query } from "../../src/query/schema.js"

describe(`Query - Table Aliasing`, () => {
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
      p: Product
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
  ]

  it(`should support table aliases in SELECT clause`, () => {
    const query: Query<Context> = {
      select: [
        `@p.id`,
        `@p.name`,
        { item_price: `@p.price` },
        { item_category: `@p.category` },
      ],
      from: `products`,
      as: `p`,
    }

    const graph = new D2({ initialFrontier: v([0, 0]) })
    const input = graph.newInput<Product>()
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
      new MultiSet(sampleProducts.map((product) => [product, 1]))
    )
    input.sendFrontier(new Antichain([v([1, 0])]))

    graph.run()

    // Check the results
    const dataMessages = messages.filter((m) => m.type === MessageType.DATA)
    const results = dataMessages[0]!.data.collection
      .getInner()
      .map(([data]) => data)

    expect(results).toHaveLength(4)

    // Check that all fields are correctly extracted
    const laptop = results.find((p) => p.id === 1)
    expect(laptop).toBeDefined()
    expect(laptop.name).toBe(`Laptop`)
    expect(laptop.item_price).toBe(1200)
    expect(laptop.item_category).toBe(`Electronics`)
  })

  it(`should support table aliases in WHERE clause`, () => {
    const query: Query<Context> = {
      select: [`@p.id`, `@p.name`, `@p.price`],
      from: `products`,
      as: `p`,
      where: [`@p.category`, `=`, `Electronics`] as Condition,
    }

    const graph = new D2({ initialFrontier: v([0, 0]) })
    const input = graph.newInput<Product>()
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
      new MultiSet(sampleProducts.map((product) => [product, 1]))
    )
    input.sendFrontier(new Antichain([v([1, 0])]))

    graph.run()

    // Check the filtered results
    const dataMessages = messages.filter((m) => m.type === MessageType.DATA)
    const results = dataMessages[0]!.data.collection
      .getInner()
      .map(([data]) => data)

    expect(results).toHaveLength(2)

    // All results should be from Electronics category
    results.forEach((result) => {
      expect(result.id === 1 || result.id === 2).toBeTruthy()
      expect([`Laptop`, `Smartphone`]).toContain(result.name)
    })
  })

  it(`should support table aliases in HAVING clause`, () => {
    const query: Query<Context> = {
      select: [`@p.id`, `@p.name`, `@p.price`],
      from: `products`,
      as: `p`,
      having: [`@p.price`, `>`, 500] as Condition,
    }

    const graph = new D2({ initialFrontier: v([0, 0]) })
    const input = graph.newInput<Product>()
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
      new MultiSet(sampleProducts.map((product) => [product, 1]))
    )
    input.sendFrontier(new Antichain([v([1, 0])]))

    graph.run()

    // Check the filtered results
    const dataMessages = messages.filter((m) => m.type === MessageType.DATA)
    const results = dataMessages[0]!.data.collection
      .getInner()
      .map(([data]) => data)

    expect(results).toHaveLength(2)

    // All results should have price > 500
    results.forEach((result) => {
      expect(result.price).toBeGreaterThan(500)
      expect([`Laptop`, `Smartphone`]).toContain(result.name)
    })
  })

  it(`should support mixing aliased and non-aliased column references`, () => {
    const query: Query<Context> = {
      select: [
        `@id`, // Non-aliased
        `@p.name`, // Aliased
        `@inStock`, // Non-aliased inStock field
        { price: `@price` }, // Non-aliased with column alias
        { cat: `@p.category` }, // Aliased with column alias
      ],
      from: `products`,
      as: `p`,
      where: [
        [`@p.price`, `>`, 100], // Aliased condition
        `and`,
        [`@inStock`, `=`, true], // Non-aliased condition
      ] as unknown as Condition,
    }

    const graph = new D2({ initialFrontier: v([0, 0]) })
    const input = graph.newInput<Product>()
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
      new MultiSet(sampleProducts.map((product) => [product, 1]))
    )
    input.sendFrontier(new Antichain([v([1, 0])]))

    graph.run()

    // Check the filtered results
    const dataMessages = messages.filter((m) => m.type === MessageType.DATA)
    const results = dataMessages[0]!.data.collection
      .getInner()
      .map(([data]) => data)

    // The condition @p.price > 100 AND @inStock = true should match:
    // - Laptop (price: 1200, inStock: true)
    // - Smartphone (price: 800, inStock: true)
    // Book has price 25 which is not > 100
    expect(results).toHaveLength(2)

    // All results should have price > 100 and inStock = true
    results.forEach((result) => {
      expect(result.price).toBeGreaterThan(100)
      expect(result.inStock).toBe(true)
      expect(result.cat).toBeDefined() // Should have the cat alias
    })

    // Verify we have the expected products
    const resultIds = results.map((p) => p.id)
    expect(resultIds).toContain(1) // Laptop
    expect(resultIds).toContain(2) // Smartphone
  })

  it(`should support complex conditions with table aliases`, () => {
    const query: Query<Context> = {
      select: [`@p.id`, `@p.name`, `@p.price`, `@p.category`],
      from: `products`,
      as: `p`,
      where: [
        [[`@p.category`, `=`, `Electronics`], `and`, [`@p.price`, `<`, 1000]],
        `or`,
        [[`@p.category`, `=`, `Books`], `and`, [`@p.rating`, `>=`, 4.5]],
      ] as unknown as Condition,
    }

    const graph = new D2({ initialFrontier: v([0, 0]) })
    const input = graph.newInput<Product>()
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
      new MultiSet(sampleProducts.map((product) => [product, 1]))
    )
    input.sendFrontier(new Antichain([v([1, 0])]))

    graph.run()

    // Check the filtered results
    const dataMessages = messages.filter((m) => m.type === MessageType.DATA)
    const results = dataMessages[0]!.data.collection
      .getInner()
      .map(([data]) => data)

    // Should return Smartphone (Electronics < 1000) and Book (Books with rating >= 4.5)
    expect(results).toHaveLength(2)

    const resultIds = results.map((p) => p.id)
    expect(resultIds).toContain(2) // Smartphone
    expect(resultIds).toContain(4) // Book
  })
})

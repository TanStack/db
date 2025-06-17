import { describe, expect, test } from "vitest"
import { D2, MultiSet, output } from "@electric-sql/d2mini"
import { compileQueryPipeline } from "../../src/query/pipeline-compiler.js"
import type { Query } from "../../src/query/index.js"
import type {
  FlatCompositeCondition,
  NestedCompositeCondition,
} from "../../src/query/schema.js"

// Sample data type for testing
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

// Sample data for tests
const sampleProducts: Array<Product> = [
  {
    id: 1,
    name: `Laptop`,
    price: 1200,
    category: `Electronics`,
    inStock: true,
    rating: 4.5,
    tags: [`tech`, `computer`],
  },
  {
    id: 2,
    name: `Smartphone`,
    price: 800,
    category: `Electronics`,
    inStock: true,
    rating: 4.2,
    tags: [`tech`, `mobile`],
    discount: 10,
  },
  {
    id: 3,
    name: `Headphones`,
    price: 150,
    category: `Electronics`,
    inStock: false,
    rating: 3.8,
    tags: [`tech`, `audio`],
  },
  {
    id: 4,
    name: `Book`,
    price: 20,
    category: `Books`,
    inStock: true,
    rating: 4.7,
    tags: [`fiction`, `bestseller`],
  },
  {
    id: 5,
    name: `Desk`,
    price: 300,
    category: `Furniture`,
    inStock: true,
    rating: 4.0,
    tags: [`home`, `office`],
  },
  {
    id: 6,
    name: `Chair`,
    price: 150,
    category: `Furniture`,
    inStock: true,
    rating: 3.5,
    tags: [`home`, `office`],
  },
  {
    id: 7,
    name: `Tablet`,
    price: 350,
    category: `Electronics`,
    inStock: false,
    rating: 4.1,
    tags: [`tech`, `mobile`],
  },
]

describe(`Query`, () => {
  describe(`Nested Conditions`, () => {
    test(`OR with simple conditions`, () => {
      // Should select Books OR Furniture
      const query: Query<Context> = {
        select: [`@id`, `@name`, `@category`],
        from: `products`,
        where: [
          [
            [`@category`, `=`, `Books`],
            `or`,
            [`@category`, `=`, `Furniture`],
          ] as NestedCompositeCondition,
        ],
      }

      // Run the query and check results
      const results = runQuery(query)

      // Should match 3 products: Book, Desk, Chair
      expect(results).toHaveLength(3)

      // Verify specific product IDs are included
      const ids = results.map((r) => r.id).sort()
      expect(ids).toEqual([4, 5, 6])

      // Verify all results match the condition
      results.forEach((r) => {
        expect([`Books`, `Furniture`]).toContain(r.category)
      })
    })

    test(`AND with simple conditions`, () => {
      // Should select inStock Electronics
      const query: Query<Context> = {
        select: [`@id`, `@name`, `@category`, `@inStock`],
        from: `products`,
        where: [
          [
            [`@category`, `=`, `Electronics`],
            `and`,
            [`@inStock`, `=`, true],
          ] as NestedCompositeCondition,
        ],
      }

      // Run the query and check results
      const results = runQuery(query)

      // Should match 2 products: Laptop, Smartphone
      expect(results).toHaveLength(2)

      // Verify conditions are met
      results.forEach((r) => {
        expect(r.category).toBe(`Electronics`)
        expect(r.inStock).toBe(true)
      })
    })

    test(`Flat composite condition`, () => {
      // Electronics with rating > 4 AND price < 1000
      const query: Query<Context> = {
        select: [`@id`, `@name`, `@rating`, `@price`],
        from: `products`,
        where: [
          [
            `@category`,
            `=`,
            `Electronics`,
            `and`,
            `@rating`,
            `>`,
            4,
            `and`,
            `@price`,
            `<`,
            1000,
          ] as FlatCompositeCondition,
        ],
      }

      // Run the query and check results
      const results = runQuery(query)

      // Should match 2 products: Smartphone, Tablet
      expect(results).toHaveLength(2)

      // Verify all conditions are met
      results.forEach((r) => {
        expect(r.rating).toBeGreaterThan(4)
        expect(r.price).toBeLessThan(1000)
      })
    })

    test(`Complex nested condition`, () => {
      // (Electronics AND price > 500) OR (Furniture AND inStock)
      const query: Query<Context> = {
        select: [`@id`, `@name`, `@category`, `@price`, `@inStock`],
        from: `products`,
        where: [
          [
            [
              `@category`,
              `=`,
              `Electronics`,
              `and`,
              `@price`,
              `>`,
              500,
            ] as FlatCompositeCondition,
            `or`,
            [
              `@category`,
              `=`,
              `Furniture`,
              `and`,
              `@inStock`,
              `=`,
              true,
            ] as FlatCompositeCondition,
          ] as NestedCompositeCondition,
        ],
      }

      // Run the query and check results
      const results = runQuery(query)

      // Should match Laptop, Smartphone, Desk, Chair
      expect(results).toHaveLength(4)

      // Verify that each result satisfies at least one of the conditions
      results.forEach((r) => {
        const matchesCondition1 = r.category === `Electronics` && r.price > 500
        const matchesCondition2 =
          r.category === `Furniture` && r.inStock === true

        expect(matchesCondition1 || matchesCondition2).toBe(true)
      })
    })

    test(`Nested OR + AND combination`, () => {
      // Products that are:
      // (Electronics with price > 1000) OR
      // (Books with rating > 4.5) OR
      // (Furniture with price < 200)
      const query: Query<Context> = {
        select: [`@id`, `@name`, `@category`, `@price`, `@rating`],
        from: `products`,
        where: [
          [
            [
              `@category`,
              `=`,
              `Electronics`,
              `and`,
              `@price`,
              `>`,
              1000,
            ] as FlatCompositeCondition,
            `or`,
            [
              `@category`,
              `=`,
              `Books`,
              `and`,
              `@rating`,
              `>`,
              4.5,
            ] as FlatCompositeCondition,
            `or`,
            [
              `@category`,
              `=`,
              `Furniture`,
              `and`,
              `@price`,
              `<`,
              200,
            ] as FlatCompositeCondition,
          ] as NestedCompositeCondition,
        ],
      }

      // Run the query and check results
      const results = runQuery(query)

      // Laptop (expensive electronics), Book (high rated), Chair (cheap furniture)
      expect(results).toHaveLength(3)

      // Verify specific products are included
      const names = results.map((r) => r.name).sort()
      expect(names).toContain(`Laptop`)
      expect(names).toContain(`Book`)
      expect(names).toContain(`Chair`)

      // Verify that each result satisfies at least one of the conditions
      results.forEach((r) => {
        const matchesCondition1 = r.category === `Electronics` && r.price > 1000
        const matchesCondition2 = r.category === `Books` && r.rating > 4.5
        const matchesCondition3 = r.category === `Furniture` && r.price < 200

        expect(
          matchesCondition1 || matchesCondition2 || matchesCondition3
        ).toBe(true)
      })
    })
  })
})

// Helper function to run queries and collect results
function runQuery(query: Query): Array<any> {
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
  return messages[0]!.getInner().map(([data]) => data[1])
}

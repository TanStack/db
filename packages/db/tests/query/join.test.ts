import { describe, expect, it } from "vitest"
import { D2, MessageType, MultiSet, output } from "@electric-sql/d2ts"
import { compileQueryPipeline } from "../../src/query/pipeline-compiler.js"
import type { RootStreamBuilder } from "@electric-sql/d2ts"
import type { Query } from "../../src/query/schema.js"

describe(`Query - JOIN Clauses`, () => {
  // Sample data for users
  type User = {
    id: number
    name: string
    email: string
    role: string
  }

  // Sample data for products
  type Product = {
    id: number
    name: string
    price: number
    category: string
    creatorId: number
  }

  // Sample data for orders
  type Order = {
    id: number
    userId: number
    productId: number
    quantity: number
    orderDate: string
  }

  type Schema = {
    orders: Order
    users: User
    products: Product
  }

  type Context = {
    baseSchema: Schema
    schema: Schema
  }

  // Sample users
  const users: Array<User> = [
    {
      id: 1,
      name: `Alice Johnson`,
      email: `alice@example.com`,
      role: `admin`,
    },
    {
      id: 2,
      name: `Bob Smith`,
      email: `bob@example.com`,
      role: `user`,
    },
    {
      id: 3,
      name: `Carol Williams`,
      email: `carol@example.com`,
      role: `user`,
    },
    {
      id: 4,
      name: `Dave Brown`,
      email: `dave@example.com`,
      role: `manager`,
    },
  ]

  // Sample products
  const products: Array<Product> = [
    {
      id: 1,
      name: `Laptop`,
      price: 1200,
      category: `Electronics`,
      creatorId: 1,
    },
    {
      id: 2,
      name: `Smartphone`,
      price: 800,
      category: `Electronics`,
      creatorId: 1,
    },
    {
      id: 3,
      name: `Desk Chair`,
      price: 250,
      category: `Furniture`,
      creatorId: 2,
    },
    {
      id: 4,
      name: `Coffee Table`,
      price: 180,
      category: `Furniture`,
      creatorId: 2,
    },
    {
      id: 5,
      name: `Headphones`,
      price: 150,
      category: `Electronics`,
      creatorId: 3,
    },
  ]

  // Sample orders
  const orders: Array<Order> = [
    {
      id: 1,
      userId: 1,
      productId: 1,
      quantity: 1,
      orderDate: `2023-01-15`,
    },
    {
      id: 2,
      userId: 1,
      productId: 5,
      quantity: 2,
      orderDate: `2023-01-16`,
    },
    {
      id: 3,
      userId: 2,
      productId: 3,
      quantity: 1,
      orderDate: `2023-02-10`,
    },
    {
      id: 4,
      userId: 3,
      productId: 2,
      quantity: 1,
      orderDate: `2023-02-20`,
    },
    {
      id: 5,
      userId: 4,
      productId: 4,
      quantity: 2,
      orderDate: `2023-03-05`,
    },
  ]

  function runQueryWithJoins<T extends Record<string, any>>(
    mainData: Array<T>,
    query: Query,
    additionalData: Record<string, Array<any>> = {}
  ): Array<any> {
    const graph = new D2({ initialFrontier: 0 })

    // Create inputs for each table
    const mainInput = graph.newInput<[number, T]>()
    const inputs: Record<string, RootStreamBuilder<[number, any]>> = {
      [query.from]: mainInput,
    }

    // Create inputs for each joined table
    if (query.join) {
      for (const joinClause of query.join) {
        const tableName = joinClause.from
        inputs[tableName] = graph.newInput<[number, any]>()
      }
    }

    // Compile the query with the unified inputs map
    const pipeline = compileQueryPipeline(query, inputs)

    // Create a sink to collect the results
    const results: Array<any> = []
    pipeline.pipe(
      output((message) => {
        if (message.type === MessageType.DATA) {
          const data = message.data.collection
            .getInner()
            .map(([item]: [any, any]) => item[1])
          results.push(...data)
        }
      })
    )

    // Finalize the graph
    graph.finalize()

    // Send data to the main input
    mainInput.sendData(0, new MultiSet(mainData.map((d) => [[d.id, d], 1])))
    mainInput.sendFrontier(1)

    // Send data to the joined inputs
    if (query.join) {
      for (const joinClause of query.join) {
        const tableName = joinClause.from
        const data = additionalData[tableName] || []
        const input = inputs[tableName]

        if (input && data.length > 0) {
          input.sendData(0, new MultiSet(data.map((d) => [[d.id, d], 1])))
          input.sendFrontier(1)
        }
      }
    }

    graph.run()
    return results
  }

  it(`should support basic INNER JOIN`, () => {
    const query: Query<Context> = {
      select: [
        { order_id: `@orders.id` },
        { user_name: `@users.name` },
        { product_name: `@products.name` },
        { quantity: `@orders.quantity` },
      ],
      from: `orders`,
      join: [
        {
          type: `inner`,
          from: `users`,
          on: [`@orders.userId`, `=`, `@users.id`],
        },
        {
          type: `inner`,
          from: `products`,
          on: [`@orders.productId`, `=`, `@products.id`],
        },
      ],
    }

    const results = runQueryWithJoins(orders, query, {
      users,
      products,
    })

    // Inner join should only include records with matches in all tables
    expect(results).toHaveLength(5) // All our sample data matches

    // Check a specific result
    const firstOrder = results.find((r) => r.order_id === 1)
    expect(firstOrder).toBeDefined()
    expect(firstOrder.user_name).toBe(`Alice Johnson`)
    expect(firstOrder.product_name).toBe(`Laptop`)
    expect(firstOrder.quantity).toBe(1)
  })

  it(`should support LEFT JOIN`, () => {
    // Create an order without a matching product
    const ordersWithMissing = [
      ...orders,
      {
        id: 6,
        userId: 3,
        productId: 99, // Non-existent product
        quantity: 1,
        orderDate: `2023-04-01`,
      },
    ]

    const query: Query<Context> = {
      select: [
        {
          order_id: `@orders.id`,
          productId: `@orders.productId`,
          product_name: `@products.name`,
        },
      ],
      from: `orders`,
      join: [
        {
          type: `left`,
          from: `products`,
          on: [`@orders.productId`, `=`, `@products.id`],
        },
      ],
    }

    const results = runQueryWithJoins(ordersWithMissing, query, {
      products,
    })

    // Left join should include all records from the left side
    expect(results).toHaveLength(6) // 5 with matching products + 1 without

    // The last order should have a null product name
    const lastOrder = results.find((r) => r.order_id === 6)
    expect(lastOrder).toBeDefined()
    expect(lastOrder.productId).toBe(99)
    expect(lastOrder.product_name).toBeNull()
  })

  it(`should support RIGHT JOIN`, () => {
    // Exclude one product from orders
    const partialOrders = orders.filter((o) => o.productId !== 4)

    const query: Query<Context> = {
      select: [
        {
          order_id: `@orders.id`,
          product_id: `@products.id`,
          product_name: `@products.name`,
        },
      ],
      from: `orders`,
      join: [
        {
          type: `right`,
          from: `products`,
          on: [`@orders.productId`, `=`, `@products.id`],
        },
      ],
    }

    const results = runQueryWithJoins(partialOrders, query, {
      products,
    })

    // Right join should include all records from the right side
    expect(results).toHaveLength(5) // All products should be included

    // Product 4 should appear with null order info
    const product4 = results.find((r) => r.product_id === 4)
    expect(product4).toBeDefined()
    expect(product4.product_name).toBe(`Coffee Table`)
    expect(product4.order_id).toBeNull()
  })

  it(`should support FULL JOIN`, () => {
    // Add an order with no matching product
    const ordersWithMissing = [
      ...orders,
      {
        id: 6,
        userId: 3,
        productId: 99, // Non-existent product
        quantity: 1,
        orderDate: `2023-04-01`,
      },
    ]

    // Add a product with no matching orders
    const productsWithExtra = [
      ...products,
      {
        id: 6,
        name: `TV`,
        price: 900,
        category: `Electronics`,
        creatorId: 1,
      },
    ]

    const query: Query<Context> = {
      select: [
        {
          order_id: `@orders.id`,
          productId: `@orders.productId`,
          product_id: `@products.id`,
          product_name: `@products.name`,
        },
      ],
      from: `orders`,
      join: [
        {
          type: `full`,
          from: `products`,
          on: [`@orders.productId`, `=`, `@products.id`],
        },
      ],
    }

    const results = runQueryWithJoins(ordersWithMissing, query, {
      products: productsWithExtra,
    })

    // Full join should include all records from both sides
    expect(results).toHaveLength(7) // 5 matches + 1 order-only + 1 product-only

    // Order with no matching product
    const noProductOrder = results.find((r) => r.order_id === 6)
    expect(noProductOrder).toBeDefined()
    expect(noProductOrder.productId).toBe(99)
    expect(noProductOrder.product_name).toBeNull()

    // Product with no matching order
    const noOrderProduct = results.find((r) => r.product_id === 6)
    expect(noOrderProduct).toBeDefined()
    expect(noOrderProduct.product_name).toBe(`TV`)
    expect(noOrderProduct.order_id).toBeNull()
  })

  it(`should support join conditions in SELECT`, () => {
    const query: Query<Context> = {
      select: [
        {
          order_id: `@orders.id`,
          user_name: `@users.name`,
          product_name: `@products.name`,
          price: `@products.price`,
          quantity: `@orders.quantity`,
        },
      ],
      from: `orders`,
      join: [
        {
          type: `inner`,
          from: `users`,
          on: [`@orders.userId`, `=`, `@users.id`],
        },
        {
          type: `inner`,
          from: `products`,
          on: [`@orders.productId`, `=`, `@products.id`],
        },
      ],
    }

    const results = runQueryWithJoins(orders, query, {
      users,
      products,
    })

    // Check we have all the basic fields
    expect(results).toHaveLength(5)
    expect(results[0].order_id).toBeDefined()
    expect(results[0].user_name).toBeDefined()
    expect(results[0].product_name).toBeDefined()
    expect(results[0].price).toBeDefined()
    expect(results[0].quantity).toBeDefined()
  })
})

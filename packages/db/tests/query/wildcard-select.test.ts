import { beforeEach, describe, expect, test } from "vitest"
import { D2, MultiSet, output } from "@electric-sql/d2mini"
import { compileQueryPipeline } from "../../src/query/pipeline-compiler.js"
import type { Query } from "../../src/query/schema.js"

// Define types for our test records
type User = {
  id: number
  name: string
  age: number
  email: string
  active: boolean
}

type Order = {
  id: number
  userId: number
  product: string
  amount: number
  date: string
}

type Context = {
  baseSchema: {
    users: User
    orders: Order
  }
  schema: {
    users: User
    orders: Order
  }
}

describe(`Query Wildcard Select`, () => {
  let graph: D2
  let usersInput: ReturnType<D2[`newInput`]>
  let ordersInput: ReturnType<D2[`newInput`]>
  let messages: Array<any> = []

  // Sample data for tests
  const sampleUsers: Array<User> = [
    { id: 1, name: `Alice`, age: 25, email: `alice@example.com`, active: true },
    { id: 2, name: `Bob`, age: 19, email: `bob@example.com`, active: true },
    {
      id: 3,
      name: `Charlie`,
      age: 30,
      email: `charlie@example.com`,
      active: false,
    },
    { id: 4, name: `Dave`, age: 22, email: `dave@example.com`, active: true },
  ]

  const sampleOrders: Array<Order> = [
    { id: 101, userId: 1, product: `Laptop`, amount: 1200, date: `2023-01-15` },
    { id: 102, userId: 2, product: `Phone`, amount: 800, date: `2023-01-20` },
    {
      id: 103,
      userId: 1,
      product: `Headphones`,
      amount: 100,
      date: `2023-02-05`,
    },
    { id: 104, userId: 3, product: `Monitor`, amount: 300, date: `2023-02-10` },
  ]

  beforeEach(() => {
    // Create a new graph for each test
    graph = new D2()
    usersInput = graph.newInput<[number, User]>()
    ordersInput = graph.newInput<[number, Order]>()
    messages = []
  })

  // Helper function to extract results from messages
  const extractResults = (dataMessages: Array<any>): Array<any> => {
    if (dataMessages.length === 0) return []

    // For single table queries, we need to extract all items from the MultiSet
    const allItems: Array<any> = []
    for (const message of dataMessages) {
      const items = message.getInner().map(([item]: [any, number]) => item[1])
      allItems.push(...items)
    }
    return allItems
  }

  // Helper function to run a query with only users data
  const runUserQuery = (query: Query) => {
    // Compile the query
    const pipeline = compileQueryPipeline<any>(query, {
      users: usersInput as any,
    })

    // Create an output to collect the results
    const outputOp = output<any>((message) => {
      messages.push(message)
    })

    pipeline.pipe(outputOp)

    // Finalize the graph
    graph.finalize()

    // Send the sample data to the input
    usersInput.sendData(
      new MultiSet(sampleUsers.map((user) => [[user.id, user], 1]))
    )

    // Run the graph
    graph.run()

    return extractResults(messages)
  }

  // Helper function to run a query with both users and orders data
  const runJoinQuery = (query: Query) => {
    // Compile the query
    const pipeline = compileQueryPipeline<any>(query, {
      users: usersInput as any,
      orders: ordersInput as any,
    })

    // Create an output to collect the results
    const outputOp = output<any>((message) => {
      messages.push(message)
    })

    pipeline.pipe(outputOp)

    // Finalize the graph
    graph.finalize()

    usersInput.sendData(
      new MultiSet(sampleUsers.map((user) => [[user.id, user], 1]))
    )

    ordersInput.sendData(
      new MultiSet(sampleOrders.map((order) => [[order.id, order], 1]))
    )

    // Run the graph
    graph.run()

    return extractResults(messages)
  }

  test(`select * from single table`, () => {
    const query: Query<Context> = {
      select: [`@*`],
      from: `users`,
    }

    const results = runUserQuery(query)

    // Check that all users were returned with all their fields
    expect(results.length).toBe(sampleUsers.length)

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      const user = sampleUsers[i]

      expect(result).toEqual(user)
      expect(Object.keys(result)).toEqual([
        `id`,
        `name`,
        `age`,
        `email`,
        `active`,
      ])
    }
  })

  test(`select table.* from single table`, () => {
    const query: Query<Context> = {
      select: [`@users.*`],
      from: `users`,
      as: `users`,
    }

    const results = runUserQuery(query)

    // Check that all users were returned with all their fields
    expect(results.length).toBe(sampleUsers.length)

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      const user = sampleUsers[i]

      expect(result).toEqual(user)
      expect(Object.keys(result)).toEqual([
        `id`,
        `name`,
        `age`,
        `email`,
        `active`,
      ])
    }
  })

  test(`select * from joined tables`, () => {
    const query: Query<Context> = {
      select: [`@*`],
      from: `users`,
      as: `u`,
      join: [
        {
          type: `inner`,
          from: `orders`,
          as: `o`,
          on: [`@u.id`, `=`, `@o.userId`],
        },
      ],
    }

    const results = runJoinQuery(query)

    // Check that we have the expected number of results (inner join)
    // Alice has 2 orders, Bob has 1 order, Charlie has 1 order
    expect(results.length).toBe(4)

    // Check that each result has all fields from both tables
    for (const result of results) {
      // Check that the result has all user fields and all order fields
      const expectedFields = [
        `id`,
        `name`,
        `age`,
        `email`,
        `active`, // User fields
        `userId`,
        `product`,
        `amount`,
        `date`, // Order fields (note: id is already included)
      ]

      for (const field of expectedFields) {
        expect(result).toHaveProperty(field)
      }

      // In the joined result, the id field is from the order and the userId field is from the order
      // We need to verify that the userId in the order matches a user id in our sample data
      const user = sampleUsers.find((u) => u.id === result.userId)
      expect(user).toBeDefined()

      // Also verify that the order exists in our sample data
      const order = sampleOrders.find((o) => o.id === result.id)
      expect(order).toBeDefined()
      expect(order?.userId).toBe(user?.id)
    }
  })

  test(`select u.* from joined tables`, () => {
    const query: Query<
      Context & {
        schema: {
          u: User
        }
      }
    > = {
      select: [`@u.*`],
      from: `users`,
      as: `u`,
      join: [
        {
          type: `inner`,
          from: `orders`,
          as: `o`,
          on: [`@u.id`, `=`, `@o.userId`],
        },
      ],
    }

    const results = runJoinQuery(query)

    // Check that we have the expected number of results (inner join)
    expect(results.length).toBe(4)

    // Check that each result has only user fields
    for (const result of results) {
      // Check that the result has only user fields
      const expectedFields = [`id`, `name`, `age`, `email`, `active`]
      expect(Object.keys(result).sort()).toEqual(expectedFields.sort())

      // Verify the user exists in our sample data
      const user = sampleUsers.find((u) => u.id === result.id)
      expect(user).toBeDefined()
      expect(result).toEqual(user)
    }
  })

  test(`select o.* from joined tables`, () => {
    const query: Query<
      Context & {
        schema: {
          o: Order
        }
      }
    > = {
      select: [`@o.*`],
      from: `users`,
      as: `u`,
      join: [
        {
          type: `inner`,
          from: `orders`,
          as: `o`,
          on: [`@u.id`, `=`, `@o.userId`],
        },
      ],
    }

    const results = runJoinQuery(query)

    // Check that we have the expected number of results (inner join)
    expect(results.length).toBe(4)

    // Check that each result has only order fields
    for (const result of results) {
      // Check that the result has only order fields
      const expectedFields = [`id`, `userId`, `product`, `amount`, `date`]
      expect(Object.keys(result).sort()).toEqual(expectedFields.sort())

      // Verify the order exists in our sample data
      const order = sampleOrders.find((o) => o.id === result.id)
      expect(order).toBeDefined()
      expect(result).toEqual(order)
    }
  })

  test(`mix of wildcard and specific columns`, () => {
    const query: Query<
      Context & {
        schema: {
          u: User
          o: Order
        }
      }
    > = {
      select: [`@u.*`, { order_id: `@o.id` }],
      from: `users`,
      as: `u`,
      join: [
        {
          type: `inner`,
          from: `orders`,
          as: `o`,
          on: [`@u.id`, `=`, `@o.userId`],
        },
      ],
    }

    const results = runJoinQuery(query)

    // Check that we have the expected number of results (inner join)
    expect(results.length).toBe(4)

    // Check that each result has all user fields plus the order_id field
    for (const result of results) {
      // Check that the result has all user fields plus order_id
      const expectedFields = [
        `id`,
        `name`,
        `age`,
        `email`,
        `active`,
        `order_id`,
      ]
      expect(Object.keys(result).sort()).toEqual(expectedFields.sort())

      // Verify the user exists in our sample data
      const user = sampleUsers.find((u) => u.id === result.id)
      expect(user).toBeDefined()

      // Verify the order exists and its ID matches the order_id field
      const order = sampleOrders.find((o) => o.id === result.order_id)
      expect(order).toBeDefined()
      expect(order?.userId).toBe(user?.id)
    }
  })
})

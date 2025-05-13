import { beforeEach, describe, expect, test } from "vitest"
import { D2, MessageType, MultiSet, output, v } from "@electric-sql/d2ts"
import { compileQueryPipeline } from "../../src/query/pipeline-compiler.js"
import type { Query } from "../../src/query/schema.js"

// Define a type for our test records
type OrderRecord = {
  order_id: number
  customer_id: number
  amount: number
  status: string
  date: Date
}

type Context = {
  baseSchema: {
    orders: OrderRecord
  }
  schema: {
    orders: OrderRecord
  }
}

type Result = [
  {
    customer_id: number
    status: string
    total_amount: number
    order_count: number
  },
  number,
]

describe(`D2QL GROUP BY`, () => {
  let graph: D2
  let ordersInput: ReturnType<D2[`newInput`]>
  let messages: Array<any> = []

  // Sample data for testing
  const orders: Array<OrderRecord> = [
    {
      order_id: 1,
      customer_id: 1,
      amount: 100,
      status: `completed`,
      date: new Date(`2023-01-01`),
    },
    {
      order_id: 2,
      customer_id: 1,
      amount: 200,
      status: `completed`,
      date: new Date(`2023-01-15`),
    },
    {
      order_id: 3,
      customer_id: 2,
      amount: 150,
      status: `pending`,
      date: new Date(`2023-01-20`),
    },
    {
      order_id: 4,
      customer_id: 2,
      amount: 300,
      status: `completed`,
      date: new Date(`2023-02-01`),
    },
    {
      order_id: 5,
      customer_id: 3,
      amount: 250,
      status: `pending`,
      date: new Date(`2023-02-10`),
    },
  ]

  beforeEach(() => {
    // Create a new graph for each test
    graph = new D2({ initialFrontier: v([0]) })
    ordersInput = graph.newInput<OrderRecord>()
    messages = []
  })

  // Helper function to run a query and get results
  const runQuery = (query: Query) => {
    // Compile the query
    const pipeline = compileQueryPipeline<any>(query, {
      orders: ordersInput as any,
    })

    // Create an output to collect the results
    const outputOp = output<any>((message) => {
      messages.push(message)
    })

    pipeline.pipe(outputOp)

    // Finalize the graph
    graph.finalize()

    // Send the sample data to the input
    for (const order of orders) {
      ordersInput.sendData(v([1]), new MultiSet([[order, 1]]))
    }

    // Close the input by sending a frontier update
    ordersInput.sendFrontier(v([2]))

    // Run the graph
    graph.run()

    return messages
  }

  test(`should group by a single column`, () => {
    const query: Query<Context> = {
      select: [
        `@customer_id`,
        { total_amount: { SUM: `@amount` } as any },
        { order_count: { COUNT: `@order_id` } as any },
      ],
      from: `orders`,
      groupBy: [`@customer_id`],
    }

    const messagesRet = runQuery(query)

    // Verify we got at least one data message
    const dataMessages = messagesRet.filter((m) => m.type === MessageType.DATA)
    expect(dataMessages.length).toBe(1)

    // Verify we got a frontier message
    const frontierMessages = messagesRet.filter(
      (m) => m.type === MessageType.FRONTIER
    )
    expect(frontierMessages.length).toBeGreaterThan(0)

    const result = dataMessages[0].data.collection.getInner()

    const expected = [
      [
        {
          customer_id: 1,
          total_amount: 300,
          order_count: 2,
        },
        1,
      ],
      [
        {
          customer_id: 2,
          total_amount: 450,
          order_count: 2,
        },
        1,
      ],
      [
        {
          customer_id: 3,
          total_amount: 250,
          order_count: 1,
        },
        1,
      ],
    ]

    expect(result).toEqual(expected)
  })

  test(`should group by multiple columns`, () => {
    const query: Query<Context> = {
      select: [
        `@customer_id`,
        `@status`,
        { total_amount: { SUM: `@amount` } as any },
        { order_count: { COUNT: `@order_id` } as any },
      ],
      from: `orders`,
      groupBy: [`@customer_id`, `@status`],
    }

    const messagesRet = runQuery(query)

    // Verify we got at least one data message
    const dataMessages = messagesRet.filter((m) => m.type === MessageType.DATA)
    expect(dataMessages.length).toBeGreaterThan(0)

    const result = dataMessages[0].data.collection.getInner() as Array<Result>

    const expected: Array<Result> = [
      [
        {
          customer_id: 1,
          status: `completed`,
          total_amount: 300,
          order_count: 2,
        },
        1,
      ],
      [
        {
          customer_id: 2,
          status: `completed`,
          total_amount: 300,
          order_count: 1,
        },
        1,
      ],
      [
        {
          customer_id: 2,
          status: `pending`,
          total_amount: 150,
          order_count: 1,
        },
        1,
      ],
      [
        {
          customer_id: 3,
          status: `pending`,
          total_amount: 250,
          order_count: 1,
        },
        1,
      ],
    ]

    result
      .sort((a, b) => a[0].customer_id - b[0].customer_id)
      .sort((a, b) => a[0].status.localeCompare(b[0].status))

    expect(result).toEqual(expected)
  })

  test(`should apply HAVING clause after grouping`, () => {
    const query: Query<
      Context & {
        schema: {
          orders: OrderRecord & {
            total_amount: number
            order_count: number
          }
        }
      }
    > = {
      select: [
        `@customer_id`,
        `@status`,
        { total_amount: { SUM: `@amount` } as any },
        { order_count: { COUNT: `@order_id` } as any },
      ],
      from: `orders`,
      groupBy: [`@customer_id`, `@status`],
      having: [{ col: `total_amount` }, `>`, 200],
    }

    const messagesRet = runQuery(query)

    // Verify we got at least one data message
    const dataMessages = messagesRet.filter((m) => m.type === MessageType.DATA)
    expect(dataMessages.length).toBeGreaterThan(0)

    const result = dataMessages[0].data.collection.getInner() as Array<Result>

    const expected: Array<Result> = [
      [
        {
          customer_id: 1,
          status: `completed`,
          total_amount: 300,
          order_count: 2,
        },
        1,
      ],
      [
        {
          customer_id: 2,
          status: `completed`,
          total_amount: 300,
          order_count: 1,
        },
        1,
      ],
      [
        {
          customer_id: 3,
          status: `pending`,
          total_amount: 250,
          order_count: 1,
        },
        1,
      ],
    ]

    result
      .sort((a, b) => a[0].customer_id - b[0].customer_id)
      .sort((a, b) => a[0].status.localeCompare(b[0].status))

    expect(result).toEqual(expected)
  })

  test(`should work with different aggregate functions`, () => {
    const query: Query<Context> = {
      select: [
        `@customer_id`,
        { total_amount: { SUM: `@amount` } as any },
        { avg_amount: { AVG: `@amount` } as any },
        { min_amount: { MIN: `@amount` } as any },
        { max_amount: { MAX: `@amount` } as any },
        { order_count: { COUNT: `@order_id` } as any },
      ],
      from: `orders`,
      groupBy: [`@customer_id`],
    }

    const messagesRet = runQuery(query)

    // Verify we got at least one data message
    const dataMessages = messagesRet.filter((m) => m.type === MessageType.DATA)
    expect(dataMessages.length).toBeGreaterThan(0)

    const result = dataMessages[0].data.collection.getInner() as Array<Result>

    const expected = [
      [
        {
          customer_id: 1,
          total_amount: 300,
          avg_amount: 150,
          min_amount: 100,
          max_amount: 200,
          order_count: 2,
        },
        1,
      ],
      [
        {
          customer_id: 2,
          total_amount: 450,
          avg_amount: 225,
          min_amount: 150,
          max_amount: 300,
          order_count: 2,
        },
        1,
      ],
      [
        {
          customer_id: 3,
          total_amount: 250,
          avg_amount: 250,
          min_amount: 250,
          max_amount: 250,
          order_count: 1,
        },
        1,
      ],
    ]

    // Sort by customer_id for consistent comparison
    result.sort((a, b) => a[0].customer_id - b[0].customer_id)

    expect(result).toEqual(expected)
  })

  test(`should work with WHERE and GROUP BY together`, () => {
    const query: Query<Context> = {
      select: [
        `@customer_id`,
        { total_amount: { SUM: `@amount` } as any },
        { order_count: { COUNT: `@order_id` } as any },
      ],
      from: `orders`,
      where: [`@status`, `=`, `completed`],
      groupBy: [`@customer_id`],
    }

    const messagesRet = runQuery(query)

    // Verify we got at least one data message
    const dataMessages = messagesRet.filter((m) => m.type === MessageType.DATA)
    expect(dataMessages.length).toBeGreaterThan(0)

    const result = dataMessages[0].data.collection.getInner() as Array<Result>

    const expected = [
      [
        {
          customer_id: 1,
          total_amount: 300,
          order_count: 2,
        },
        1,
      ],
      [
        {
          customer_id: 2,
          total_amount: 300,
          order_count: 1,
        },
        1,
      ],
    ]

    // Sort by customer_id for consistent comparison
    result.sort((a, b) => a[0].customer_id - b[0].customer_id)

    expect(result).toEqual(expected)
  })

  test(`should handle a single string in groupBy`, () => {
    const query: Query<Context> = {
      select: [
        `@status`,
        { total_amount: { SUM: `@amount` } as any },
        { order_count: { COUNT: `@order_id` } as any },
      ],
      from: `orders`,
      groupBy: `@status`, // Single string instead of array
    }

    const messagesRet = runQuery(query)

    // Verify we got at least one data message
    const dataMessages = messagesRet.filter((m) => m.type === MessageType.DATA)
    expect(dataMessages.length).toBeGreaterThan(0)

    const result = dataMessages[0].data.collection.getInner() as Array<Result>

    const expected = [
      [
        {
          status: `completed`,
          total_amount: 600,
          order_count: 3,
        },
        1,
      ],
      [
        {
          status: `pending`,
          total_amount: 400,
          order_count: 2,
        },
        1,
      ],
    ]

    // Sort by status for consistent comparison
    result.sort((a, b) => a[0].status.localeCompare(b[0].status))

    expect(result).toEqual(expected)
  })
})

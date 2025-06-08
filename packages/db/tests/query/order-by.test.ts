import { describe, expect, test } from "vitest"
import { D2, MessageType, MultiSet, output } from "@electric-sql/d2ts"
import { compileQueryPipeline } from "../../src/query/pipeline-compiler.js"
import type { Query } from "../../src/query/index.js"

type User = {
  id: number
  name: string
  age: number
}

type Input = {
  id: number
  value: string
}

type Context = {
  baseSchema: {
    users: User
    input: Input
  }
  schema: {
    users: User
    input: Input
  }
  default: `users`
}

describe(`Query`, () => {
  describe(`orderBy functionality`, () => {
    test(`error when using limit without orderBy`, () => {
      const query: Query<Context> = {
        select: [`@id`, `@name`, `@age`],
        from: `users`,
        limit: 1, // No orderBy clause
      }

      // Compiling the query should throw an error
      expect(() => {
        const graph = new D2({ initialFrontier: 0 })
        const input = graph.newInput<
          [
            number,
            {
              id: number
              name: string
              age: number
            },
          ]
        >()
        compileQueryPipeline(query, { users: input })
      }).toThrow(
        `LIMIT and OFFSET require an ORDER BY clause to ensure deterministic results`
      )
    })

    test(`error when using offset without orderBy`, () => {
      const query: Query<Context> = {
        select: [`@id`, `@name`, `@age`],
        from: `users`,
        offset: 1, // No orderBy clause
      }

      // Compiling the query should throw an error
      expect(() => {
        const graph = new D2({ initialFrontier: 0 })
        const input = graph.newInput<
          [
            number,
            {
              id: number
              name: string
              age: number
            },
          ]
        >()
        compileQueryPipeline(query, { users: input })
      }).toThrow(
        `LIMIT and OFFSET require an ORDER BY clause to ensure deterministic results`
      )
    })

    describe(`with no index`, () => {
      test(`initial results`, () => {
        const query: Query<Context> = {
          select: [`@id`, `@value`],
          from: `input`,
          orderBy: `@value`,
        }

        const graph = new D2({ initialFrontier: 0 })
        const input = graph.newInput<
          [
            number,
            {
              id: number
              value: string
            },
          ]
        >()
        let latestMessage: any = null

        const pipeline = compileQueryPipeline(query, { input })
        pipeline.pipe(
          output((message) => {
            if (message.type === MessageType.DATA) {
              latestMessage = message.data
            }
          })
        )

        graph.finalize()

        input.sendData(
          0,
          new MultiSet([
            [[1, { id: 1, value: `a` }], 1],
            [[2, { id: 2, value: `z` }], 1],
            [[3, { id: 3, value: `b` }], 1],
            [[4, { id: 4, value: `y` }], 1],
            [[5, { id: 5, value: `c` }], 1],
          ])
        )
        input.sendFrontier(1)

        graph.run()

        expect(latestMessage).not.toBeNull()

        const result = latestMessage.collection.getInner()

        expect(
          sortResults(result, (a, b) => a[1].value.localeCompare(b[1].value))
        ).toEqual([
          [[1, { id: 1, value: `a` }], 1],
          [[3, { id: 3, value: `b` }], 1],
          [[5, { id: 5, value: `c` }], 1],
          [[4, { id: 4, value: `y` }], 1],
          [[2, { id: 2, value: `z` }], 1],
        ])
      })

      test(`initial results with limit`, () => {
        const query: Query<Context> = {
          select: [`@id`, `@value`],
          from: `input`,
          orderBy: `@value`,
          limit: 3,
        }

        const graph = new D2({ initialFrontier: 0 })
        const input = graph.newInput<
          [
            number,
            {
              id: number
              value: string
            },
          ]
        >()
        let latestMessage: any = null

        const pipeline = compileQueryPipeline(query, { input })
        pipeline.pipe(
          output((message) => {
            if (message.type === MessageType.DATA) {
              latestMessage = message.data
            }
          })
        )

        graph.finalize()

        input.sendData(
          0,
          new MultiSet([
            [[1, { id: 1, value: `a` }], 1],
            [[2, { id: 2, value: `z` }], 1],
            [[3, { id: 3, value: `b` }], 1],
            [[4, { id: 4, value: `y` }], 1],
            [[5, { id: 5, value: `c` }], 1],
          ])
        )
        input.sendFrontier(1)

        graph.run()

        expect(latestMessage).not.toBeNull()

        const result = latestMessage.collection.getInner()

        expect(
          sortResults(result, (a, b) => a[1].value.localeCompare(b[1].value))
        ).toEqual([
          [[1, { id: 1, value: `a` }], 1],
          [[3, { id: 3, value: `b` }], 1],
          [[5, { id: 5, value: `c` }], 1],
        ])
      })

      test(`initial results with limit and offset`, () => {
        const query: Query<Context> = {
          select: [`@id`, `@value`],
          from: `input`,
          orderBy: `@value`,
          limit: 2,
          offset: 2,
        }

        const graph = new D2({ initialFrontier: 0 })
        const input = graph.newInput<
          [
            number,
            {
              id: number
              value: string
            },
          ]
        >()
        let latestMessage: any = null

        const pipeline = compileQueryPipeline(query, { input })
        pipeline.pipe(
          output((message) => {
            if (message.type === MessageType.DATA) {
              latestMessage = message.data
            }
          })
        )

        graph.finalize()

        input.sendData(
          0,
          new MultiSet([
            [[1, { id: 1, value: `a` }], 1],
            [[2, { id: 2, value: `z` }], 1],
            [[3, { id: 3, value: `b` }], 1],
            [[4, { id: 4, value: `y` }], 1],
            [[5, { id: 5, value: `c` }], 1],
          ])
        )
        input.sendFrontier(1)

        graph.run()

        expect(latestMessage).not.toBeNull()

        const result = latestMessage.collection.getInner()

        expect(
          sortResults(result, (a, b) => a[1].value.localeCompare(b[1].value))
        ).toEqual([
          [[5, { id: 5, value: `c` }], 1],
          [[4, { id: 4, value: `y` }], 1],
        ])
      })

      test(`incremental update - adding new rows`, () => {
        const query: Query<Context> = {
          select: [`@id`, `@value`],
          from: `input`,
          orderBy: `@value`,
        }

        const graph = new D2({ initialFrontier: 0 })
        const input = graph.newInput<
          [
            number,
            {
              id: number
              value: string
            },
          ]
        >()
        let latestMessage: any = null

        const pipeline = compileQueryPipeline(query, { input })
        pipeline.pipe(
          output((message) => {
            if (message.type === MessageType.DATA) {
              latestMessage = message.data
            }
          })
        )

        graph.finalize()

        // Initial data
        input.sendData(
          0,
          new MultiSet([
            [[1, { id: 1, value: `c` }], 1],
            [[2, { id: 2, value: `d` }], 1],
            [[3, { id: 3, value: `e` }], 1],
          ])
        )
        input.sendFrontier(1)
        graph.run()

        // Initial result should be all three items in alphabetical order
        let result = latestMessage.collection.getInner()
        expect(
          sortResults(result, (a, b) => a[1].value.localeCompare(b[1].value))
        ).toEqual([
          [[1, { id: 1, value: `c` }], 1],
          [[2, { id: 2, value: `d` }], 1],
          [[3, { id: 3, value: `e` }], 1],
        ])

        // Add new rows that should appear in the result
        input.sendData(
          1,
          new MultiSet([
            [[4, { id: 4, value: `a` }], 1],
            [[5, { id: 5, value: `b` }], 1],
          ])
        )
        input.sendFrontier(2)
        graph.run()

        // Result should now include the new rows in the correct order
        result = latestMessage.collection.getInner()

        const expectedResult = [
          [[4, { id: 4, value: `a` }], 1],
          [[5, { id: 5, value: `b` }], 1],
        ]

        expect(
          sortResults(result, (a, b) => a[1].value.localeCompare(b[1].value))
        ).toEqual(expectedResult)
      })

      test(`incremental update - removing rows`, () => {
        const query: Query<Context> = {
          select: [`@id`, `@value`],
          from: `input`,
          orderBy: `@value`,
        }

        const graph = new D2({ initialFrontier: 0 })
        const input = graph.newInput<
          [
            number,
            {
              id: number
              value: string
            },
          ]
        >()
        let latestMessage: any = null

        const pipeline = compileQueryPipeline(query, { input })
        pipeline.pipe(
          output((message) => {
            if (message.type === MessageType.DATA) {
              latestMessage = message.data
            }
          })
        )

        graph.finalize()

        // Initial data
        input.sendData(
          0,
          new MultiSet([
            [[1, { id: 1, value: `a` }], 1],
            [[2, { id: 2, value: `b` }], 1],
            [[3, { id: 3, value: `c` }], 1],
            [[4, { id: 4, value: `d` }], 1],
          ])
        )
        input.sendFrontier(1)
        graph.run()

        // Initial result should be all four items
        let result = latestMessage.collection.getInner()
        expect(
          sortResults(result, (a, b) => a[1].value.localeCompare(b[1].value))
        ).toEqual([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
        ])

        // Remove 'b' from the result set
        input.sendData(1, new MultiSet([[[2, { id: 2, value: `b` }], -1]]))
        input.sendFrontier(2)
        graph.run()

        // Result should show 'b' being removed
        result = latestMessage.collection.getInner()

        const expectedResult = [[[2, { id: 2, value: `b` }], -1]]

        expect(
          sortResults(result, (a, b) => a[1].value.localeCompare(b[1].value))
        ).toEqual(expectedResult)
      })
    })
    describe(`with numeric index`, () => {
      test(`initial results`, () => {
        const query: Query<Context> = {
          select: [`@id`, `@value`, { index: { ORDER_INDEX: `numeric` } }],
          from: `input`,
          orderBy: `@value`,
        }

        const graph = new D2({ initialFrontier: 0 })
        const input = graph.newInput<
          [
            number,
            {
              id: number
              value: string
            },
          ]
        >()
        let latestMessage: any = null

        const pipeline = compileQueryPipeline(query, { input })
        pipeline.pipe(
          output((message) => {
            if (message.type === MessageType.DATA) {
              latestMessage = message.data
            }
          })
        )

        graph.finalize()

        input.sendData(
          0,
          new MultiSet([
            [[1, { id: 1, value: `a` }], 1],
            [[2, { id: 2, value: `z` }], 1],
            [[3, { id: 3, value: `b` }], 1],
            [[4, { id: 4, value: `y` }], 1],
            [[5, { id: 5, value: `c` }], 1],
          ])
        )
        input.sendFrontier(1)

        graph.run()

        expect(latestMessage).not.toBeNull()

        const result = latestMessage.collection.getInner()

        expect(
          sortResults(result, (a, b) => a[1].value.localeCompare(b[1].value))
        ).toEqual([
          [[1, { id: 1, value: `a`, index: 0 }], 1],
          [[3, { id: 3, value: `b`, index: 1 }], 1],
          [[5, { id: 5, value: `c`, index: 2 }], 1],
          [[4, { id: 4, value: `y`, index: 3 }], 1],
          [[2, { id: 2, value: `z`, index: 4 }], 1],
        ])
      })

      test(`initial results with limit`, () => {
        const query: Query<Context> = {
          select: [`@id`, `@value`, { index: { ORDER_INDEX: `numeric` } }],
          from: `input`,
          orderBy: `@value`,
          limit: 3,
        }

        const graph = new D2({ initialFrontier: 0 })
        const input = graph.newInput<
          [
            number,
            {
              id: number
              value: string
            },
          ]
        >()
        let latestMessage: any = null

        const pipeline = compileQueryPipeline(query, { input })
        pipeline.pipe(
          output((message) => {
            if (message.type === MessageType.DATA) {
              latestMessage = message.data
            }
          })
        )

        graph.finalize()

        input.sendData(
          0,
          new MultiSet([
            [[1, { id: 1, value: `a` }], 1],
            [[2, { id: 2, value: `z` }], 1],
            [[3, { id: 3, value: `b` }], 1],
            [[4, { id: 4, value: `y` }], 1],
            [[5, { id: 5, value: `c` }], 1],
          ])
        )
        input.sendFrontier(1)

        graph.run()

        expect(latestMessage).not.toBeNull()

        const result = latestMessage.collection.getInner()

        expect(
          sortResults(result, (a, b) => a[1].value.localeCompare(b[1].value))
        ).toEqual([
          [[1, { id: 1, value: `a`, index: 0 }], 1],
          [[3, { id: 3, value: `b`, index: 1 }], 1],
          [[5, { id: 5, value: `c`, index: 2 }], 1],
        ])
      })

      test(`initial results with limit and offset`, () => {
        const query: Query<Context> = {
          select: [`@id`, `@value`, { index: { ORDER_INDEX: `numeric` } }],
          from: `input`,
          orderBy: `@value`,
          limit: 2,
          offset: 2,
        }

        const graph = new D2({ initialFrontier: 0 })
        const input = graph.newInput<
          [
            number,
            {
              id: number
              value: string
            },
          ]
        >()
        let latestMessage: any = null

        const pipeline = compileQueryPipeline(query, { input })
        pipeline.pipe(
          output((message) => {
            if (message.type === MessageType.DATA) {
              latestMessage = message.data
            }
          })
        )

        graph.finalize()

        input.sendData(
          0,
          new MultiSet([
            [[1, { id: 1, value: `a` }], 1],
            [[2, { id: 2, value: `z` }], 1],
            [[3, { id: 3, value: `b` }], 1],
            [[4, { id: 4, value: `y` }], 1],
            [[5, { id: 5, value: `c` }], 1],
          ])
        )
        input.sendFrontier(1)

        graph.run()

        expect(latestMessage).not.toBeNull()

        const result = latestMessage.collection.getInner()

        expect(
          sortResults(result, (a, b) => a[1].value.localeCompare(b[1].value))
        ).toEqual([
          [[5, { id: 5, value: `c`, index: 2 }], 1],
          [[4, { id: 4, value: `y`, index: 3 }], 1],
        ])
      })

      test(`incremental update - adding new rows`, () => {
        const query: Query<Context> = {
          select: [`@id`, `@value`, { index: { ORDER_INDEX: `numeric` } }],
          from: `input`,
          orderBy: `@value`,
        }

        const graph = new D2({ initialFrontier: 0 })
        const input = graph.newInput<
          [
            number,
            {
              id: number
              value: string
            },
          ]
        >()
        let latestMessage: any = null

        const pipeline = compileQueryPipeline(query, { input })
        pipeline.pipe(
          output((message) => {
            if (message.type === MessageType.DATA) {
              latestMessage = message.data
            }
          })
        )

        graph.finalize()

        // Initial data
        input.sendData(
          0,
          new MultiSet([
            [[1, { id: 1, value: `c` }], 1],
            [[2, { id: 2, value: `d` }], 1],
            [[3, { id: 3, value: `e` }], 1],
          ])
        )
        input.sendFrontier(1)
        graph.run()

        // Initial result should be all three items in alphabetical order
        let result = latestMessage.collection.getInner()
        expect(
          sortResults(result, (a, b) => a[1].value.localeCompare(b[1].value))
        ).toEqual([
          [[1, { id: 1, value: `c`, index: 0 }], 1],
          [[2, { id: 2, value: `d`, index: 1 }], 1],
          [[3, { id: 3, value: `e`, index: 2 }], 1],
        ])

        // Add new rows that should appear in the result
        input.sendData(
          1,
          new MultiSet([
            [[4, { id: 4, value: `a` }], 1],
            [[5, { id: 5, value: `b` }], 1],
          ])
        )
        input.sendFrontier(2)
        graph.run()

        // Result should now include the new rows in the correct order
        result = latestMessage.collection.getInner()

        const expectedResult = [
          [[4, { id: 4, value: `a`, index: 0 }], 1],
          [[5, { id: 5, value: `b`, index: 1 }], 1],
          [[1, { id: 1, value: `c`, index: 0 }], -1],
          [[1, { id: 1, value: `c`, index: 2 }], 1],
          [[2, { id: 2, value: `d`, index: 1 }], -1],
          [[2, { id: 2, value: `d`, index: 3 }], 1],
          [[3, { id: 3, value: `e`, index: 2 }], -1],
          [[3, { id: 3, value: `e`, index: 4 }], 1],
        ]

        expect(
          sortResults(result, (a, b) => a[1].value.localeCompare(b[1].value))
        ).toEqual(expectedResult)
      })

      test(`incremental update - removing rows`, () => {
        const query: Query<Context> = {
          select: [`@id`, `@value`, { index: { ORDER_INDEX: `numeric` } }],
          from: `input`,
          orderBy: `@value`,
        }

        const graph = new D2({ initialFrontier: 0 })
        const input = graph.newInput<
          [
            number,
            {
              id: number
              value: string
            },
          ]
        >()
        let latestMessage: any = null

        const pipeline = compileQueryPipeline(query, { input })
        pipeline.pipe(
          output((message) => {
            if (message.type === MessageType.DATA) {
              latestMessage = message.data
            }
          })
        )

        graph.finalize()

        // Initial data
        input.sendData(
          0,
          new MultiSet([
            [[1, { id: 1, value: `a` }], 1],
            [[2, { id: 2, value: `b` }], 1],
            [[3, { id: 3, value: `c` }], 1],
            [[4, { id: 4, value: `d` }], 1],
          ])
        )
        input.sendFrontier(1)
        graph.run()

        // Initial result should be all four items
        let result = latestMessage.collection.getInner()
        expect(
          sortResults(result, (a, b) => a[1].value.localeCompare(b[1].value))
        ).toEqual([
          [[1, { id: 1, value: `a`, index: 0 }], 1],
          [[2, { id: 2, value: `b`, index: 1 }], 1],
          [[3, { id: 3, value: `c`, index: 2 }], 1],
          [[4, { id: 4, value: `d`, index: 3 }], 1],
        ])

        // Remove 'b' from the result set
        input.sendData(1, new MultiSet([[[2, { id: 2, value: `b` }], -1]]))
        input.sendFrontier(2)
        graph.run()

        // Result should show 'b' being removed and indices adjusted
        result = latestMessage.collection.getInner()

        const expectedResult = [
          [[2, { id: 2, value: `b`, index: 1 }], -1],
          [[3, { id: 3, value: `c`, index: 2 }], -1],
          [[3, { id: 3, value: `c`, index: 1 }], 1],
          [[4, { id: 4, value: `d`, index: 3 }], -1],
          [[4, { id: 4, value: `d`, index: 2 }], 1],
        ]

        expect(
          sortResults(result, (a, b) => a[1].value.localeCompare(b[1].value))
        ).toEqual(expectedResult)
      })
    })
    describe(`with fractional index`, () => {
      test(`initial results`, () => {
        const query: Query<Context> = {
          select: [`@id`, `@value`, { index: { ORDER_INDEX: `fractional` } }],
          from: `input`,
          orderBy: `@value`,
        }

        const graph = new D2({ initialFrontier: 0 })
        const input = graph.newInput<
          [
            number,
            {
              id: number
              value: string
            },
          ]
        >()
        let latestMessage: any = null

        const pipeline = compileQueryPipeline(query, { input })
        pipeline.pipe(
          output((message) => {
            if (message.type === MessageType.DATA) {
              latestMessage = message.data
            }
          })
        )

        graph.finalize()

        input.sendData(
          0,
          new MultiSet([
            [[1, { id: 1, value: `a` }], 1],
            [[2, { id: 2, value: `z` }], 1],
            [[3, { id: 3, value: `b` }], 1],
            [[4, { id: 4, value: `y` }], 1],
            [[5, { id: 5, value: `c` }], 1],
          ])
        )
        input.sendFrontier(1)

        graph.run()

        expect(latestMessage).not.toBeNull()

        const result = latestMessage.collection.getInner()

        expect(
          sortResults(result, (a, b) => a[1].value.localeCompare(b[1].value))
        ).toEqual([
          [[1, { id: 1, value: `a`, index: `a0` }], 1],
          [[3, { id: 3, value: `b`, index: `a1` }], 1],
          [[5, { id: 5, value: `c`, index: `a2` }], 1],
          [[4, { id: 4, value: `y`, index: `a3` }], 1],
          [[2, { id: 2, value: `z`, index: `a4` }], 1],
        ])
      })

      test(`initial results with limit`, () => {
        const query: Query<Context> = {
          select: [`@id`, `@value`, { index: { ORDER_INDEX: `fractional` } }],
          from: `input`,
          orderBy: `@value`,
          limit: 3,
        }

        const graph = new D2({ initialFrontier: 0 })
        const input = graph.newInput<
          [
            number,
            {
              id: number
              value: string
            },
          ]
        >()
        let latestMessage: any = null

        const pipeline = compileQueryPipeline(query, { input })
        pipeline.pipe(
          output((message) => {
            if (message.type === MessageType.DATA) {
              latestMessage = message.data
            }
          })
        )

        graph.finalize()

        input.sendData(
          0,
          new MultiSet([
            [[1, { id: 1, value: `a` }], 1],
            [[2, { id: 2, value: `z` }], 1],
            [[3, { id: 3, value: `b` }], 1],
            [[4, { id: 4, value: `y` }], 1],
            [[5, { id: 5, value: `c` }], 1],
          ])
        )
        input.sendFrontier(1)

        graph.run()

        expect(latestMessage).not.toBeNull()

        const result = latestMessage.collection.getInner()

        expect(
          sortResults(result, (a, b) => a[1].value.localeCompare(b[1].value))
        ).toEqual([
          [[1, { id: 1, value: `a`, index: `a0` }], 1],
          [[3, { id: 3, value: `b`, index: `a1` }], 1],
          [[5, { id: 5, value: `c`, index: `a2` }], 1],
        ])
      })

      test(`initial results with limit and offset`, () => {
        const query: Query<Context> = {
          select: [`@id`, `@value`, { index: { ORDER_INDEX: `fractional` } }],
          from: `input`,
          orderBy: `@value`,
          limit: 2,
          offset: 2,
        }

        const graph = new D2({ initialFrontier: 0 })
        const input = graph.newInput<
          [
            number,
            {
              id: number
              value: string
            },
          ]
        >()
        let latestMessage: any = null

        const pipeline = compileQueryPipeline(query, { input })
        pipeline.pipe(
          output((message) => {
            if (message.type === MessageType.DATA) {
              latestMessage = message.data
            }
          })
        )

        graph.finalize()

        input.sendData(
          0,
          new MultiSet([
            [[1, { id: 1, value: `a` }], 1],
            [[2, { id: 2, value: `z` }], 1],
            [[3, { id: 3, value: `b` }], 1],
            [[4, { id: 4, value: `y` }], 1],
            [[5, { id: 5, value: `c` }], 1],
          ])
        )
        input.sendFrontier(1)

        graph.run()

        expect(latestMessage).not.toBeNull()

        const result = latestMessage.collection.getInner()

        expect(
          sortResults(result, (a, b) => a[1].value.localeCompare(b[1].value))
        ).toEqual([
          [[5, { id: 5, value: `c`, index: `a0` }], 1],
          [[4, { id: 4, value: `y`, index: `a1` }], 1],
        ])
      })

      test(`incremental update - adding new rows`, () => {
        const query: Query<Context> = {
          select: [`@id`, `@value`, { index: { ORDER_INDEX: `fractional` } }],
          from: `input`,
          orderBy: `@value`,
        }

        const graph = new D2({ initialFrontier: 0 })
        const input = graph.newInput<
          [
            number,
            {
              id: number
              value: string
            },
          ]
        >()
        let latestMessage: any = null

        const pipeline = compileQueryPipeline(query, { input })
        pipeline.pipe(
          output((message) => {
            if (message.type === MessageType.DATA) {
              latestMessage = message.data
            }
          })
        )

        graph.finalize()

        // Initial data
        input.sendData(
          0,
          new MultiSet([
            [[1, { id: 1, value: `c` }], 1],
            [[2, { id: 2, value: `d` }], 1],
            [[3, { id: 3, value: `e` }], 1],
          ])
        )
        input.sendFrontier(1)
        graph.run()

        // Initial result should be all three items in alphabetical order
        let result = latestMessage.collection.getInner()
        expect(
          sortResults(result, (a, b) => a[1].value.localeCompare(b[1].value))
        ).toEqual([
          [[1, { id: 1, value: `c`, index: `a0` }], 1],
          [[2, { id: 2, value: `d`, index: `a1` }], 1],
          [[3, { id: 3, value: `e`, index: `a2` }], 1],
        ])

        // Add new rows that should appear in the result
        input.sendData(
          1,
          new MultiSet([
            [[4, { id: 4, value: `a` }], 1],
            [[5, { id: 5, value: `b` }], 1],
          ])
        )
        input.sendFrontier(2)
        graph.run()

        // Result should now include the new rows in the correct order
        result = latestMessage.collection.getInner()
        const expectedResult = [
          [[4, { id: 4, value: `a`, index: `Zz` }], 1],
          [[5, { id: 5, value: `b`, index: `ZzV` }], 1],
        ]

        expect(
          sortResults(result, (a, b) => a[1].value.localeCompare(b[1].value))
        ).toEqual(expectedResult)
      })

      test(`incremental update - removing rows`, () => {
        const query: Query<Context> = {
          select: [`@id`, `@value`, { index: { ORDER_INDEX: `fractional` } }],
          from: `input`,
          orderBy: `@value`,
        }

        const graph = new D2({ initialFrontier: 0 })
        const input = graph.newInput<
          [
            number,
            {
              id: number
              value: string
            },
          ]
        >()
        let latestMessage: any = null

        const pipeline = compileQueryPipeline(query, { input })
        pipeline.pipe(
          output((message) => {
            if (message.type === MessageType.DATA) {
              latestMessage = message.data
            }
          })
        )

        graph.finalize()

        // Initial data
        input.sendData(
          0,
          new MultiSet([
            [[1, { id: 1, value: `a` }], 1],
            [[2, { id: 2, value: `b` }], 1],
            [[3, { id: 3, value: `c` }], 1],
            [[4, { id: 4, value: `d` }], 1],
          ])
        )
        input.sendFrontier(1)
        graph.run()

        // Initial result should be all four items
        let result = latestMessage.collection.getInner() as Array<[any, number]>

        // Verify initial state
        const initialRows = result.filter(
          ([_, multiplicity]) => multiplicity === 1
        )
        expect(initialRows.length).toBe(4)

        // Remove 'b' from the result set
        input.sendData(1, new MultiSet([[[2, { id: 2, value: `b` }], -1]]))
        input.sendFrontier(2)
        graph.run()

        // Result should show 'b' being removed
        result = latestMessage.collection.getInner()
        const expectedResult = [[[2, { id: 2, value: `b`, index: `a1` }], -1]]

        expect(
          sortResults(result, (a, b) => a[1].value.localeCompare(b[1].value))
        ).toEqual(expectedResult)
      })
    })
  })
})

/**
 * Sort results by multiplicity and then key
 */
function sortResults(
  results: Array<[value: any, multiplicity: number]>,
  comparator: (a: any, b: any) => number
) {
  return [...results]
    .sort(
      ([_aValue, aMultiplicity], [_bValue, bMultiplicity]) =>
        aMultiplicity - bMultiplicity
    )
    .sort(([aValue, _aMultiplicity], [bValue, _bMultiplicity]) =>
      comparator(aValue, bValue)
    )
}

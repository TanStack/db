import { afterEach, describe, expect, test, vi } from 'vitest'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import {
  createAggregate,
  getRegisteredAggregates,
  registerAggregate,
  unregisterAggregate,
} from '../../src/query/aggregates.js'
import { Aggregate } from '../../src/query/ir.js'
import { toExpression } from '../../src/query/builder/ref-proxy.js'
import { count, gt, sum, upper } from '../../src/query/builder/functions.js'
import {
  NonConstantAggregateArgumentError,
  UnsupportedAggregateFunctionError,
} from '../../src/errors.js'
import { mockSyncCollectionOptions } from '../utils.js'
import type {
  AggregateContext,
  AggregateEntry,
} from '../../src/query/aggregates.js'

type Todo = {
  id: number
  listId: number
  text: string
  points: number
}

const sampleTodos: Array<Todo> = [
  { id: 1, listId: 1, text: `alpha`, points: 1 },
  { id: 2, listId: 1, text: `beta`, points: 2 },
  { id: 3, listId: 1, text: `alpha`, points: 3 },
  { id: 4, listId: 2, text: `gamma`, points: 4 },
]

function createTodosCollection(id = `custom-agg-todos`) {
  return createCollection(
    mockSyncCollectionOptions<Todo>({
      id,
      getKey: (todo) => todo.id,
      initialData: sampleTodos,
      autoIndex: `eager`,
    }),
  )
}

/**
 * Deterministic group_concat: pairs each value with its row key so rows are never
 * consolidated by hash, then sorts by row key before joining.
 */
function groupConcatImpl(ctx: AggregateContext, separator: string) {
  return {
    preMap: (entry: AggregateEntry): [string, string] => [
      ctx.key(entry),
      String(ctx.value(entry) ?? ``),
    ],
    reduce: (values: Array<[[string, string], number]>) => {
      const parts: Array<[string, string]> = []
      for (const [[key, text], multiplicity] of values) {
        for (let i = 0; i < multiplicity; i++) {
          parts.push([key, text])
        }
      }
      parts.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      return parts.map(([, text]) => text).join(separator)
    },
  }
}

const registeredInTest = new Set<string>()

function register(
  name: string,
  factory: Parameters<typeof registerAggregate>[1],
): void {
  registeredInTest.add(name.toLowerCase())
  registerAggregate(name, factory)
}

afterEach(() => {
  for (const name of registeredInTest) {
    unregisterAggregate(name)
  }
  registeredInTest.clear()
  vi.restoreAllMocks()
})

describe(`custom aggregate functions`, () => {
  describe(`registry`, () => {
    test(`register, list and unregister`, () => {
      expect(getRegisteredAggregates().has(`my_agg`)).toBe(false)

      register(`my_agg`, (ctx: AggregateContext) => ({
        preMap: (entry: AggregateEntry) => ctx.value(entry),
        reduce: (values: Array<[unknown, number]>) => values.length,
      }))

      expect(getRegisteredAggregates().has(`my_agg`)).toBe(true)
      expect(unregisterAggregate(`my_agg`)).toBe(true)
      expect(unregisterAggregate(`my_agg`)).toBe(false)
      expect(getRegisteredAggregates().has(`my_agg`)).toBe(false)
    })

    test(`names are case-insensitive`, () => {
      register(`MixedCase`, (ctx: AggregateContext) => ({
        preMap: (entry: AggregateEntry) => ctx.value(entry),
        reduce: () => 0,
      }))

      expect(getRegisteredAggregates().has(`mixedcase`)).toBe(true)
      expect(unregisterAggregate(`MIXEDCASE`)).toBe(true)
    })

    test(`compiler lookup normalizes the aggregate name`, () => {
      register(`MixedCaseSum`, (ctx: AggregateContext) => ({
        preMap: (entry: AggregateEntry) => Number(ctx.value(entry)),
        reduce: (values: Array<[number, number]>) =>
          values.reduce((acc, [value, multiplicity]) => {
            return acc + value * multiplicity
          }, 0),
      }))

      const todos = createTodosCollection(`custom-agg-todos-case`)
      const result = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ todo: todos })
            .groupBy(({ todo }) => todo.listId)
            .select(({ todo }) => ({
              listId: todo.listId,
              // Registered as `MixedCaseSum`, referenced here in lower case
              total: new Aggregate<number>(`mixedcasesum`, [
                toExpression(todo.points),
              ]),
            })),
      })

      expect(result.get(1)?.total).toBe(6)
      expect(result.get(2)?.total).toBe(4)
    })

    test(`getRegisteredAggregates returns a snapshot, not a live view`, () => {
      const before = getRegisteredAggregates()
      register(`snapshot_agg`, () => ({
        preMap: () => 0,
        reduce: () => 0,
      }))

      expect(before.has(`snapshot_agg`)).toBe(false)
      expect(getRegisteredAggregates().has(`snapshot_agg`)).toBe(true)
    })

    test(`re-registering an existing custom aggregate warns`, () => {
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const impl = () => ({ preMap: () => 0, reduce: () => 0 })

      register(`dup_agg`, impl)
      expect(warn).not.toHaveBeenCalled()

      register(`dup_agg`, impl)
      expect(warn).toHaveBeenCalledOnce()
      expect(warn.mock.calls[0]![0]).toContain(`replaces an existing custom`)
    })

    test(`overriding a built-in warns`, () => {
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})

      register(`sum`, (ctx: AggregateContext) => ({
        preMap: (entry: AggregateEntry) => Number(ctx.value(entry)),
        reduce: () => 0,
      }))

      expect(warn).toHaveBeenCalledOnce()
      expect(warn.mock.calls[0]![0]).toContain(`overrides the built-in`)
    })
  })

  describe(`queries`, () => {
    test(`group_concat with a custom separator`, () => {
      const groupConcat = createAggregate<string, [separator?: string]>(
        `group_concat`,
        (ctx, [separator = `,`]) => groupConcatImpl(ctx, separator),
      )
      registeredInTest.add(`group_concat`)

      const todos = createTodosCollection()
      const result = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ todo: todos })
            .groupBy(({ todo }) => todo.listId)
            .select(({ todo }) => ({
              listId: todo.listId,
              names: groupConcat(todo.text, ` | `),
            })),
      })

      // Duplicate values ("alpha" twice) are preserved, ordered by row key
      expect(result.get(1)?.names).toBe(`alpha | beta | alpha`)
      expect(result.get(2)?.names).toBe(`gamma`)
    })

    test(`default parameter value is used when omitted`, () => {
      const groupConcat = createAggregate<string, [separator?: string]>(
        `group_concat_default`,
        (ctx, [separator = `,`]) => groupConcatImpl(ctx, separator),
      )
      registeredInTest.add(`group_concat_default`)

      const todos = createTodosCollection()
      const result = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ todo: todos })
            .groupBy(({ todo }) => todo.listId)
            .select(({ todo }) => ({
              listId: todo.listId,
              names: groupConcat(todo.text),
            })),
      })

      expect(result.get(1)?.names).toBe(`alpha,beta,alpha`)
    })

    test(`multiplicity is reported for consolidated duplicate values`, () => {
      // preMap ignores the row key, so identical values consolidate
      const distinctCount = createAggregate<number>(
        `distinct_count`,
        (ctx) => ({
          preMap: (entry) => ctx.value(entry),
          reduce: (values) =>
            values.filter(([, multiplicity]) => multiplicity > 0).length,
        }),
      )
      const totalCount = createAggregate<number>(`total_count`, (ctx) => ({
        preMap: (entry) => ctx.value(entry),
        reduce: (values) =>
          values.reduce((acc, [, multiplicity]) => acc + multiplicity, 0),
      }))
      registeredInTest.add(`distinct_count`)
      registeredInTest.add(`total_count`)

      const todos = createTodosCollection()
      const result = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ todo: todos })
            .groupBy(({ todo }) => todo.listId)
            .select(({ todo }) => ({
              listId: todo.listId,
              distinct: distinctCount(todo.text),
              total: totalCount(todo.text),
            })),
      })

      // list 1 has alpha, beta, alpha
      expect(result.get(1)?.distinct).toBe(2)
      expect(result.get(1)?.total).toBe(3)
    })

    test(`postMap transforms the reduced value`, () => {
      const range = createAggregate<string>(`points_range`, (ctx) => ({
        preMap: (entry) => {
          const value = Number(ctx.value(entry))
          return [value, value] as [number, number]
        },
        reduce: (values) => {
          let low = Infinity
          let high = -Infinity
          for (const [[min, max], multiplicity] of values) {
            if (multiplicity <= 0) continue
            low = Math.min(low, min)
            high = Math.max(high, max)
          }
          return [low, high] as [number, number]
        },
        postMap: ([low, high]) => `${low}-${high}`,
      }))
      registeredInTest.add(`points_range`)

      const todos = createTodosCollection()
      const result = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ todo: todos })
            .groupBy(({ todo }) => todo.listId)
            .select(({ todo }) => ({
              listId: todo.listId,
              range: range(todo.points),
            })),
      })

      expect(result.get(1)?.range).toBe(`1-3`)
      expect(result.get(2)?.range).toBe(`4-4`)
    })

    test(`aggregates the raw value without numeric coercion`, () => {
      const firstValue = createAggregate<unknown>(`first_value`, (ctx) => ({
        preMap: (entry) =>
          [ctx.key(entry), ctx.value(entry)] as [string, unknown],
        reduce: (values) => {
          const sorted = [...values]
            .filter(([, multiplicity]) => multiplicity > 0)
            .sort(([a], [b]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
          return sorted[0]?.[0][1]
        },
      }))
      registeredInTest.add(`first_value`)

      const todos = createTodosCollection()
      const result = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ todo: todos })
            .groupBy(({ todo }) => todo.listId)
            .select(({ todo }) => ({
              listId: todo.listId,
              first: firstValue(todo.text),
            })),
      })

      expect(result.get(1)?.first).toBe(`alpha`)
    })

    test(`the aggregated expression may be a computed function`, () => {
      const groupConcat = createAggregate<string, [separator?: string]>(
        `group_concat_expr`,
        (ctx, [separator = `,`]) => groupConcatImpl(ctx, separator),
      )
      registeredInTest.add(`group_concat_expr`)

      const todos = createTodosCollection()
      const result = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ todo: todos })
            .groupBy(({ todo }) => todo.listId)
            .select(({ todo }) => ({
              listId: todo.listId,
              names: groupConcat(upper(todo.text)),
            })),
      })

      expect(result.get(1)?.names).toBe(`ALPHA,BETA,ALPHA`)
    })
  })

  describe(`incremental updates`, () => {
    test(`recomputes on insert, update and delete`, () => {
      const groupConcat = createAggregate<string, [separator?: string]>(
        `group_concat_live`,
        (ctx, [separator = `,`]) => groupConcatImpl(ctx, separator),
      )
      registeredInTest.add(`group_concat_live`)

      const todos = createTodosCollection(`custom-agg-live`)
      const result = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ todo: todos })
            .groupBy(({ todo }) => todo.listId)
            .select(({ todo }) => ({
              listId: todo.listId,
              names: groupConcat(todo.text),
            })),
      })

      expect(result.get(1)?.names).toBe(`alpha,beta,alpha`)

      todos.utils.begin()
      todos.utils.write({
        type: `insert`,
        value: { id: 5, listId: 1, text: `delta`, points: 5 },
      })
      todos.utils.commit()
      expect(result.get(1)?.names).toBe(`alpha,beta,alpha,delta`)

      todos.utils.begin()
      todos.utils.write({
        type: `update`,
        value: { id: 2, listId: 1, text: `BETA`, points: 2 },
      })
      todos.utils.commit()
      expect(result.get(1)?.names).toBe(`alpha,BETA,alpha,delta`)

      todos.utils.begin()
      todos.utils.write({
        type: `delete`,
        value: { id: 3, listId: 1, text: `alpha`, points: 3 },
      })
      todos.utils.commit()
      expect(result.get(1)?.names).toBe(`alpha,BETA,delta`)

      // Removing the last row of a group removes the group
      todos.utils.begin()
      todos.utils.write({
        type: `delete`,
        value: { id: 4, listId: 2, text: `gamma`, points: 4 },
      })
      todos.utils.commit()
      expect(result.get(2)).toBeUndefined()
    })
  })

  describe(`integration with other clauses`, () => {
    test(`works in a HAVING clause`, () => {
      const totalPoints = createAggregate<number>(`total_points`, (ctx) => ({
        preMap: (entry) => [ctx.key(entry), Number(ctx.value(entry))] as const,
        reduce: (values) =>
          values.reduce(
            (acc, [[, points], multiplicity]) => acc + points * multiplicity,
            0,
          ),
      }))
      registeredInTest.add(`total_points`)

      const todos = createTodosCollection()
      const result = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ todo: todos })
            .groupBy(({ todo }) => todo.listId)
            .select(({ todo }) => ({
              listId: todo.listId,
              points: totalPoints(todo.points),
            }))
            .having(({ todo }) => gt(totalPoints(todo.points), 5)),
      })

      // list 1 => 6, list 2 => 4
      expect(result.size).toBe(1)
      expect(result.get(1)?.points).toBe(6)
    })

    test(`works nested inside an expression`, () => {
      const totalPoints = createAggregate<number>(`nested_points`, (ctx) => ({
        preMap: (entry) => [ctx.key(entry), Number(ctx.value(entry))] as const,
        reduce: (values) =>
          values.reduce(
            (acc, [[, points], multiplicity]) => acc + points * multiplicity,
            0,
          ),
      }))
      registeredInTest.add(`nested_points`)

      const todos = createTodosCollection()
      const result = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ todo: todos })
            .groupBy(({ todo }) => todo.listId)
            .select(({ todo }) => ({
              listId: todo.listId,
              doubled: gt(totalPoints(todo.points), 5),
              withCount: count(todo.id),
            })),
      })

      expect(result.get(1)?.doubled).toBe(true)
      expect(result.get(2)?.doubled).toBe(false)
      expect(result.get(1)?.withCount).toBe(3)
    })

    test(`can be ordered by via $selected`, () => {
      const totalPoints = createAggregate<number>(`ordered_points`, (ctx) => ({
        preMap: (entry) => [ctx.key(entry), Number(ctx.value(entry))] as const,
        reduce: (values) =>
          values.reduce(
            (acc, [[, points], multiplicity]) => acc + points * multiplicity,
            0,
          ),
      }))
      registeredInTest.add(`ordered_points`)

      const todos = createTodosCollection()
      const result = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ todo: todos })
            .groupBy(({ todo }) => todo.listId)
            .select(({ todo }) => ({
              listId: todo.listId,
              points: totalPoints(todo.points),
            }))
            .orderBy(({ $selected }) => $selected.points, `desc`),
      })

      expect(result.toArray.map((row) => row.listId)).toEqual([1, 2])
    })
  })

  describe(`built-in overrides`, () => {
    test(`custom registration takes precedence and unregistering restores the built-in`, () => {
      vi.spyOn(console, `warn`).mockImplementation(() => {})

      const todos = createTodosCollection()
      const builtInResult = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ todo: todos })
            .groupBy(({ todo }) => todo.listId)
            .select(({ todo }) => ({
              listId: todo.listId,
              points: sum(todo.points),
            })),
      })
      expect(builtInResult.get(1)?.points).toBe(6)

      register(`sum`, (ctx: AggregateContext) => ({
        preMap: (entry: AggregateEntry) => Number(ctx.value(entry)),
        reduce: () => -1,
      }))

      const overriddenResult = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ todo: todos })
            .groupBy(({ todo }) => todo.listId)
            .select(({ todo }) => ({
              listId: todo.listId,
              points: sum(todo.points),
            })),
      })
      expect(overriddenResult.get(1)?.points).toBe(-1)

      // Already-compiled queries keep the implementation they compiled with
      expect(builtInResult.get(1)?.points).toBe(6)

      expect(unregisterAggregate(`sum`)).toBe(true)
      const restoredResult = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ todo: todos })
            .groupBy(({ todo }) => todo.listId)
            .select(({ todo }) => ({
              listId: todo.listId,
              points: sum(todo.points),
            })),
      })
      expect(restoredResult.get(1)?.points).toBe(6)
    })
  })

  describe(`errors`, () => {
    test(`unknown aggregate throws and lists registered names`, () => {
      register(`known_agg`, () => ({ preMap: () => 0, reduce: () => 0 }))

      const todos = createTodosCollection()
      let caught: unknown
      try {
        createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ todo: todos })
              .groupBy(({ todo }) => todo.listId)
              .select(({ todo }) => ({
                listId: todo.listId,
                value: new Aggregate(`nope`, [
                  toExpression(todo.points),
                ]) as any,
              })),
        })
      } catch (error) {
        caught = error
      }

      expect(caught).toBeInstanceOf(UnsupportedAggregateFunctionError)
      expect((caught as Error).message).toContain(`known_agg`)
    })

    test(`non-constant additional argument throws`, () => {
      const groupConcat = createAggregate<string, [separator?: string]>(
        `group_concat_bad_arg`,
        (ctx, [separator = `,`]) => groupConcatImpl(ctx, separator),
      )
      registeredInTest.add(`group_concat_bad_arg`)

      const todos = createTodosCollection()
      expect(() =>
        createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ todo: todos })
              .groupBy(({ todo }) => todo.listId)
              .select(({ todo }) => ({
                listId: todo.listId,
                // separator references a column, which is not constant
                names: groupConcat(todo.text, todo.text as unknown as string),
              })),
        }),
      ).toThrow(NonConstantAggregateArgumentError)
    })
  })
})

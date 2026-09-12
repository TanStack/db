import { evaluateReferenceExpression } from '../reference-expression.js'
import type { Collection, LoadSubsetOptions } from '../../src/index.js'
import type { BasicExpression } from '../../src/query/ir.js'

interface Runtime {
  BTreeIndex: unknown
  createCollection: <T extends object>(
    options: any,
  ) => Collection<T, string | number, any>
}

let sequence = 0

function copyExpression<T>(expression: BasicExpression<T>): BasicExpression<T> {
  if (expression.type === `ref`) {
    if (expression.path.length !== 1 || expression.path[0] !== `rank`) {
      throw new Error(`Infinite fixture supports only the rank field`)
    }
    const path = [...expression.path]
    Object.freeze(path)
    return Object.freeze({ ...expression, path })
  }
  if (expression.type === `val`) {
    if (
      typeof expression.value !== `boolean` &&
      !(
        typeof expression.value === `number` &&
        Number.isFinite(expression.value)
      )
    ) {
      throw new Error(`Infinite fixture requires finite numeric cursor values`)
    }
    return Object.freeze({ ...expression })
  }
  const arity = {
    eq: 2,
    lt: 2,
    gt: 2,
    gte: 2,
    lte: 2,
    isNull: 1,
    isUndefined: 1,
    not: 1,
  }[expression.name]
  if (expression.name === `or` || expression.name === `and`) {
    if (expression.args.length === 0)
      throw new Error(`Empty cursor Boolean expression`)
  } else if (arity === undefined || expression.args.length !== arity) {
    throw new Error(`Unsupported cursor operator or arity: ${expression.name}`)
  }
  // Validate every branch before serving any row, including an empty source.
  const args = expression.args.map(copyExpression)
  Object.freeze(args)
  return Object.freeze({ ...expression, args })
}

function copyRequest(options: LoadSubsetOptions): LoadSubsetOptions {
  for (const value of [options.offset, options.limit]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`Infinite fixture requires nonnegative integral windows`)
    }
  }
  if (options.where !== undefined) {
    // The ordered loader separately acquires the boundary tie group without
    // window/order fields. This is not an arbitrary filtered window request.
    const where = copyExpression(options.where)
    const operands = where.type === `func` ? where.args : []
    const rank = operands.find((operand) => operand.type === `ref`)
    const boundary = operands.find((operand) => operand.type === `val`)
    if (
      where.type !== `func` ||
      where.name !== `eq` ||
      operands.length !== 2 ||
      rank?.type !== `ref` ||
      boundary?.type !== `val` ||
      typeof boundary.value !== `number` ||
      options.orderBy !== undefined ||
      options.limit !== undefined ||
      options.cursor !== undefined ||
      (options.offset ?? 0) !== 0
    ) {
      throw new Error(`Infinite fixture supports only unwindowed rank equality`)
    }
    return Object.freeze({ ...options, where })
  }
  const clause = options.orderBy?.[0]
  if (
    options.orderBy?.length !== 1 ||
    !clause ||
    clause.expression.type !== `ref` ||
    clause.compareOptions.direction !== `desc`
  ) {
    throw new Error(`Infinite fixture requires one descending rank order`)
  }
  const orderBy = [
    {
      expression: copyExpression(clause.expression),
      // String and null ordering cannot distinguish this finite numeric world.
      compareOptions: Object.freeze({
        ...clause.compareOptions,
        ...(clause.compareOptions.stringSort === `locale` &&
        clause.compareOptions.localeOptions
          ? {
              localeOptions: Object.freeze({
                ...clause.compareOptions.localeOptions,
              }),
            }
          : {}),
      }),
    },
  ]
  Object.freeze(orderBy[0])
  Object.freeze(orderBy)
  return Object.freeze({
    ...options,
    orderBy,
    ...(options.cursor
      ? {
          cursor: Object.freeze({
            ...options.cursor,
            whereFrom: copyExpression(options.cursor.whereFrom),
            whereCurrent: copyExpression(options.cursor.whereCurrent),
          }),
        }
      : {}),
  })
}

export function makeInfiniteOnDemandSource<
  T extends { id: string; rank: number },
>(runtime: Runtime, data: ReadonlyArray<T>, asyncDelay?: number) {
  const ranks = new Set<number>()
  const keys = new Set<string>()
  const backend = data.map((row) => {
    if (
      !Number.isFinite(row.rank) ||
      typeof row.id !== `string` ||
      ranks.has(row.rank) ||
      keys.has(row.id) ||
      Reflect.ownKeys(row).some((key) => {
        const value: unknown = Reflect.get(row, key)
        return (
          typeof key !== `string` ||
          !(
            typeof value === `string` ||
            typeof value === `boolean` ||
            (typeof value === `number` && Number.isFinite(value))
          )
        )
      })
    ) {
      throw new Error(
        `Infinite fixture requires distinct ranks/IDs and scalar row fields`,
      )
    }
    ranks.add(row.rank)
    keys.add(row.id)
    return { ...row }
  })
  const calls: Array<LoadSubsetOptions> = []
  const collection = runtime.createCollection<T>({
    id: `infinite-conformance-on-demand-${sequence++}`,
    getKey: (row: T) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: runtime.BTreeIndex,
    sync: {
      sync: ({ markReady, begin, write, commit }: any) => {
        markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            const request = copyRequest(options)
            calls.push(request)
            let requested = [...backend].sort((a, b) => b.rank - a.rank)
            if (request.where) {
              requested = requested.filter(
                (row) =>
                  evaluateReferenceExpression(request.where!, row) === true,
              )
            }
            if (request.cursor) {
              requested = requested.filter(
                (row) =>
                  evaluateReferenceExpression(
                    request.cursor!.whereFrom,
                    row,
                  ) === true,
              )
            } else {
              requested = requested.slice(request.offset ?? 0)
            }
            if (request.limit !== undefined) {
              requested = requested.slice(0, request.limit)
            }

            const load = () => {
              begin()
              for (const row of requested)
                write({ type: `insert`, value: { ...row } })
              return commit() ?? true
            }
            if (asyncDelay === undefined) {
              return load()
            }
            return new Promise<void>((resolve, reject) => {
              setTimeout(() => {
                try {
                  const receipt: true | Promise<void> = load()
                  if (receipt === true) resolve()
                  else void receipt.then(resolve, reject)
                } catch (error) {
                  reject(error)
                }
              }, asyncDelay)
            })
          },
        }
      },
    },
  })
  return { collection, calls }
}

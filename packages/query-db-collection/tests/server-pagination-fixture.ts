import { QueryClient } from '@tanstack/query-core'
import { BTreeIndex, createCollection } from '@tanstack/db'
import { queryCollectionOptions } from '../src/index'
import { evaluateReferenceExpression } from '../../db/tests/reference-expression'
import { Func, PropRef, Value } from '../../db/src/query/ir'
import type { LoadSubsetOptions } from '@tanstack/db'
import type { BasicExpression } from '../../db/src/query/ir'

export { QueryClient }

export type ServerRow = { id: number; rank: number }
type Field = keyof ServerRow

function invalid(): never {
  throw new Error(`Unsupported server pagination request`)
}

function record(value: unknown, keys: ReadonlyArray<string>) {
  if (typeof value !== `object` || value === null || Array.isArray(value))
    return invalid()
  const copy: Record<string, unknown> = {}
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== `string` || !keys.includes(key)) return invalid()
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (!(`value` in descriptor)) return invalid()
    copy[key] = descriptor.value
  }
  return copy
}

function list(value: unknown): Array<unknown> {
  if (!Array.isArray(value)) return invalid()
  if (Reflect.ownKeys(value).length !== value.length + 1) return invalid()
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index)
    if (!descriptor || !(`value` in descriptor)) return invalid()
  }
  return value
}

function numeric(value: unknown): value is number {
  return typeof value === `number` && Number.isFinite(value)
}

// A finite non-null numeric grammar, not general SQL/string semantics.
// Validate every branch before evaluation, including predicates over no rows.
function expression(
  input: unknown,
  kind: `number` | `numbers` | `boolean`,
): BasicExpression {
  const node = record(input, [`type`, `path`, `value`, `name`, `args`])
  if (node.type === `val`) {
    record(input, [`type`, `value`])
    if (kind === `numbers`) {
      const values = list(node.value)
      if (!values.every(numeric)) return invalid()
      return new Value([...values])
    }
    if (
      kind === `number` ? numeric(node.value) : typeof node.value === `boolean`
    )
      return new Value(node.value)
    return invalid()
  }
  if (node.type === `ref` && kind === `number`) {
    record(input, [`type`, `path`])
    const path = list(node.path)
    if (path.length !== 1 || (path[0] !== `id` && path[0] !== `rank`))
      return invalid()
    return new PropRef([path[0]])
  }
  if (node.type !== `func` || kind !== `boolean`) return invalid()
  record(input, [`type`, `name`, `args`])
  const args = list(node.args)
  if (node.name === `and` || node.name === `or`) {
    if (!args.length) return invalid()
    return new Func(
      node.name,
      args.map((arg) => expression(arg, `boolean`)),
    )
  }
  if (node.name === `not` && args.length === 1)
    return new Func(`not`, [expression(args[0], `boolean`)])
  if (
    typeof node.name !== `string` ||
    ![`eq`, `gt`, `gte`, `lt`, `lte`, `in`].includes(node.name) ||
    args.length !== 2
  )
    return invalid()
  return new Func(node.name, [
    expression(args[0], `number`),
    expression(args[1], node.name === `in` ? `numbers` : `number`),
  ])
}

function freezeStatic<T>(value: T): T {
  if (value !== null && typeof value === `object`) {
    for (const child of Object.values(value)) freezeStatic(child)
    Object.freeze(value)
  }
  return value
}

function captureSubset(
  input: LoadSubsetOptions | undefined,
  intendedOrder: ReadonlyArray<Field>,
): LoadSubsetOptions | undefined {
  if (input === undefined) return undefined
  const raw = record(input, [
    `where`,
    `orderBy`,
    `limit`,
    `offset`,
    `cursor`,
    `signal`,
    `subscription`,
  ])
  for (const value of [raw.limit, raw.offset]) {
    if (
      value !== undefined &&
      (!numeric(value) || !Number.isInteger(value) || value < 0)
    )
      return invalid()
  }
  const where =
    raw.where === undefined ? undefined : expression(raw.where, `boolean`)
  const orderBy =
    raw.orderBy === undefined
      ? undefined
      : list(raw.orderBy).map((value, index) => {
          const clause = record(value, [`expression`, `compareOptions`])
          const ref = expression(clause.expression, `number`)
          if (ref.type !== `ref` || ref.path[0] !== intendedOrder[index])
            return invalid()
          const compare = record(clause.compareOptions, [
            `direction`,
            `nulls`,
            `stringSort`,
            `locale`,
            `localeOptions`,
          ])
          if (
            compare.direction !== `asc` ||
            (compare.nulls !== `first` && compare.nulls !== `last`) ||
            (compare.stringSort !== undefined &&
              compare.stringSort !== `lexical` &&
              compare.stringSort !== `locale`) ||
            compare.locale !== undefined ||
            compare.localeOptions !== undefined
          )
            return invalid()
          // String collation payloads are outside this numeric fixture. Both null
          // placements and default/lexical/locale modes are harmless for finite numbers.
          return {
            expression: ref,
            compareOptions: { ...compare },
          } as NonNullable<LoadSubsetOptions[`orderBy`]>[number]
        })
  if (orderBy?.length === 0) return invalid()
  if ((raw.limit !== undefined || (raw.offset ?? 0) !== 0) && !orderBy?.length)
    return invalid()
  let cursor: LoadSubsetOptions[`cursor`]
  if (raw.cursor !== undefined) {
    const value = record(raw.cursor, [`whereFrom`, `whereCurrent`, `lastKey`])
    if (value.lastKey !== undefined && !numeric(value.lastKey)) return invalid()
    cursor = {
      whereFrom: expression(value.whereFrom, `boolean`),
      whereCurrent: expression(value.whereCurrent, `boolean`),
      lastKey: value.lastKey,
    }
  }
  const snapshot = freezeStatic({
    where,
    orderBy,
    cursor,
    limit: raw.limit as number | undefined,
    offset: raw.offset as number | undefined,
  })
  // Detach/freeze static meaning only. Cancellation and subscription lifecycle
  // stay live, and their identities must not be cloned or frozen.
  return Object.freeze({
    ...snapshot,
    signal: input.signal,
    subscription: input.subscription,
  })
}

// An ordinary QueryObserver, not InfiniteQueryObserver. This fixture models
// numeric rows supplied in the query's requested order; it is not a general sorter.
// The endpoint either fulfills the request or returns one nonconforming cap.
export function createServerPaginationFixture(
  options: {
    rows: Array<ServerRow>
    cap?: number
    serverPageSize?: number
  } & (
    | { syncMode: `on-demand`; order: ReadonlyArray<Field> }
    | { syncMode: `eager`; order?: ReadonlyArray<Field> }
  ),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  const requests: Array<{
    pageParam: unknown
    subset: LoadSubsetOptions | undefined
    signalAborted: boolean | undefined
    subscriptionStatus: string | undefined
  }> = []
  const serverPages: Array<number> = []
  const fetchRows = async (
    input: LoadSubsetOptions | undefined,
    pageParam?: unknown,
  ): Promise<Array<ServerRow>> => {
    const subset = captureSubset(input, options.order ?? [])
    requests.push({
      pageParam,
      subset,
      signalAborted: subset?.signal?.aborted,
      subscriptionStatus: subset?.subscription?.status,
    })
    const start = subset?.offset ?? 0
    const limit = options.cap ?? subset?.limit ?? options.rows.length
    const matching = options.rows.filter((row) =>
      subset?.where
        ? evaluateReferenceExpression(subset.where, row) === true
        : true,
    )
    if (options.serverPageSize !== undefined) {
      const pageSize = options.serverPageSize
      const firstPage = Math.floor(start / pageSize)
      const prefixSkip = start % pageSize
      const gathered: Array<ServerRow> = []
      let page: number | undefined = firstPage
      while (page !== undefined && gathered.length < prefixSkip + limit) {
        serverPages.push(page)
        // Server authority stays inside the adapter. Query DB receives only
        // the completed row array, not this endpoint-specific continuation.
        const response: {
          rows: Array<ServerRow>
          nextPage: number | undefined
        } = await Promise.resolve({
          rows: matching.slice(page * pageSize, (page + 1) * pageSize),
          nextPage:
            (page + 1) * pageSize < matching.length ? page + 1 : undefined,
        })
        gathered.push(...response.rows)
        page = response.nextPage
      }
      return gathered.slice(prefixSkip, prefixSkip + limit)
    }
    return matching.slice(start, start + limit)
  }
  try {
    const collection = createCollection(
      queryCollectionOptions({
        queryClient: client,
        queryKey: [`server-pagination-probe`],
        syncMode: options.syncMode,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        getKey: (row: ServerRow) => row.id,
        queryFn: (context) =>
          fetchRows(
            context.meta?.loadSubsetOptions,
            `pageParam` in context ? context.pageParam : undefined,
          ),
      }),
    )
    return { collection, requests, serverPages, client, fetchRows }
  } catch (primaryError) {
    try {
      client.clear()
    } catch (cleanupError) {
      throw new AggregateError(
        [primaryError, cleanupError],
        `Server fixture construction and cleanup failed`,
        { cause: primaryError },
      )
    }
    throw primaryError
  }
}

/**
 * Query's actual cache/fetch boundary receives the shared saved-demand law.
 * A fresh QueryClient owns each source. Backend responses stay held until the
 * recorder supplies rows or a failure; later tie-boundary acquisitions receive
 * the same authored backend. This provider interprets only the finite group's
 * scalar predicates and ordering. It computes no readiness or coverage answer.
 */
import { QueryClient } from '@tanstack/query-core'
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { queryCollectionOptions } from '../src/query'
import type { IR, LoadSubsetOptions } from '@tanstack/db'
import type {
  DemandReceivingFactory,
  DemandRow,
} from '../../db-adapter-conformance/tests/persisted-demand-receiving-types'

function field(row: DemandRow, name: string | undefined) {
  if (name === `id` || name === `group` || name === `rank` || name === `value`)
    return row[name]
  throw new Error(`Unsupported receiving-provider field: ${name}`)
}

function evaluate(expression: IR.BasicExpression, row: DemandRow): unknown {
  if (expression.type === `val`) return expression.value
  if (expression.type === `ref`) return field(row, expression.path.at(-1))
  const args = expression.args.map((arg) => evaluate(arg, row))
  if (expression.name === `and`) return args.every(Boolean)
  if (expression.name === `or`) return args.some(Boolean)
  const left = args[0]
  const right = args[1]
  if (
    (typeof left !== `number` && typeof left !== `string`) ||
    (typeof right !== `number` && typeof right !== `string`)
  )
    throw new Error(`Receiving provider requires scalar comparisons`)
  switch (expression.name) {
    case `eq`:
      return left === right
    case `gt`:
      return left > right
    case `gte`:
      return left >= right
    case `lt`:
      return left < right
    case `lte`:
      return left <= right
    default:
      throw new Error(
        `Unsupported receiving-provider predicate: ${expression.name}`,
      )
  }
}

function backendRows(
  rows: ReadonlyArray<DemandRow>,
  request: LoadSubsetOptions,
) {
  if (request.cursor)
    throw new Error(`Saved-demand receiving grammar has no cursor acquisition`)
  const result = rows.filter(
    (row) => !request.where || evaluate(request.where, row),
  )
  result.sort((left, right) => {
    for (const term of request.orderBy ?? []) {
      const a = evaluate(term.expression, left)
      const b = evaluate(term.expression, right)
      if (a === b) continue
      if (
        (typeof a !== `string` && typeof a !== `number`) ||
        (typeof b !== `string` && typeof b !== `number`)
      )
        throw new Error(`Receiving provider requires scalar ordering`)
      return (
        (a < b ? -1 : 1) * (term.compareOptions.direction === `desc` ? -1 : 1)
      )
    }
    return left.id < right.id ? -1 : left.id === right.id ? 0 : 1
  })
  const offset = request.offset ?? 0
  return result
    .slice(
      offset,
      request.limit === undefined ? undefined : offset + request.limit,
    )
    .map((row) => ({ ...row }))
}

const requestKey = (request: LoadSubsetOptions | undefined) =>
  JSON.stringify({
    where: request?.where,
    orderBy: request?.orderBy,
    limit: request?.limit,
    offset: request?.offset ?? 0,
    cursor: request?.cursor,
  })

export const createQueryPersistedDemandSource: DemandReceivingFactory = (
  input,
) => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  })
  type Request = {
    key: string
    options: LoadSubsetOptions
    resolve: (rows: Array<DemandRow>) => void
    reject: (error: unknown) => void
    delivered: boolean
    consumed: boolean
    acknowledge: () => void
    acknowledgment: Promise<void>
    removeAbortListener: () => void
  }
  const calls: Array<Request> = []
  let rows: ReadonlyArray<DemandRow> | undefined
  let refusing = false
  let disposed = false
  const failure = new Error(`Query receiving backend is offline`)
  const deliver = (request: Request) => {
    if (
      request.delivered ||
      request.consumed ||
      disposed ||
      (rows === undefined && !refusing)
    )
      return
    request.delivered = true
    request.removeAbortListener()
    if (refusing) request.reject(failure)
    else {
      try {
        const response = backendRows(rows!, request.options)
        input.events.push({
          type: `rows`,
          rows: response.map((row) => [row.id, { ...row }] as const),
        })
        request.resolve(response)
      } catch (error) {
        request.reject(error)
      }
    }
  }
  // Query notifies its observers before it notifies this cache subscriber.
  // This acknowledgment records SDK input consumption, including failures; it
  // does not inspect Collection rows, readiness, or subset-load settlement.
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (
      event.type !== `updated` ||
      (event.action.type !== `success` && event.action.type !== `error`)
    )
      return
    const key = String(event.query.queryKey[1] ?? requestKey(undefined))
    const request = calls.find(
      (call) => call.key === key && call.delivered && !call.consumed,
    )
    if (request) {
      request.consumed = true
      request.acknowledge()
    }
  })
  const options = queryCollectionOptions<
    DemandRow,
    unknown,
    Array<string>,
    string
  >({
    id: input.id,
    queryClient: client,
    syncMode: `on-demand`,
    getKey: (row) => row.id,
    queryKey: (request) =>
      request.where ||
      request.orderBy?.length ||
      request.limit !== undefined ||
      request.offset !== undefined ||
      request.cursor
        ? [input.id, requestKey(request)]
        : [input.id],
    queryFn: (context) =>
      new Promise<Array<DemandRow>>((resolve, reject) => {
        const request = context.meta?.loadSubsetOptions ?? {}
        let acknowledge!: () => void
        const acknowledgment = new Promise<void>((done) => (acknowledge = done))
        const abort = () => {
          call.removeAbortListener()
          call.consumed = true
          acknowledge()
          reject(context.signal.reason)
        }
        const call: Request = {
          key: requestKey(request),
          options: request,
          resolve,
          reject,
          delivered: false,
          consumed: false,
          acknowledge,
          acknowledgment,
          removeAbortListener: () =>
            context.signal.removeEventListener(`abort`, abort),
        }
        calls.push(call)
        context.signal.addEventListener(`abort`, abort, { once: true })
        if (context.signal.aborted) abort()
        else deliver(call)
      }),
  })
  const collection = (() => {
    try {
      const persisted = persistedCollectionOptions({
        ...options,
        sync: input.wrapSync(options.sync),
        persistence: input.persistence,
        initialRender: {
          strategy: `network-first`,
          networkTimeoutMs: input.waitMs,
        },
      })
      return createCollection({
        ...persisted,
        sync: input.wrapPersistedSync(persisted.sync),
      })
    } catch (error) {
      unsubscribe()
      client.clear()
      throw error
    }
  })()
  return Promise.resolve({
    collection,
    answer(nextRows) {
      rows = nextRows.map((row) => ({ ...row }))
      refusing = false
      for (const call of calls) deliver(call)
      return Promise.resolve()
    },
    reject() {
      refusing = true
      for (const call of calls) deliver(call)
      return Promise.resolve()
    },
    requests: () => calls.length,
    async barrier() {
      let previous = -1
      while (previous !== calls.length) {
        previous = calls.length
        await Promise.all(
          calls
            .filter((call) => call.delivered)
            .map((call) => call.acknowledgment),
        )
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    },
    dispose() {
      disposed = true
      unsubscribe()
      client.clear()
      for (const call of calls) call.removeAbortListener()
      return Promise.resolve()
    },
  })
}

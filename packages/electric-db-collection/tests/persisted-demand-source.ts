/**
 * The installed ShapeStream receives authored snapshot HTTP responses. The
 * finite provider handles scalar conjunctions and ordered prefixes, including
 * the rank predicate of a tie-boundary acquisition. It computes no coverage
 * answer. Provider requests stay held until answer/reject supplies a response.
 * Actual SDK method and subscriber completion supply the consumption barrier;
 * Collection readiness and subset-load success never supply that checkpoint.
 */
import { ShapeStream } from '@electric-sql/client'
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { electricCollectionOptions } from '../src/electric'
import type { SyncConfig } from '@tanstack/db'
import type {
  DemandReceivingFactory,
  DemandRow,
} from '../../db-adapter-conformance/tests/persisted-demand-receiving-types'

function backendRows(rows: ReadonlyArray<DemandRow>, url: URL) {
  const where = url.searchParams.get(`subset__where`) ?? `true = true`
  const params = JSON.parse(
    url.searchParams.get(`subset__params`) ?? `{}`,
  ) as Record<string, string>
  // The shared grammar uses a group equality and optional rank boundary,
  // combined only by conjunction. Refuse other SQL instead of guessing at it.
  const clauses = where.replace(/[()]/g, ``).split(/\s+AND\s+/i)
  const selected = rows.filter((row) =>
    clauses.every((clause) => {
      if (clause.trim() === `true = true`) return true
      const match =
        /^\s*"(id|group|rank|value)"\s*(=|>=|<=|>|<)\s*\$(\d+)\s*$/.exec(clause)
      if (!match)
        throw new Error(`Unsupported receiving-provider SQL: ${where}`)
      const name = match[1] as keyof DemandRow
      const left = row[name]
      const supplied = params[match[3]!]
      if (supplied === undefined)
        throw new Error(`Missing receiving-provider SQL parameter`)
      const right = typeof left === `number` ? Number(supplied) : supplied
      switch (match[2]) {
        case `=`:
          return left === right
        case `>`:
          return left > right
        case `>=`:
          return left >= right
        case `<`:
          return left < right
        case `<=`:
          return left <= right
        default:
          throw new Error(`Unsupported receiving-provider comparison`)
      }
    }),
  )
  const order = url.searchParams.get(`subset__order_by`)
  if (order && !/^"rank"(?: ASC)?(?: NULLS (?:FIRST|LAST))?$/i.test(order))
    throw new Error(`Unsupported receiving-provider ordering: ${order}`)
  selected.sort((left, right) =>
    order && left.rank !== right.rank
      ? left.rank - right.rank
      : left.id < right.id
        ? -1
        : left.id === right.id
          ? 0
          : 1,
  )
  const offset = Number(url.searchParams.get(`subset__offset`) ?? 0)
  const limit = url.searchParams.get(`subset__limit`)
  return selected
    .slice(offset, limit === null ? undefined : offset + Number(limit))
    .map((row) => ({ ...row }))
}

export const createElectricPersistedDemandSource: DemandReceivingFactory = (
  input,
) => {
  type Request = {
    url: URL
    snapshot: boolean
    respond: (response: Response) => void
  }
  const pending = new Set<Request>()
  const callbacks = new Set<Promise<void>>()
  let requests = 0
  let responses = 0
  let completed = 0
  let serial = 0
  let rows: ReadonlyArray<DemandRow> | undefined
  let refusing = false
  let disposed = false
  let providerFailure: unknown
  const handle = `demand-${crypto.randomUUID()}`
  const headers = () => ({
    'electric-handle': handle,
    'electric-offset': `${serial}_0`,
    'electric-cursor': String(serial),
    'electric-up-to-date': `true`,
    'electric-schema': JSON.stringify({
      id: { type: `text`, pk_index: 0 },
      group: { type: `text` },
      rank: { type: `int4` },
      value: { type: `text` },
    }),
  })
  const deliver = (request: Request) => {
    if (!request.snapshot || (!disposed && !refusing && rows === undefined))
      return
    responses++
    if (disposed || refusing) {
      request.respond(
        new Response(`Offline receiving backend`, { status: 400 }),
      )
      return
    }
    try {
      const selected = backendRows(rows!, request.url)
      input.events.push({
        type: `rows`,
        rows: selected.map((row) => [row.id, { ...row }] as const),
      })
      serial++
      request.respond(
        new Response(
          JSON.stringify({
            metadata: {
              xmin: `10`,
              xmax: `20`,
              xip_list: [],
              database_lsn: `10`,
              snapshot_mark: serial,
            },
            data: selected.map((row) => ({
              key: row.id,
              value: { ...row, rank: String(row.rank) },
              headers: { operation: `insert` },
            })),
          }),
          { headers: headers() },
        ),
      )
    } catch (error) {
      providerFailure = error
      request.respond(
        new Response(`Invalid receiving request`, { status: 400 }),
      )
    }
  }
  const fetchClient: typeof fetch = (resource, init) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(String(resource))
      const signal = init?.signal
      const abort = () => {
        pending.delete(request)
        reject(signal?.reason ?? new DOMException(`Aborted`, `AbortError`))
      }
      const request: Request = {
        url,
        snapshot: url.searchParams.has(`subset__where`),
        respond: (response) => {
          pending.delete(request)
          signal?.removeEventListener(`abort`, abort)
          resolve(response)
        },
      }
      if (signal?.aborted) {
        abort()
        return
      }
      signal?.addEventListener(`abort`, abort, { once: true })
      pending.add(request)
      if (request.snapshot) requests++
      if (disposed) request.respond(new Response(`Closed`, { status: 400 }))
      else deliver(request)
    })
  const subscribe = ShapeStream.prototype.subscribe
  const requestSnapshot = ShapeStream.prototype.requestSnapshot
  ShapeStream.prototype.subscribe = function (callback, onError) {
    return subscribe.call(
      this,
      (messages) => {
        const result = callback(messages)
        const completion = Promise.resolve(result).then(
          () => undefined,
          () => undefined,
        )
        callbacks.add(completion)
        void completion.then(() => callbacks.delete(completion))
        return result
      },
      onError,
    )
  }
  ShapeStream.prototype.requestSnapshot = function (options) {
    const result = requestSnapshot.call(this, options)
    void result.then(
      () => completed++,
      () => completed++,
    )
    return result
  }
  const restore = () => {
    ShapeStream.prototype.subscribe = subscribe
    ShapeStream.prototype.requestSnapshot = requestSnapshot
  }
  const options = electricCollectionOptions<DemandRow>({
    id: input.id,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    shapeOptions: {
      url: `http://electric/persisted-demand-${encodeURIComponent(input.id)}`,
      params: { table: `rows` },
      fetchClient,
      backoffOptions: {
        initialDelay: 1,
        maxDelay: 1,
        multiplier: 1,
        maxRetries: 0,
      },
      onError: () => undefined,
    },
  })
  const collection = (() => {
    try {
      const persisted = persistedCollectionOptions<DemandRow, string>({
        id: input.id,
        getKey: (row: DemandRow) => row.id,
        syncMode: options.syncMode,
        // The factory's getKey and finite rows use string keys only.
        // Electric's helper leaves its key type at string | number.
        sync: input.wrapSync(options.sync as SyncConfig<DemandRow, string>),
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
      restore()
      throw error
    }
  })()
  return Promise.resolve({
    collection,
    answer(nextRows) {
      rows = nextRows.map((row) => ({ ...row }))
      refusing = false
      for (const request of [...pending]) deliver(request)
      return Promise.resolve()
    },
    reject() {
      refusing = true
      for (const request of [...pending]) deliver(request)
      return Promise.resolve()
    },
    requests: () => requests,
    async barrier() {
      let previous = -1
      while (previous !== responses) {
        previous = responses
        const deadline = Date.now() + 5000
        while (completed < responses) {
          if (Date.now() > deadline)
            throw new Error(`Electric SDK did not consume supplied HTTP input`)
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
        await Promise.all([...callbacks])
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      if (providerFailure !== undefined) throw providerFailure
    },
    dispose() {
      disposed = true
      for (const request of [...pending])
        request.respond(new Response(`Closed`, { status: 400 }))
      restore()
      return Promise.resolve()
    },
  })
}

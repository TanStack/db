/**
 * Controlled HTTP at the installed TrailBase Client.fetch boundary. RecordApi
 * chooses routes and decodes JSON/SSE unchanged. Complete SSE frames avoid an
 * unrelated claim about the SDK's split-frame parser. This fixture supplies
 * service facts only; independent oracle models judge Collection observations.
 */
import { initClient } from 'trailbase'
import type { Event } from 'trailbase'

export const sdkTurn = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0))

export async function untilSdk(predicate: () => boolean, premise: string) {
  const end = performance.now() + 2_000
  while (!predicate()) {
    if (performance.now() >= end)
      throw new Error(`TrailBase SDK premise not reached: ${premise}`)
    await sdkTurn()
  }
}

type Stream = {
  body: ReadableStream<Uint8Array>
  controller: ReadableStreamDefaultController<Uint8Array>
  cancellations: number
  ended: boolean
}
export type SdkList<Row> = {
  url: URL
  // An abandoned list can outlive its source stream. Deliveries address the
  // current SDK subscription rather than consuming retired requests in order.
  subscription: number
  resolve: (rows: ReadonlyArray<Row>, cursor?: string) => void
  reject: (error: unknown) => void
}

export class TrailBaseSdkService<Row extends { id: string | number }> {
  readonly client = initClient(`http://trailbase-oracle.invalid`)
  readonly api = this.client.records<Row>(`oracle_rows`)
  readonly streams: Array<Stream> = []
  readonly requests: Array<{ path: string; method: string; body?: string }> = []
  readonly lists: Array<SdkList<Row>> = []
  /** Optional transport controller; existing receivers retain automatic lists. */
  onList?: (request: SdkList<Row>) => void
  readonly writes: Array<{
    method: string
    path: string
    body: unknown
    resolve: (ids?: ReadonlyArray<string | number>) => void
    reject: (cause: unknown) => void
  }> = []
  rows: Array<Row> = []
  holdLists = false
  listFailure: unknown
  subscriptionFailure: unknown
  terminalEntries = 0
  private readonly originalFetch = this.client.fetch

  constructor() {
    this.client.fetch = (path, init) => {
      const method = init?.method ?? `GET`
      this.requests.push({ path, method, body: init?.body?.toString() })
      const url = new URL(path, `http://trailbase-oracle.invalid`)
      if (method === `GET` && url.pathname.endsWith(`/subscribe/*`)) {
        if (this.subscriptionFailure !== undefined) {
          this.terminalEntries++
          return Promise.reject(this.subscriptionFailure)
        }
        let controller!: ReadableStreamDefaultController<Uint8Array>
        const stream: Stream = {
          controller,
          cancellations: 0,
          ended: false,
          body: new ReadableStream<Uint8Array>({
            start(value) {
              controller = value
            },
            cancel: () => {
              stream.cancellations++
              stream.ended = true
            },
          }),
        }
        stream.controller = controller
        this.streams.push(stream)
        return Promise.resolve(
          new Response(stream.body, {
            headers: { 'Content-Type': `text/event-stream` },
          }),
        )
      }
      if (method === `GET` && url.pathname === `/api/records/v1/oracle_rows`) {
        if (this.listFailure !== undefined) {
          this.terminalEntries++
          return Promise.reject(this.listFailure)
        }
        return new Promise<Response>((resolve, reject) => {
          const list: SdkList<Row> = {
            url,
            subscription: this.streams.length,
            resolve: (rows, cursor) =>
              resolve(
                new Response(
                  JSON.stringify({
                    records: rows,
                    ...(cursor ? { cursor } : {}),
                  }),
                ),
              ),
            reject: (error) => {
              this.terminalEntries++
              reject(error)
            },
          }
          this.lists.push(list)
          if (this.onList) this.onList(list)
          else if (!this.holdLists) list.resolve(this.select(url))
        })
      }
      if ([`POST`, `PATCH`, `DELETE`].includes(method)) {
        return new Promise<Response>((resolve, reject) => {
          this.writes.push({
            method,
            path: url.pathname,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
            resolve: (ids = []) =>
              resolve(new Response(JSON.stringify({ ids }))),
            reject,
          })
        })
      }
      return Promise.reject(
        new Error(`Unexpected TrailBase SDK route: ${method} ${path}`),
      )
    }
  }

  select(url: URL): Array<Row> {
    let rows = this.rows
    for (const [key, value] of url.searchParams) {
      const match = /^filter\[([^\]]+)\](?:\[\$(eq|ne|lt|lte|gt|gte)\])?$/.exec(
        key,
      )
      if (!match) continue
      rows = rows.filter((row) => {
        const actual: unknown = Reflect.get(row, match[1]!)
        switch (match[2] ?? `eq`) {
          case `eq`:
            return String(actual) === value
          case `ne`:
            return String(actual) !== value
          case `lt`:
            return typeof actual === `number` && actual < Number(value)
          case `lte`:
            return typeof actual === `number` && actual <= Number(value)
          case `gt`:
            return typeof actual === `number` && actual > Number(value)
          case `gte`:
            return typeof actual === `number` && actual >= Number(value)
          default:
            throw new Error(`Unsupported TrailBase SDK fixture comparison`)
        }
      })
    }
    const order = url.searchParams.get(`order`)
    if (order) {
      rows = [...rows].sort((left, right) => {
        for (const clause of order.split(`,`)) {
          const direction = clause.startsWith(`-`) ? -1 : 1
          const field = /^[+-]/.test(clause) ? clause.slice(1) : clause
          const a: unknown = Reflect.get(left, field)
          const b: unknown = Reflect.get(right, field)
          if (a === b) continue
          if (typeof a === `number` && typeof b === `number`)
            return (a < b ? -1 : 1) * direction
          if (typeof a === `string` && typeof b === `string`)
            return (a < b ? -1 : 1) * direction
          throw new Error(`Unsupported TrailBase SDK fixture order values`)
        }
        return String(left.id).localeCompare(String(right.id))
      })
    }
    const offset = Number(url.searchParams.get(`offset`) ?? 0)
    const limit = Number(url.searchParams.get(`limit`) ?? 256)
    return structuredClone(rows.slice(offset, offset + limit))
  }

  emit(event: Event, stream = this.streams.at(-1)) {
    if (!stream) throw new Error(`TrailBase SDK has no subscription`)
    stream.controller.enqueue(
      new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
    )
  }

  fail(error: unknown) {
    const stream = this.streams.at(-1)
    if (!stream) throw new Error(`TrailBase SDK has no subscription`)
    stream.ended = true
    this.terminalEntries++
    stream.controller.error(error)
  }

  async propagate() {
    for (let turn = 0; turn < 4; turn++) await sdkTurn()
  }

  dispose() {
    this.client.fetch = this.originalFetch
  }
}

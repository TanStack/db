/**
 * Production driver for the shared eager live-source conformance oracle
 * (`packages/db-adapter-conformance`). It runs the real Electric adapter in
 * eager mode over the installed `@electric-sql/client` `ShapeStream`, which
 * fetches through a controlled `fetchClient`, as
 * `electric-sdk-delivery-oracle` does. The driver answers the Electric HTTP
 * protocol; the real client parses each value from its Postgres type in
 * `electric-schema`, and the real adapter applies it.
 *
 * The oracle's steps map onto Electric like this:
 *
 * - a complete delivery answers the initial request (`offset=-1`) with an
 *   insert per row and `up-to-date`. A later one (`complete-snapshot`)
 *   answers the pending live request with `must-refetch` (HTTP 409), then
 *   the refetch with the new rows and `up-to-date`;
 * - a change batch answers the pending live request with one message per
 *   change, each carrying the batch's txid (`await-evidence`), and
 *   `up-to-date`. `insert` for a key the provider does not hold, `update`
 *   for one it does, `delete` otherwise. As in Electric's default replica
 *   mode, an update carries the primary key and only the changed columns,
 *   so the adapter merges it over the row it holds. The adapter commits at
 *   `up-to-date`, so the driver declares `per-batch` commits;
 * - a failure answers with HTTP 400, which the client gives to the shape's
 *   `onError`. The handler gives up by returning nothing, or for an odd
 *   failure index by throwing. Every failed response carries the injected failure's index in
 *   a header, so `matchesFailure` names the value owed: the client's
 *   FetchError for that response, or the error the handler threw.
 *   The law set gives Electric a give-up after retries (`retryBound`), so the
 *   driver declares `source-failure-after-ready`;
 * - a retried failure (`retry-policy`) is one failed attempt of a generated
 *   kind (`transientVariants`): an HTTP 503 or a 429 with `Retry-After`,
 *   which the client retries (its backoff is set short), a rejected fetch
 *   (a network failure, also retried by the client), or an HTTP 400 that
 *   the shape's `onError` retries. Health shows an outage from its fifth
 *   attempt in a row (`retryReportAfter`);
 * - an empty response (`empty-response`) answers the live request with
 *   HTTP 204, which the client accepts and which carries no change;
 * - a provider subscription is one sync run's request chain; its release is
 *   the abort of the chain's pending request (LIFE-2, LIFE-10), or the
 *   driver's own terminal response, after which the client holds nothing
 *   open. The driver serves eager mode only: it takes a request after an
 *   aborted one as a new sync run, which an on-demand pause would break;
 * - the propagation step (`settle`) waits until the client asks again after
 *   a response, or, after a failure, until the shape's `onError` gave up.
 *
 * Typed fields (FID-1) are Postgres columns: text, int4, float8 (also for
 * -0), bool, timestamptz, int8, and jsonb. The client's default parsers
 * decode all but timestamptz, which an app parses with a `parser` entry; the
 * driver supplies that entry. int4 holds a 32-bit integer, so larger
 * integers are excluded (`excludesValue`), as Postgres would reject them.
 * `note` is a nullable text column (`toSqlRow`, `fromSqlRow`). The driver
 * never reads the Collection.
 */
import { FetchError } from '@electric-sql/client'
import { createCollection } from '@tanstack/db'
import { electricCollectionOptions } from '../src/electric'
import {
  fromSqlRow,
  observedView,
  toSqlRow,
} from '../../db-adapter-conformance/src'
import type {
  ConformanceRow,
  ControlledProvider,
  EagerLiveSourceDriver,
  EagerLiveSourceFixture,
  ProviderChange,
  ValueKind,
} from '../../db-adapter-conformance/src'

/** Each typed field kind and the Postgres column type that holds it. */
const COLUMNS = {
  string: `text`,
  integer: `int4`,
  float: `float8`,
  'negative-zero': `float8`,
  boolean: `bool`,
  date: `timestamptz`,
  bigint: `int8`,
  array: `jsonb`,
  object: `jsonb`,
} as const satisfies Partial<Record<ValueKind, string>>

type FieldKind = keyof typeof COLUMNS
const FIELD_KINDS = Object.keys(COLUMNS) as Array<FieldKind>
const column = (kind: FieldKind) => `t_${kind.replace(`-`, `_`)}`

const SCHEMA = JSON.stringify({
  id: { type: `int4`, pk_index: 0 },
  title: { type: `text` },
  note: { type: `text` },
  ...Object.fromEntries(
    FIELD_KINDS.map((kind) => [column(kind), { type: COLUMNS[kind] }]),
  ),
})

/** A value in Postgres text form, as Electric sends it. */
function wire(kind: FieldKind, value: unknown): string {
  switch (COLUMNS[kind]) {
    case `float8`:
      return Object.is(value, -0) ? `-0` : String(value)
    case `bool`:
      return value === true ? `true` : `false`
    case `timestamptz`:
      return (value as Date).toISOString()
    case `jsonb`:
      return JSON.stringify(value)
    default:
      return String(value)
  }
}

/** A conformance row as an Electric row value: every column as text. */
function rowValue(row: ConformanceRow): Record<string, string | null> {
  const sql = toSqlRow(row)
  return {
    id: String(sql.id),
    title: sql.title,
    note: sql.note,
    ...Object.fromEntries(
      FIELD_KINDS.map((kind) => [column(kind), wire(kind, row.typed?.[kind])]),
    ),
  }
}

/**
 * An update's value in Electric's default replica mode: the primary key and
 * the columns whose value changed, a column set to NULL included.
 */
function changedColumns(
  before: Record<string, string | null>,
  after: Record<string, string | null>,
): Record<string, string | null> {
  return Object.fromEntries(
    Object.entries(after).filter(
      ([name, value]) => name === `id` || before[name] !== value,
    ),
  )
}

type Request = {
  url: URL
  signal: AbortSignal | undefined
  respond: (response: Response) => void
  /** Rejects the fetch, as a network failure does. */
  reject: (error: Error) => void
}

/** The oracle's index of an injected failure, from its message. */
const failureIndex = (error: Error) => error.message.split(` `).at(-1)!

/** The kinds of failed attempt the provider makes (`retry-policy`). */
const TRANSIENT_VARIANTS = [
  `http-503`,
  `http-429`,
  `network`,
  `http-400-retried`,
] as const
type TransientVariant = (typeof TRANSIENT_VARIANTS)[number]

/**
 * The client's retry bound. A history holds at most 12 outages of at most
 * seven attempts, so only a give-up by exhaustion reaches it.
 */
const MAX_RETRIES = 85

type Session = {
  handle: string
  latest: Request | undefined
  // The latest response stopped the client, as a give-up does.
  stopped: boolean
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** How long the driver waits for the client before letting the check decide. */
const clientTimeoutMs = 2_000

/** The response header that carries an injected failure's index. */
const FAILURE_HEADER = `x-conformance-failure`

/** A failed response that carries the failure's index; a 429 asks for 1 ms. */
function failureResponse(error: Error, status: number): Response {
  return new Response(error.message, {
    status,
    headers: {
      [FAILURE_HEADER]: failureIndex(error),
      ...(status === 429 ? { 'retry-after': `0.001` } : {}),
    },
  })
}

class ElectricProvider implements ControlledProvider {
  private readonly queued: Array<Request> = []
  private readonly sessions: Array<Session> = []
  private rows = new Map<number, ConformanceRow>()
  private offset = 0
  private answered: Request | undefined
  // Give-ups so far, and the count the latest failure must reach.
  private gaveUp = 0
  private giveUpTarget = 0
  private retryNextError = false
  /** The error `onError` threw to give up, by failure index. */
  readonly thrown = new Map<string, Error>()

  constructor(readonly variants: ReadonlyArray<TransientVariant>) {}

  /** The adapter gave up; without an app `onError`, it logs that. */
  readonly noteGiveUp = () => {
    this.gaveUp++
  }

  /**
   * An app's `onError`. It retries the HTTP 400 of a retried failure by
   * returning an empty retry. It gives up on any other error by returning
   * nothing, or, for an odd failure index, by throwing; both stop the
   * stream (RETRY-1), and the adapter fails.
   */
  readonly onError = (error: Error) => {
    if (this.retryNextError) {
      this.retryNextError = false
      return {}
    }
    this.noteGiveUp()
    const index = (error as { headers?: Record<string, string> }).headers?.[
      FAILURE_HEADER
    ]
    if (Number(index) % 2 === 1) {
      const thrown = new Error(`conformance give-up ${index}`)
      this.thrown.set(index!, thrown)
      throw thrown
    }
    return undefined
  }

  readonly fetchClient: typeof fetch = (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(String(input))
      const signal = init?.signal ?? undefined
      const request: Request = {
        url,
        signal,
        respond: (response) => {
          signal?.removeEventListener(`abort`, abort)
          resolve(response)
        },
        reject: (error) => {
          signal?.removeEventListener(`abort`, abort)
          reject(error)
        },
      }
      const abort = () => {
        const index = this.queued.indexOf(request)
        if (index >= 0) this.queued.splice(index, 1)
        reject(
          signal?.reason ?? new DOMException(`request aborted`, `AbortError`),
        )
      }
      if (signal?.aborted) {
        abort()
        return
      }
      signal?.addEventListener(`abort`, abort, { once: true })
      // A sync run's request chain continues while its latest request is
      // live: a retry or a refetch belongs to it. A request after that chain
      // was aborted, or after the client stopped, starts a new sync run's
      // chain.
      let session = this.sessions.at(-1)
      if (
        !session ||
        session.stopped ||
        session.latest?.signal?.aborted === true
      ) {
        session = {
          handle: `shape-${this.sessions.length + 1}`,
          latest: undefined,
          stopped: false,
        }
        this.sessions.push(session)
        this.rows = new Map()
      }
      session.latest = request
      session.stopped = false
      this.queued.push(request)
    })

  private session(request: Request): Session {
    const session = this.sessions.find((s) => s.latest === request)
    if (!session) throw new Error(`the request belongs to no sync run`)
    return session
  }

  private async take(): Promise<Request> {
    const deadline = Date.now() + clientTimeoutMs
    while (this.queued.length === 0 && Date.now() < deadline) await sleep(2)
    const request = this.queued.shift()
    if (!request) throw new Error(`the client has not requested`)
    this.answered = request
    return request
  }

  private headers(session: Session, upToDate = true) {
    this.offset++
    return {
      'electric-handle': session.handle,
      'electric-offset': `${this.offset}_0`,
      'electric-cursor': String(this.offset),
      'electric-schema': SCHEMA,
      ...(upToDate ? { 'electric-up-to-date': `true` } : {}),
    }
  }

  private respondRows(request: Request, messages: Array<unknown>): void {
    const session = this.session(request)
    request.respond(
      new Response(
        JSON.stringify([
          ...messages,
          {
            headers: {
              control: `up-to-date`,
              global_last_seen_lsn: String(this.offset + 1),
            },
          },
        ]),
        { headers: this.headers(session) },
      ),
    )
  }

  private inserts(rows: ReadonlyArray<ConformanceRow>) {
    return rows.map((row) => ({
      key: String(row.id),
      value: rowValue(row),
      headers: { operation: `insert` },
    }))
  }

  // A run's chain is released when its pending request is aborted, or when
  // the client stopped after a terminal response and holds no request: an
  // HTTP long-poll that stopped holds nothing open.
  releases = () =>
    this.sessions.map((session) =>
      session.latest?.signal?.aborted === true || session.stopped ? 1 : 0,
    )

  deliverSnapshot = async (rows: ReadonlyArray<ConformanceRow>) => {
    let request = await this.take()
    if (request.url.searchParams.get(`offset`) !== `-1`) {
      // A complete delivery after ready: must-refetch, then the refetch.
      const session = this.session(request)
      session.handle = `${session.handle}-r${this.offset}`
      request.respond(
        new Response(
          JSON.stringify([{ headers: { control: `must-refetch` } }]),
          {
            status: 409,
            headers: { 'electric-handle': session.handle },
          },
        ),
      )
      request = await this.take()
    }
    this.rows = new Map(rows.map((row) => [row.id, row]))
    this.respondRows(request, this.inserts(rows))
  }

  deliverChanges = async (
    changes: ReadonlyArray<ProviderChange>,
    txid: string,
  ) => {
    const request = await this.take()
    const messages = changes.map((change) => {
      if (change.type === `upsert`) {
        const held = this.rows.get(change.row.id)
        this.rows.set(change.row.id, change.row)
        return {
          key: String(change.row.id),
          value: held
            ? changedColumns(rowValue(held), rowValue(change.row))
            : rowValue(change.row),
          headers: {
            operation: held ? `update` : `insert`,
            txids: [Number(txid)],
          },
        }
      }
      const row = this.rows.get(change.id)
      if (!row) throw new Error(`provider does not hold row ${change.id}`)
      this.rows.delete(change.id)
      return {
        key: String(change.id),
        value: { id: String(change.id) },
        headers: { operation: `delete`, txids: [Number(txid)] },
      }
    })
    this.respondRows(request, messages)
  }

  // A failure is an HTTP 400 the client does not retry, or, for failure
  // indexes 2 and 3 modulo 4, HTTP 503s until the client's `maxRetries`
  // bound gives up.
  fail = async (error: Error) => {
    this.giveUpTarget = this.gaveUp + 1
    if (Math.floor(Number(failureIndex(error)) / 2) % 2 === 0) {
      const request = await this.take()
      this.session(request).stopped = true
      request.respond(failureResponse(error, 400))
      return
    }
    for (;;) {
      const request = await this.take()
      request.respond(failureResponse(error, 503))
      const deadline = Date.now() + clientTimeoutMs
      while (
        this.queued.length === 0 &&
        this.gaveUp < this.giveUpTarget &&
        Date.now() < deadline
      ) {
        await sleep(1)
      }
      if (this.queued.length === 0) {
        this.session(request).stopped = true
        return
      }
    }
  }

  // One failed attempt: an HTTP 503 or 429 the client retries, a network
  // failure the client retries, or an HTTP 400 the shape's `onError`
  // retries.
  transientFailure = async (error: Error, variant: number) => {
    const request = await this.take()
    const kind = this.variants[variant]
    if (kind === `network`) {
      request.reject(new TypeError(error.message))
      return
    }
    this.retryNextError = kind === `http-400-retried`
    request.respond(
      failureResponse(
        error,
        kind === `http-503` ? 503 : kind === `http-429` ? 429 : 400,
      ),
    )
  }

  /** An HTTP 204 to the live request: accepted, with no change. */
  emptyResponse = async () => {
    const request = await this.take()
    request.respond(
      new Response(null, {
        status: 204,
        headers: this.headers(this.session(request), false),
      }),
    )
  }

  /**
   * The propagation step: the client asks again after a response, or, after
   * a terminal one, gives up through `onError`.
   */
  settle = async () => {
    const answered = this.answered
    if (!answered) return
    this.answered = undefined
    const stopped = this.sessions.find((s) => s.latest === answered)?.stopped
    const deadline = Date.now() + clientTimeoutMs
    while (
      (stopped ? this.gaveUp < this.giveUpTarget : this.queued.length === 0) &&
      answered.signal?.aborted !== true &&
      Date.now() < deadline
    ) {
      await sleep(2)
    }
    // The client's subscriber delivery follows its next request closely.
    for (let turn = 0; turn < 3; turn++) await sleep(0)
  }
}

type ElectricRow = Record<string, unknown> & {
  id: number
  title: string | null
  note: string | null
}

/** A Collection row as a conformance row: typed columns become `typed`. */
function conformanceRow(row: ElectricRow): ConformanceRow {
  const typed: Record<string, unknown> = {}
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    const kind = FIELD_KINDS.find((k) => column(k) === key)
    if (kind) typed[kind] = value
    else rest[key] = value
  }
  return fromSqlRow({ ...rest, typed } as { note?: unknown })
}

let sequence = 0

/**
 * With `appOnError: false`, the shape has no `onError`, as in Electric's
 * default configuration: the adapter gives up on every failure the client
 * does not retry and logs it, so no HTTP 400 is retried and the driver
 * declares that log.
 */
export function electricConformanceDriver({
  appOnError = true,
}: { appOnError?: boolean } = {}): EagerLiveSourceDriver {
  // The provider of the history being checked.
  let current: ElectricProvider | undefined
  const variants = TRANSIENT_VARIANTS.filter(
    (kind) => appOnError || kind !== `http-400-retried`,
  )
  return {
    adapter: `@tanstack/electric-db-collection (eager${appOnError ? `` : `, no onError`})`,
    capabilities: new Set([
      `complete-snapshot`,
      `await-evidence`,
      `retry-policy`,
      `source-failure-after-ready`,
      `empty-response`,
    ]),
    changeCommits: `per-batch`,
    // The Collection reports the client's error for a failed response, the
    // error a network failure rejected with, or the error `onError` threw to
    // give up. Each carries the injected failure's index.
    matchesFailure: (reported, failure) => {
      const index = String(failure)
      const thrown = current?.thrown.get(index)
      if (thrown) return reported === thrown
      if (reported instanceof FetchError) {
        return reported.headers[FAILURE_HEADER] === index
      }
      return (
        reported instanceof TypeError &&
        reported.message.endsWith(` failure ${index}`)
      )
    },
    transientVariants: variants,
    // Without an app `onError`, the adapter logs each give-up; the log is
    // the driver's sign that the client stopped.
    declaredDiagnostic: appOnError
      ? undefined
      : (level, args) => {
          const giveUp =
            level === `error` &&
            String(args[0]).startsWith(`An error occurred while syncing`)
          if (giveUp) current?.noteGiveUp()
          return giveUp
        },
    // Electric carries txids on row messages; an empty batch sends none.
    txidEvidence: `change`,
    // Only an extended outage shows (maintainer decision 2026-10-30).
    retryReportAfter: 5,
    fieldKinds: FIELD_KINDS,
    // Column domains: int4 holds a 32-bit integer, and Postgres rejects a
    // larger one; a float8 column holds a scalar -0, not one nested in an
    // array or object.
    excludesValue: (kind, value) =>
      (kind === `integer` &&
        typeof value === `number` &&
        (value > 2_147_483_647 || value < -2_147_483_648)) ||
      (kind === `negative-zero` && typeof value !== `number`),
    create(): EagerLiveSourceFixture {
      const provider = new ElectricProvider(variants)
      current = provider
      const collection = createCollection(
        electricCollectionOptions<ElectricRow>({
          id: `electric-conformance-${++sequence}`,
          shapeOptions: {
            url: `http://conformance/shape-${sequence}`,
            params: { table: `rows` },
            fetchClient: provider.fetchClient,
            parser: { timestamptz: (value: string) => new Date(value) },
            backoffOptions: {
              initialDelay: 1,
              maxDelay: 2,
              multiplier: 1,
              maxRetries: MAX_RETRIES,
            },
            ...(appOnError ? { onError: provider.onError } : {}),
          },
          getKey: (row) => row.id,
        }),
      )
      return {
        collection: observedView(collection, {
          row: conformanceRow,
          key: (key) => key as number,
        }),
        provider,
        awaitTxId: (txid, timeout) =>
          collection.utils.awaitTxId(Number(txid), timeout),
        settle: provider.settle,
      }
    },
  }
}

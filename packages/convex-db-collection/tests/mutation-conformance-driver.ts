/**
 * Production driver for the shared mutation oracle
 * (`packages/db-adapter-conformance/src/mutation-oracle.ts`). It runs the real
 * Convex adapter in eager mode over the real Convex JavaScript client, whose
 * WebSocket the driver controls, as `conformance-driver.ts` does: the
 * client's query set, mutation queue, timestamps, and subscriptions are real,
 * and the driver plays the server.
 *
 * Convex does not persist writes: the application's handlers call a Convex
 * mutation, and the adapter wraps each handler so it settles only once its
 * subscription holds the result after that mutation. The driver supplies
 * such an application:
 *
 * - the provider is the server's table. A write request is one `Mutation`
 *   message; its args carry the complete row as Convex values, so a field
 *   whose value is `undefined` is absent (`undefinedField: 'absent'`);
 * - the server runs one client's mutations in arrival order
 *   (`ordered-answers`) and answers each by plan. A rejection is a failed
 *   `MutationResponse` carrying the plan's message; an acceptance commits at
 *   a new timestamp and answers with it;
 * - each commit reaches the query as one `Transition` to its timestamp,
 *   carrying the complete result. The client resolves a mutation only once a
 *   transition reaches its timestamp, so transitions are the copies, in
 *   commit order (`log-ordered-echoes`); a held echo stalls them at that
 *   commit until `deliver` (`held-echoes`);
 * - a rewrite (`server-rewrites`) is the mutation storing a changed row; a
 *   commit by another client is a server commit that is not the client's;
 * - the adapter cannot order the application's handlers
 *   (`application-handlers`), so each write's request goes out when it is
 *   made.
 *
 * Rows are Convex values: an absent `note` is a missing field. Limits: the
 * JavaScript client only; no reconnect while a mutation waits.
 */
import { createCollection } from '@tanstack/db'
import { ConvexClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { convexToJson, jsonToConvex } from 'convex/values'
import { convexCollectionOptions } from '../src/index'
import {
  acceptAtOnce,
  observedView,
  rewriteRow,
  settleWhenQuiet,
} from '../../db-adapter-conformance/src'
import type { JSONValue, Value } from 'convex/values'
import type {
  ConformanceRow,
  MutationDriver,
  MutationFixture,
  MutationProvider,
  ProviderChange,
  SettleCut,
  WritePlan,
  WriteRequest,
} from '../../db-adapter-conformance/src'

const rowsQuery = makeFunctionReference<
  `query`,
  Record<string, never>,
  Array<ConformanceRow>
>(`rows:list`)

const writeMutation = makeFunctionReference<
  `mutation`,
  { request: WriteRequest },
  null
>(`rows:write`)

function timestamp(value: number): string {
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64LE(BigInt(value))
  return bytes.toString(`base64`)
}

/** The WebSocket the Convex client opens; the driver plays the server. */
class Socket {
  static provider: ConvexMutationProvider | undefined
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  readonly sent: Array<Record<string, unknown>> = []
  private readonly provider: ConvexMutationProvider
  constructor(_url: string) {
    this.provider = Socket.provider!
    this.provider.socket = this
    queueMicrotask(() => this.onopen?.())
  }
  send(data: string) {
    const message = JSON.parse(data) as Record<string, unknown>
    this.sent.push(message)
    // A server answers after the message leaves; the client registers a
    // mutation as in flight only after it sends it.
    queueMicrotask(() => this.provider.receive(message))
  }
  close() {
    queueMicrotask(() => this.onclose?.({ code: 1000, reason: `` }))
  }
  deliver(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

type Answer = { run: () => void; held: boolean }

class ConvexMutationProvider implements MutationProvider {
  readonly client: ConvexClient
  socket: Socket | undefined
  private readonly table = new Map<number, ConformanceRow>()
  private readonly plans: Array<WritePlan> = []
  private readonly held: Array<Answer> = []
  /** Teardown: every request is answered at once, every copy sent. */
  private draining = false
  /** Requests not yet answered, in arrival order. */
  private readonly unanswered: Array<Answer> = []
  private readonly log: Array<WriteRequest> = []
  /**
   * Transitions that are stalled: a commit's, where `own` marks a held echo,
   * or a query-set change's acknowledgment, with its modifications.
   */
  private readonly stalled: Array<{
    rows?: Array<ConformanceRow>
    ts: number
    own: boolean
    extra?: Array<unknown>
  }> = []
  private time = 0
  /** The timestamp of the last transition sent. */
  private sentTs = 0
  /** The query-set version the client last saw, and the one it asked for. */
  private querySet = 0
  private requestedQuerySet = 0
  private queryId: number | undefined
  private activity = 0

  constructor(seed: ReadonlyArray<ConformanceRow>) {
    for (const row of seed) this.table.set(row.id, row)
    Socket.provider = this
    this.client = new ConvexClient(`https://mutations.convex.cloud`, {
      webSocketConstructor: Socket as unknown as typeof WebSocket,
      unsavedChangesWarning: false,
      logger: false,
    })
  }

  private result(): Array<ConformanceRow> {
    return [...this.table.values()].sort((a, b) => a.id - b.id)
  }

  /** A transition from the last one sent to `ts`, with the query's result. */
  private transition(
    ts: number,
    rows?: Array<ConformanceRow>,
    extra: Array<unknown> = [],
  ): void {
    this.socket!.deliver({
      type: `Transition`,
      startVersion: {
        querySet: this.querySet,
        ts: timestamp(this.sentTs),
        identity: 0,
      },
      endVersion: {
        querySet: this.requestedQuerySet,
        ts: timestamp(ts),
        identity: 0,
      },
      modifications: [
        ...extra,
        ...(rows && this.queryId !== undefined
          ? [
              {
                type: `QueryUpdated`,
                queryId: this.queryId,
                value: convexToJson(rows as unknown as Value),
                logLines: [],
                journal: null,
              },
            ]
          : []),
      ],
    })
    this.sentTs = ts
    this.querySet = this.requestedQuerySet
    this.activity++
  }

  /** A message from the client. */
  receive(message: Record<string, unknown>): void {
    if (message.type === `ModifyQuerySet`) {
      this.requestedQuerySet = message.newVersion as number
      const modifications = message.modifications as Array<{
        type: string
        queryId: number
      }>
      for (const modification of modifications) {
        if (modification.type === `Add`) this.queryId = modification.queryId
      }
      const added = modifications.some((m) => m.type === `Add`)
      const removed = modifications
        .filter((m) => m.type === `Remove`)
        .map(({ queryId }) => ({ type: `QueryRemoved`, queryId }))
      // The server acknowledges a query-set change in a new transition,
      // which waits behind stalled ones: transitions are in order.
      queueMicrotask(() => {
        const ts = ++this.time
        const rows = added ? this.result() : undefined
        if (this.stalled.length > 0)
          this.stalled.push({ rows, ts, own: false, extra: removed })
        else this.transition(ts, rows, removed)
      })
      return
    }
    if (message.type !== `Mutation`) return
    const requestId = message.requestId as number
    const { request } = jsonToConvex(
      (message.args as Array<JSONValue>)[0]!,
    ) as unknown as { request: WriteRequest }
    this.log.push(request)
    this.activity++
    const plan = this.plans.shift() ?? acceptAtOnce
    const held = plan.held && !this.draining
    const answer: Answer = {
      held,
      run: () => {
        if (plan.outcome === `reject`) {
          this.socket!.deliver({
            type: `MutationResponse`,
            requestId,
            success: false,
            result: plan.error.message,
            logLines: [],
          })
          return
        }
        // A server answers a mutation before the transition that carries
        // it; the client resolves the mutation at that later transition.
        const { ts, publish } = this.commit(
          request.type === `delete`
            ? { type: `delete`, id: request.id }
            : {
                type: `upsert`,
                row: rewriteRow(request.row as ConformanceRow, plan.rewrite),
              },
          plan.echoHeld && !this.draining,
        )
        this.socket!.deliver({
          type: `MutationResponse`,
          requestId,
          success: true,
          result: null,
          ts: timestamp(ts),
          logLines: [],
        })
        publish()
      },
    }
    this.unanswered.push(answer)
    if (held) this.held.push(answer)
    else if (this.unanswered[0] === answer) this.answer(answer)
  }

  /** Answers a request, then each one behind it that is not held. */
  private answer(answer: Answer): void {
    this.unanswered.splice(this.unanswered.indexOf(answer), 1)
    answer.run()
    this.activity++
    while (this.unanswered[0] && !this.unanswered[0].held)
      this.answer(this.unanswered[0])
  }

  /**
   * Commits at a new timestamp. `publish` sends its transition, or stalls
   * it behind a held echo.
   */
  private commit(
    change: ProviderChange,
    holdEcho: boolean,
  ): { ts: number; publish: () => void } {
    if (change.type === `delete`) this.table.delete(change.id)
    else this.table.set(change.row.id, change.row)
    const ts = ++this.time
    const rows = this.result()
    return {
      ts,
      publish: () => {
        if (holdEcho || this.stalled.length > 0)
          this.stalled.push({ rows, ts, own: holdEcho })
        else this.transition(ts, rows)
      },
    }
  }

  // The oracle's side.

  plan(plan: WritePlan): void {
    this.plans.push(plan)
  }

  release(): void {
    const answer = this.held.shift()
    if (answer) this.answer(answer)
  }

  /** Transitions resume at the oldest held echo, up to the next one. */
  deliver(): void {
    const first = this.stalled.shift()
    if (!first) return
    this.transition(first.ts, first.rows, first.extra)
    while (this.stalled[0] && !this.stalled[0].own) {
      const next = this.stalled.shift()!
      this.transition(next.ts, next.rows, next.extra)
    }
  }

  /**
   * Answers every held request and resumes the transitions, and from now on
   * answers each request at once and stalls no transition.
   */
  drain(): void {
    this.draining = true
    while (this.held.length > 0) this.release()
    while (this.stalled.length > 0) this.deliver()
  }

  foreignCommit(change: ProviderChange): void {
    this.commit(change, false).publish()
  }

  rows(): ReadonlyArray<ConformanceRow> {
    return this.result()
  }

  requests(): ReadonlyArray<WriteRequest> {
    return this.log
  }

  /**
   * The propagation step: every write's receipt settled; while a request or
   * an echo is held, until the requests, transitions, and receipts are
   * quiet. The client applies a transition within a few turns.
   */
  settle = ({ unsettled }: SettleCut) =>
    settleWhenQuiet({
      done: () => unsettled() === 0,
      blocked: () => this.held.length > 0 || this.stalled.length > 0,
      activity: () => `${this.activity} ${unsettled()}`,
    })

  dispose = () => this.client.close()
}

let sequence = 0

export function convexMutationDriver(): MutationDriver {
  return {
    adapter: `@tanstack/convex-db-collection (eager, javascript client)`,
    capabilities: new Set([
      `write-rejection`,
      `held-writes`,
      `foreign-commits`,
      `server-rewrites`,
      `held-echoes`,
      `log-ordered-echoes`,
      `application-handlers`,
      `ordered-answers`,
      // The collection's queries share the client's one transition stream.
      `reloads`,
      `reload-keeps-feed`,
      // The new run takes the client's current result as a snapshot.
      `snapshot-reloads`,
    ]),
    undefinedField: `absent`,
    // The client creates a failed mutation's error from the server's
    // message, which ends with the injected failure's index.
    matchesFailure: (reported, failure) =>
      reported instanceof Error &&
      new RegExp(`${failure.message}(?!\\d)`).test(reported.message),
    create(seed): MutationFixture {
      const provider = new ConvexMutationProvider(seed)
      // The application's handlers: one Convex mutation per write.
      const persist = async (requests: Array<WriteRequest>) => {
        for (const request of requests)
          await provider.client.mutation(writeMutation, { request })
      }
      const collection = createCollection(
        convexCollectionOptions({
          id: `convex-mutations-${++sequence}`,
          client: provider.client,
          query: rowsQuery,
          queryArgs: {},
          getKey: (row) => row.id,
          onInsert: ({ transaction }) =>
            persist(
              transaction.mutations.map((mutation) => ({
                type: `insert`,
                id: mutation.modified.id,
                row: mutation.modified,
              })),
            ),
          onUpdate: ({ transaction }) =>
            persist(
              transaction.mutations.map((mutation) => ({
                type: `update`,
                id: mutation.modified.id,
                // The complete row; Convex values drop an `undefined` field.
                row: mutation.modified,
              })),
            ),
          onDelete: ({ transaction }) =>
            persist(
              transaction.mutations.map((mutation) => ({
                type: `delete`,
                id: mutation.original.id,
              })),
            ),
        }),
      )
      return {
        collection: observedView(collection, {
          row: (row) => row,
          key: (key) => key as number,
        }),
        base: () => collection.base.values(),
        writer: {
          insert: (row) => collection.insert(row),
          update: (row) =>
            collection.update(row.id, (draft) => {
              draft.title = row.title
              if (Object.hasOwn(row, `note`)) draft.note = row.note
              // Only a held note value is removed.
              else if (typeof draft.note === `string`) delete draft.note
            }),
          delete: (id) => collection.delete(id),
        },
        provider,
        settle: provider.settle,
        drain: () => provider.drain(),
        reload: () => collection.reload(),
        dispose: async () => {
          await collection.cleanup()
          await provider.dispose()
        },
      }
    },
  }
}

/**
 * Controlled NDJSON transport for the real standalone SDK. This module has no
 * test-runner imports, so a Node child can record actual detached rejections.
 * A staged response is replayed only when the SDK opens another HTTP response.
 * Each response sends a complete checkpoint; source omissions become REMOVE.
 */
import { RequestResolution } from './protocol-request'
import type { ResolvedStream } from './protocol-request'
import type { StartupRow } from '../../db-adapter-conformance/tests/persisted-startup-oracle'

export const eagerProtocolTurn = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0))

export async function untilEagerProtocol(
  predicate: () => boolean,
  premise: string,
): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error(`Unreached provider premise: ${premise}`)
    await eagerProtocolTurn()
  }
}

type ResponsePlan =
  { kind: `rows`; rows: Array<StartupRow> } | { kind: `error`; message: string }

export class EagerProtocolService {
  requests = 0
  completions = 0
  private stream: ReadableStreamDefaultController<Uint8Array> | undefined
  private signal: AbortSignal | undefined
  private held = new Map<string, StartupRow>()
  private op = 0
  private plan: ResponsePlan | undefined
  private resolution?: RequestResolution

  constructor(readonly defaultStream = false) {}

  readonly fetch: typeof fetch = async (_input, init) => {
    this.requests++
    this.resolution = new RequestResolution(
      JSON.parse(String(init?.body)).streams,
    )
    this.signal = init?.signal ?? undefined
    return new Response(
      new ReadableStream<Uint8Array>(
        {
          start: (stream) => {
            this.stream = stream
            this.signal?.addEventListener(
              `abort`,
              () => {
                try {
                  stream.close()
                } catch {
                  /* Already ended by the provider. */
                }
              },
              { once: true },
            )
            if (this.plan) this.send(this.plan)
          },
        },
        new CountQueuingStrategy({ highWaterMark: 0 }),
      ),
    )
  }

  get active() {
    return this.stream !== undefined && !this.signal?.aborted
  }
  get drained() {
    return !this.active || this.stream?.desiredSize === 0
  }

  hold() {
    this.plan = undefined
  }

  stageRows(rows: Array<StartupRow>) {
    this.plan = { kind: `rows`, rows: structuredClone(rows) }
  }

  async rows(rows: Array<StartupRow>) {
    const completed = this.completions
    this.stageRows(rows)
    await untilEagerProtocol(
      () => this.active || this.completions > completed,
      `open NDJSON response`,
    )
    if (this.completions === completed) this.send(this.plan!)
  }

  async prepareRecovery(rows: Array<StartupRow>) {
    this.stageRows(rows)
    if (!this.active) return
    const requests = this.requests
    this.stream?.close()
    await untilEagerProtocol(
      () => this.requests > requests,
      `healthy replacement response`,
    )
  }

  async reject(message: string, reconnect = false) {
    const completed = this.completions
    this.plan = { kind: `error`, message }
    if (reconnect) {
      const requests = this.requests
      this.stream?.close()
      await untilEagerProtocol(
        () => this.requests > requests,
        `replacement response`,
      )
    } else {
      await untilEagerProtocol(
        () => this.active || this.completions > completed,
        `open NDJSON response`,
      )
      if (this.completions === completed) this.send(this.plan)
    }
  }

  private line(value: unknown) {
    this.stream!.enqueue(new TextEncoder().encode(`${JSON.stringify(value)}\n`))
  }

  private send(plan: ResponsePlan) {
    const next =
      plan.kind === `rows`
        ? new Map(plan.rows.map((row) => [row.id, row]))
        : this.held
    const removes = [...this.held.keys()].filter((id) => !next.has(id))
    const count = removes.length + (plan.kind === `rows` ? next.size : 0)
    const last = String(this.op + count + 10)
    const streams: Array<ResolvedStream> = [
      {
        name: `rows`,
        is_default: this.defaultStream,
        errors:
          plan.kind === `error`
            ? [
                {
                  subscription: this.defaultStream ? `default` : 0,
                  message: plan.message,
                },
              ]
            : [],
      },
    ]
    const buckets = plan.kind === `error` ? [] : [`rows`]
    this.resolution!.validate(streams, buckets)
    this.line({
      checkpoint: {
        last_op_id: last,
        buckets: buckets.map((bucket) => ({ bucket, checksum: 0 })),
        streams,
      },
    })
    const operations = [
      ...removes.map((id) => ({
        op: `REMOVE`,
        object_type: `rows`,
        object_id: id,
      })),
      ...(plan.kind === `rows`
        ? [...next.values()].map(({ id, value }) => ({
            op: `PUT`,
            object_type: `rows`,
            object_id: id,
            data: JSON.stringify({ value }),
          }))
        : []),
    ]
    if (operations.length)
      this.line({
        data: {
          bucket: `rows`,
          data: operations.map((op) => ({
            op_id: String(++this.op),
            checksum: 0,
            ...op,
          })),
        },
      })
    this.line({ checkpoint_complete: { last_op_id: last } })
    this.held = plan.kind === `error` ? new Map() : next
    this.completions++
  }
}

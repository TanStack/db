/** Browser-safe controlled PowerSync HTTP transport; no expected product facts. */
import { untilOnDemandStream } from '../../db-adapter-conformance/tests/on-demand-streams-driver'
import { authoredStreamIdentity } from '../../db-adapter-conformance/tests/on-demand-streams-oracle'
import type { StreamRow } from '../../db-adapter-conformance/tests/on-demand-streams-oracle'

type Subscription = {
  stream: string
  parameters: Record<string, unknown>
  override_priority: number | null
}
type Request = { streams: { subscriptions: Array<Subscription> } }
export class OnDemandService {
  requests: Array<Request> = []
  private controller?: ReadableStreamDefaultController<Uint8Array>
  private signal?: AbortSignal
  private operation = 0
  readonly fetch: typeof fetch = (_input, init) => {
    this.requests.push(JSON.parse(String(init?.body)) as Request)
    this.signal = init!.signal!
    return Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>(
          {
            start: (controller) => {
              this.controller = controller
              init!.signal!.addEventListener(
                `abort`,
                () => {
                  try {
                    controller.close()
                  } catch {}
                },
                { once: true },
              )
            },
          },
          new CountQueuingStrategy({ highWaterMark: 0 }),
        ),
      ),
    )
  }
  get live(): boolean {
    return !!this.controller && !this.signal?.aborted
  }
  get requestRevision(): number {
    return this.requests.length
  }
  get subscriptions(): Array<Subscription> {
    return this.requests.at(-1)?.streams.subscriptions ?? []
  }
  get requested(): Array<string> {
    return (
      this.requests
        .at(-1)
        ?.streams.subscriptions.map((stream) => stream.stream) ?? []
    )
  }
  close(): void {
    this.controller!.close()
  }
  async checkpoint(
    rows: ReadonlyArray<StreamRow>,
    failed: ReadonlyArray<string>,
    version: number,
  ): Promise<number> {
    await untilOnDemandStream(() => this.live, `controlled HTTP stream is open`)
    // Bind the complete authored checkpoint to this actual HTTP request. A
    // replacement can open a successor while the SDK consumes these lines;
    // that successor needs its own delivery and cannot satisfy this receipt.
    const controller = this.controller!
    const signal = this.signal!
    const revision = this.requestRevision
    const streams = this.subscriptions
    const send = (value: unknown) =>
      controller.enqueue(new TextEncoder().encode(JSON.stringify(value) + `\n`))
    send({
      checkpoint: {
        last_op_id: String(this.operation + rows.length + 10),
        buckets: [{ bucket: `rows`, checksum: 0 }],
        streams: streams.map((stream, index) => {
          const identity = authoredStreamIdentity({
            name: stream.stream,
            parameters: stream.parameters,
          })
          return {
            name: stream.stream,
            is_default: false,
            errors: failed.includes(identity)
              ? [
                  {
                    subscription: index,
                    message: `rejected-${version}-${identity}`,
                  },
                ]
              : [],
          }
        }),
      },
    })
    if (rows.length)
      send({
        data: {
          bucket: `rows`,
          data: rows.map((row) => ({
            op: `PUT`,
            object_type: `rows`,
            object_id: row.id,
            data: JSON.stringify({
              left: row.left,
              right: row.right,
              value: row.value,
            }),
            op_id: String(++this.operation),
            checksum: 0,
          })),
        },
      })
    send({
      checkpoint_complete: { last_op_id: String(this.operation + 10) },
    })
    // This proves transport consumption. The receiver separately waits for
    // real SDK wait/error callbacks before claiming the semantic boundary.
    await untilOnDemandStream(
      () => signal.aborted || controller.desiredSize === 0,
      `SDK consumed controlled checkpoint lines`,
    )
    return revision
  }
}

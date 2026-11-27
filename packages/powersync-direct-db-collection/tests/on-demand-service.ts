/** Browser-safe controlled PowerSync HTTP transport; no expected product facts. */
import { untilOnDemandStream } from '../../db-adapter-conformance/tests/on-demand-streams-driver'
import { authoredStreamIdentity } from '../../db-adapter-conformance/tests/on-demand-streams-oracle'
import { RequestResolution, resolveStreams } from './protocol-request'
import type { StreamRow } from '../../db-adapter-conformance/tests/on-demand-streams-oracle'

type Subscription = {
  stream: string
  parameters: Record<string, unknown>
  override_priority: number | null
}
type Request = {
  streams: { include_defaults: boolean; subscriptions: Array<Subscription> }
}
export class OnDemandService {
  requests: Array<Request> = []
  private controller?: ReadableStreamDefaultController<Uint8Array>
  private signal?: AbortSignal
  private operation = 0
  private resolution?: RequestResolution
  private configuration?: string
  onCheckpoint?: (input: {
    retained: Array<string>
    failed: Array<string>
  }) => void
  readonly fetch: typeof fetch = (_input, init) => {
    this.requests.push(JSON.parse(String(init?.body)) as Request)
    this.resolution = new RequestResolution(this.requests.at(-1)!.streams)
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
  /** An authored configuration change resolves arguments on a new request. */
  async configure(
    failed: ReadonlyArray<string>,
    version: number,
  ): Promise<void> {
    const next = JSON.stringify([
      [...failed].sort(),
      failed.length ? version : null,
    ])
    const previous = this.configuration
    this.configuration = next
    if (previous === undefined || previous === next) return
    const before = this.requestRevision
    if (this.live) this.close()
    await untilOnDemandStream(
      () => this.live && this.requestRevision > before,
      `configuration change opened a successor HTTP request`,
    )
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
    const descriptions = resolveStreams(
      { subscriptions: streams },
      (stream) => {
        const identity = authoredStreamIdentity({
          name: stream.stream,
          parameters: stream.parameters,
        })
        return failed.includes(identity)
          ? `rejected-${version}-${identity}`
          : undefined
      },
    )
    const buckets = this.resolution!.hasResolvedSubscription(descriptions)
      ? [`rows`]
      : []
    this.resolution!.validate(descriptions, buckets)
    const send = (value: unknown) =>
      controller.enqueue(new TextEncoder().encode(JSON.stringify(value) + `\n`))
    send({
      checkpoint: {
        last_op_id: String(
          this.operation + (buckets.length ? rows.length : 0) + 10,
        ),
        buckets: buckets.map((bucket) => ({ bucket, checksum: 0 })),
        streams: descriptions,
      },
    })
    if (rows.length && buckets.length)
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
    // Consumption belongs to this request. The receiver separately drains SDK
    // work, receipts and storage at its provider/applied cut. A superseded input
    // cannot authorize recovery.
    if (!signal.aborted && revision === this.requestRevision)
      this.onCheckpoint?.({
        retained: streams.map((stream) =>
          authoredStreamIdentity({
            name: stream.stream,
            parameters: stream.parameters,
          }),
        ),
        failed: [...failed],
      })
    return revision
  }
}

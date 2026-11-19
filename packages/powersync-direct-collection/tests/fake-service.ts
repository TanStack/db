import { expect, vi } from 'vitest'

type Row = Record<string, unknown>

/**
 * A fake PowerSync service, delivering injectable sync lines through `/sync/stream`.
 *
 * @see {@link https://github.com/powersync-ja/powersync-service/blob/main/docs/specs/sync-protocol.md}
 */
export class FakeService {
  readonly requests: Array<Record<string, any>> = []
  readonly checkpointRequests: Array<Record<string, any>> = []
  #stream?: ReadableStreamDefaultController<Uint8Array>
  #signal?: AbortSignal
  #errored = false
  #opId = 0
  /** Runs before responding to a checkpoint request. */
  beforeCheckpointResponse?: () => Promise<void>

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const body = JSON.parse(String(init?.body))
    if (url.pathname == '/sync/checkpoint-request') {
      this.checkpointRequests.push(body)
      await this.beforeCheckpointResponse?.()
      return Response.json({
        data: { checkpoint_request_id: body.checkpoint_request_id },
      })
    }

    this.requests.push(body)
    const signal = (this.#signal = init!.signal!)
    this.#errored = false
    return new Response(
      new ReadableStream(
        {
          start: (c) => {
            this.#stream = c
            signal.addEventListener('abort', () => {
              try {
                c.close()
              } catch {}
            })
          },
        },
        // Lines stay queued until the client reads them (see `drained`).
        new CountQueuingStrategy({ highWaterMark: 0 }),
      ),
    )
  }

  get aborted() {
    return this.#signal?.aborted ?? true
  }

  /** Whether the latest sync request is still open. */
  get live() {
    return this.requests.length > 0 && !this.aborted && !this.#errored
  }

  /** Resolves once the client has read every line sent on the latest request. */
  async drained() {
    await vi.waitFor(
      () => expect(this.live ? this.#stream!.desiredSize : 0).toBe(0),
      { interval: 1 },
    )
  }

  /** Fails the latest sync request's response body, as a dropped network connection does. */
  error(cause: Error) {
    this.#errored = true
    this.#stream!.error(cause)
  }

  get lastRequest() {
    return this.requests.at(-1)!
  }

  async waitForRequest(count: number) {
    await vi.waitFor(() => expect(this.requests.length).toBe(count))
  }

  send(line: unknown) {
    this.#stream!.enqueue(new TextEncoder().encode(JSON.stringify(line) + '\n'))
  }

  close() {
    this.#stream!.close()
  }

  checkpoint(
    buckets: Array<string>,
    options: { streams?: Array<unknown>; writeCheckpoint?: string } = {},
  ) {
    const request = this.lastRequest
    this.send({
      checkpoint: {
        last_op_id: String(this.#opId + 10),
        write_checkpoint: options.writeCheckpoint,
        buckets: buckets.map((bucket) => ({ bucket, checksum: 0 })),
        streams:
          options.streams ??
          request.streams.subscriptions.map((s: { stream: string }) => ({
            name: s.stream,
            is_default: false,
            errors: [],
          })),
      },
    })
  }

  put(bucket: string, table: string, id: string, data: Row) {
    this.data(bucket, [
      {
        op: 'PUT',
        object_type: table,
        object_id: id,
        data: JSON.stringify(data),
      },
    ])
  }

  remove(bucket: string, table: string, id: string) {
    this.data(bucket, [{ op: 'REMOVE', object_type: table, object_id: id }])
  }

  data(bucket: string, ops: Array<Row>) {
    this.send({
      data: {
        bucket,
        data: ops.map((op) => ({
          op_id: String(++this.#opId),
          checksum: 0,
          ...op,
        })),
      },
    })
  }

  complete() {
    this.send({ checkpoint_complete: { last_op_id: String(this.#opId + 10) } })
  }

  /** Sends a checkpoint with the given rows in one bucket, followed by a completion line. */
  sync(
    bucket: string,
    table: string,
    rows: Record<string, Row>,
    options?: { writeCheckpoint?: string },
  ) {
    this.checkpoint([bucket], options)
    for (const [id, row] of Object.entries(rows))
      this.put(bucket, table, id, row)
    this.complete()
  }
}

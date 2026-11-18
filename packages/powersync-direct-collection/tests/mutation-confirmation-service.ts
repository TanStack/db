/** Controlled protocol transport shared by Node and Chromium receiving paths. */
export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

/** A timeout reports an unreached checkpoint; it never advances the protocol. */
export async function atCheckpoint<T>(promise: Promise<T>, name: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`unreached: ${name}`)), 3000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export class MutationService {
  readonly connected = deferred<void>()
  readonly requested = deferred<void>()
  readonly requestResponse = deferred<void>()
  readonly responseRead = deferred<void>()
  checkpointRequests = 0
  private stream!: ReadableStreamDefaultController<Uint8Array>
  private operation = 0

  fetch: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    const body = JSON.parse(String(init?.body)) as {
      checkpoint_request_id: string
    }
    if (path === `/sync/checkpoint-request`) {
      this.checkpointRequests++
      this.requested.resolve()
      await this.requestResponse.promise
      init?.signal?.throwIfAborted()
      const response = Response.json({
        data: { checkpoint_request_id: body.checkpoint_request_id },
      })
      const read = response.json.bind(response)
      response.json = async () => {
        const value: unknown = await read()
        this.responseRead.resolve()
        return value
      }
      return response
    }
    return new Response(
      new ReadableStream<Uint8Array>({
        start: (stream) => {
          this.stream = stream
          init?.signal?.addEventListener(`abort`, () => {
            try {
              stream.close()
            } catch {
              // The connection may have already closed.
            }
          })
          this.connected.resolve()
        },
      }),
    )
  }

  deliver(
    rows: ReadonlyArray<{ id: string; name: string; stable: string }>,
    deleted: ReadonlyArray<string> = [],
    writeCheckpoint?: string,
  ) {
    const send = (line: unknown) =>
      this.stream.enqueue(new TextEncoder().encode(`${JSON.stringify(line)}\n`))
    send({
      checkpoint: {
        last_op_id: String(this.operation + rows.length + deleted.length + 10),
        write_checkpoint: writeCheckpoint,
        buckets: [{ bucket: `mutation`, checksum: 0 }],
        streams: [{ name: `tasks`, is_default: false, errors: [] }],
      },
    })
    for (const row of rows) {
      const { id, ...data } = row
      send({
        data: {
          bucket: `mutation`,
          data: [
            {
              op_id: String(++this.operation),
              checksum: 0,
              op: `PUT`,
              object_type: `tasks`,
              object_id: id,
              data: JSON.stringify(data),
            },
          ],
        },
      })
    }
    for (const id of deleted)
      send({
        data: {
          bucket: `mutation`,
          data: [
            {
              op_id: String(++this.operation),
              checksum: 0,
              op: `REMOVE`,
              object_type: `tasks`,
              object_id: id,
            },
          ],
        },
      })
    send({ checkpoint_complete: { last_op_id: String(this.operation + 10) } })
  }
}

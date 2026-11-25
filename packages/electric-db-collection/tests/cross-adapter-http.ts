/**
 * Controlled Electric HTTP input for the installed ShapeStream. This transport
 * records requests and sends protocol messages; it computes no public result.
 * A staged complete result uses must-refetch when a cursor would otherwise
 * resume, so a delta-only answer never masquerades as full-source authority.
 */
export type ElectricRequest = {
  url: URL
  signal?: AbortSignal
  respond: (response: Response) => void
}
export const electricTurn = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0))
export async function untilElectric(predicate: () => boolean, premise: string) {
  const deadline = Date.now() + 2500
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error(`Unreached Electric premise: ${premise}`)
    await electricTurn()
  }
}
export class CrossAdapterElectricHTTP {
  readonly requests: Array<ElectricRequest> = []
  readonly pending: Array<ElectricRequest> = []
  readonly handle = `cross-${crypto.randomUUID()}`
  private offset = 0
  schema: Record<string, { type: string; pk_index?: number }> = {
    id: { type: `text`, pk_index: 0 },
    value: { type: `int4` },
  }
  staged: Array<Record<string, unknown>> | undefined
  readonly fetchClient: typeof fetch = (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init?.signal ?? undefined
      const request: ElectricRequest = {
        url: new URL(String(input)),
        signal,
        respond: (response) => {
          signal?.removeEventListener(`abort`, abort)
          resolve(response)
        },
      }
      const abort = () => {
        const position = this.pending.indexOf(request)
        if (position >= 0) this.pending.splice(position, 1)
        reject(signal?.reason ?? new DOMException(`aborted`, `AbortError`))
      }
      if (signal?.aborted) {
        abort()
        return
      }
      signal?.addEventListener(`abort`, abort, { once: true })
      this.requests.push(request)
      this.pending.push(request)
      if (this.staged) this.answerStaged()
    })
  stage(rows: Array<Record<string, unknown>>) {
    this.staged = structuredClone(rows)
    this.answerStaged()
  }
  private answerStaged() {
    const request = this.pending.shift()
    if (!request || !this.staged) return
    if (request.url.searchParams.get(`offset`) !== `-1`) {
      request.respond(
        new Response(
          JSON.stringify([{ headers: { control: `must-refetch` } }]),
          {
            status: 409,
            headers: { 'electric-handle': `${this.handle}-${++this.offset}` },
          },
        ),
      )
      return
    }
    const rows = this.staged
    this.staged = undefined
    this.respond(
      request,
      rows.map((row) => ({
        key: String(row.id),
        value: row,
        headers: { operation: `insert` },
      })),
    )
  }
  respond(request: ElectricRequest, messages: Array<unknown>) {
    const offset = ++this.offset
    request.respond(
      new Response(
        JSON.stringify([
          ...messages,
          {
            headers: {
              control: `up-to-date`,
              global_last_seen_lsn: String(offset),
            },
          },
        ]),
        {
          headers: {
            'electric-handle': `${this.handle}-${offset}`,
            'electric-offset': `${offset}_0`,
            'electric-cursor': String(offset),
            'electric-up-to-date': `true`,
            'electric-schema': JSON.stringify(this.schema),
          },
        },
      ),
    )
  }
  async take(snapshot?: boolean) {
    const matches = (request: ElectricRequest) =>
      snapshot === undefined ||
      request.url.searchParams.has(`subset__where`) === snapshot
    await untilElectric(() => this.pending.some(matches), `HTTP request`)
    return this.pending.splice(this.pending.findIndex(matches), 1)[0]!
  }
  async settle() {
    for (let turn = 0; turn < 4; turn++) await electricTurn()
  }
}

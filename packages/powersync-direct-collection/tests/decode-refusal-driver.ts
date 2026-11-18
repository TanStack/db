/**
 * Real standalone SDK receiving path. JSON carries integer booleans and ISO
 * dates; the application's parser produces native values. Only NDJSON fetch
 * responses are controlled. Wrappers record real SDK resource lifetimes and
 * delegate every acquisition/release; they supply no expected Collection rows.
 */
import { PowerSyncClient, powerSyncCollectionOptions } from '../src'
import { decodeId } from '../../db-adapter-conformance/tests/decode-refusal-oracle'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { createDirectInputLedger } from './direct-input-receiving'
import type { LoadSubsetOptions } from '@tanstack/db'
import type { DecodeAdapter } from '../../db-adapter-conformance/tests/decode-refusal-driver'
import type {
  DecodeBoundary,
  DecodedRow,
} from '../../db-adapter-conformance/tests/decode-refusal-oracle'

/** Receive SDK-only input, retaining incremental cleanup and the body error. */
export async function receiveIdleDecodeCache(
  client: Pick<PowerSyncClient, `listen` | `acquireStreams`>,
  checkpoint: () => Promise<number>,
): Promise<void> {
  const cleanups: Array<() => unknown> = []
  await withOracleCleanup(async () => {
    const unlisten = client.listen(`rows`, { onChanges: () => {} })
    cleanups.unshift(() => unlisten())
    const warm = client.acquireStreams([{ name: `rows` }])
    cleanups.unshift(() => warm.release())
    const synced = warm.waitForSync()
    // A checkpoint error can leave this pending until cleanup aborts it.
    // Observe rejection now while preserving the original promise for await.
    void synced.catch(() => {})
    await checkpoint()
    await synced
  }, cleanups)
}

/** Bind every checkpoint and consumption cut to the request that received it. */
class DecodeService {
  requests = 0
  private stream?: ReadableStreamDefaultController<Uint8Array>
  private signal?: AbortSignal
  private subscriptions: Array<{ stream: string }> = []
  private operation = 0
  readonly fetch: typeof fetch = (_url, init) => {
    this.requests++
    this.subscriptions = JSON.parse(String(init?.body)).streams.subscriptions
    this.signal = init?.signal ?? undefined
    return Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>(
          {
            start: (stream) => {
              this.stream = stream
              init?.signal?.addEventListener(
                `abort`,
                () => {
                  try {
                    stream.close()
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
  get live() {
    return !!this.stream && !this.signal?.aborted
  }
  async checkpoint(rows: ReadonlyArray<{ id: string; value: object }>) {
    const deadline = Date.now() + 5000
    while (!this.live) {
      if (Date.now() > deadline)
        throw new Error(`Decode service did not receive an open SDK request`)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    const revision = this.requests
    const target = this.stream!
    const signal = this.signal
    const send = (value: unknown) =>
      target.enqueue(new TextEncoder().encode(`${JSON.stringify(value)}\n`))
    const last = String(this.operation + rows.length + 10)
    send({
      checkpoint: {
        last_op_id: last,
        buckets: [{ bucket: `rows`, checksum: 0 }],
        streams: this.subscriptions.map(({ stream }) => ({
          name: stream,
          is_default: false,
          errors: [],
        })),
      },
    })
    send({
      data: {
        bucket: `rows`,
        data: rows.map(({ id, value }) => ({
          op: `PUT`,
          object_type: `rows`,
          object_id: id,
          data: JSON.stringify(value),
          op_id: String(++this.operation),
          checksum: 0,
        })),
      },
    })
    send({ checkpoint_complete: { last_op_id: last } })
    while (!signal?.aborted && target.desiredSize !== 0) {
      if (Date.now() > deadline)
        throw new Error(`Decode SDK did not consume the checkpoint`)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    return revision
  }
}

export const directDecodeAdapter: DecodeAdapter = {
  async open(h, id) {
    const service = new DecodeService()
    const input = createDirectInputLedger()
    const client = new PowerSyncClient({
      endpoint: `http://localhost:8080`,
      getToken: () => `token`,
      fetch: service.fetch,
      retryDelayMs: 1,
    })
    const authoredRows = (initial: boolean, refusal: boolean) =>
      Array.from({ length: h.count }, (_, index) => ({
        id: decodeId(h, index, initial),
        value: {
          flag: Number((index % 2 === 0) === (initial ? h.flag : !h.flag)),
          when: new Date(
            h.epoch + index + (initial ? 0 : 10_000),
          ).toISOString(),
          refusal: refusal && index === h.refusalIndex ? h.outcome : undefined,
        },
      }))
    let cachedInput: Array<string> = []
    let cachedStartup:
      { clientState: string; providerOpen: boolean } | undefined
    if (h.startup === `cached`) {
      // Populate only the real SDK, before any Collection or source resource
      // exists. Fully retire the external warm resources before startup. The
      // SDK's idle retained table, not an installed Collection fixture, supplies
      // its synchronous initial listener callback.
      await receiveIdleDecodeCache(client, () =>
        service.checkpoint(authoredRows(true, h.outcome !== `valid`)),
      )
      cachedStartup = {
        clientState: client.status.state,
        providerOpen: service.live,
      }
      if (cachedStartup.clientState !== `idle` || cachedStartup.providerOpen)
        throw new Error(`Warm SDK resources did not retire before startup`)
      cachedInput = [...client.tableSnapshot(`rows`).keys()]
      if (cachedInput.length !== h.count)
        throw new Error(`Actual SDK did not retain the authored cached input`)
    }
    const resources: Array<{
      kind: string
      releases: number
      readonly coreReleased: boolean
      prematureReleases: number
    }> = []
    let refusalObserved = false
    const mappedRequests = new WeakMap<object, LoadSubsetOptions>()
    const unloaded = new WeakSet<LoadSubsetOptions>()
    const retained = (
      kind: string,
      release: () => void,
      request?: LoadSubsetOptions,
    ) => {
      const resource = {
        kind,
        releases: 0,
        prematureReleases: 0,
        // Only core's actual request signal or unload call grants retirement.
        // The adapter's internal SDK-wait signal is not such authority.
        get coreReleased() {
          return (
            !!request &&
            (request.signal?.aborted === true || unloaded.has(request))
          )
        },
      }
      resources.push(resource)
      return () => {
        if (!resource.coreReleased && !refusalObserved)
          resource.prematureReleases++
        resource.releases++
        release()
      }
    }
    const listen = client.listen.bind(client)
    client.listen = (...args) => retained(`table-listener`, listen(...args))
    const status = client.subscribeStatus.bind(client)
    Object.defineProperty(client, `subscribeStatus`, {
      value: (...args: Parameters<PowerSyncClient['subscribeStatus']>) =>
        retained(`status-listener`, status(...args)),
    })
    const acquire = client.acquireStreams.bind(client)
    client.acquireStreams = (...args) => {
      const request = mappedRequests.get(args[0])
      if (h.mode === `on-demand` && !request)
        throw new Error(`Decode lease has no actual core request mapping`)
      const lease = input.receiveStreamLease(acquire(...args))
      return {
        waitForSync: lease.waitForSync.bind(lease),
        release: retained(`stream-lease`, lease.release.bind(lease), request),
      }
    }
    const parsed: Array<string> = []
    const boundaryEvents: Array<DecodeBoundary> = []
    const causesThrown: Array<string> = []
    let subsetRequests = 0
    const options = powerSyncCollectionOptions<DecodedRow>({
      id,
      client,
      table: `rows`,
      ...(h.mode === `on-demand`
        ? {
            getSubscriptions: (request) => {
              subsetRequests++
              const streams = [{ name: `rows` }]
              mappedRequests.set(streams, request)
              return streams
            },
          }
        : { streams: [{ name: `rows` }] }),
      parse: (row) => {
        if (typeof row.id !== `string`) throw new Error(`missing id`)
        parsed.push(row.id)
        if (row.refusal === `throw`) {
          boundaryEvents.push(`parser refusal`)
          refusalObserved = true
          const cause = h.throwCause ?? `error`
          causesThrown.push(cause)
          if (cause === `null-prototype`) throw Object.create(null)
          if (cause === `throwing-conversion`)
            throw {
              [Symbol.toPrimitive]() {
                throw new Error(`refused conversion`)
              },
            }
          if (cause === `throwing-prototype`)
            throw new Proxy(
              {},
              {
                getPrototypeOf() {
                  throw new Error(`refused prototype lookup`)
                },
              },
            )
          throw new Error(`refused-${h.coordinate}-${h.refusalIndex}`)
        }
        if (typeof row.flag !== `number` || typeof row.when !== `string`)
          throw new Error(`bad controlled row`)
        if (row.refusal === `changed-id`) {
          boundaryEvents.push(`parser refusal`)
          refusalObserved = true
        }
        return {
          id: row.refusal === `changed-id` ? `${row.id}-changed` : row.id,
          flag: row.flag === 1,
          when: new Date(row.when),
        }
      },
    })
    const sync = options.sync.sync
    options.sync.sync = (params) => {
      const handlers = sync({
        ...params,
        commit: (...args) => input.receipt(params.commit(...args)),
      })
      if (!handlers || typeof handlers === `function`) return handlers
      const unload = handlers.unloadSubset
      return {
        ...handlers,
        unloadSubset: (request) => {
          unloaded.add(request)
          return unload?.(request)
        },
      }
    }
    const propagate = async () => {
      // Before delivery, pending SDK waits are the observation's premise.
      // Delivery itself pumps actual requests and drains their issued input.
      for (let turn = 0; turn < 4; turn++)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    return {
      options,
      parsed,
      causesThrown,
      cachedInput,
      cachedStartup,
      boundaryEvents,
      resources,
      subsetRequests: () => subsetRequests,
      requiredResourceKinds:
        h.startup === `cached` &&
        h.mode === `on-demand` &&
        h.outcome !== `valid`
          ? [`table-listener`]
          : [`table-listener`, `status-listener`, `stream-lease`],
      propagate,
      providerActive: () => service.live,
      normalizeError: (message) =>
        message === `parse must preserve the PowerSync row id`
          ? `invalid-row-id`
          : message,
      deliver: async (initial, refusal) => {
        const rows = authoredRows(initial, refusal)
        // Replacement can replay the real on-demand acquisition. Answer only
        // an actually opened successor, with the exact same authored batch;
        // neither query settlement nor expected rows controls this input cut.
        await input.receive({
          requestRevision: () => service.requests,
          requestOpen: () => service.live,
          deliver: () => service.checkpoint(rows),
          additionalRevision: () => subsetRequests,
        })
      },
    }
  },
}

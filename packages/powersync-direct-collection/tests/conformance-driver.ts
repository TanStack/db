/**
 * Production driver for the shared eager live-source conformance oracle
 * (`packages/db-adapter-conformance`). It runs the direct PowerSync adapter in
 * eager mode over the real `@powersync/standalone-client`, whose sync
 * requests a fake PowerSync service answers (`fake-service.ts`). The provider
 * is that service: the driver writes the sync protocol's NDJSON lines, and
 * the adapter reads the rows through the client's table listener.
 *
 * The oracle's steps map onto PowerSync like this:
 *
 * - a complete delivery is a complete checkpoint holding the source's rows.
 *   The client keeps a bucket's rows across requests and sync runs, so the
 *   checkpoint also removes rows the client still holds that the delivery
 *   omits, as the service does for a resumed bucket. The adapter reads its
 *   table once per sync run, so the driver does not declare
 *   `complete-snapshot`;
 * - a change batch is one complete checkpoint with a `PUT` or `REMOVE` per
 *   change. The client applies a checkpoint as one table change, and the
 *   adapter commits it as one transaction, so the driver declares `per-batch`
 *   commits;
 * - a failure is a checkpoint whose resolved stream reports an error (a
 *   `StreamError`), legal before the first ready. After it, the client keeps
 *   retrying, so the driver does not declare `source-failure-after-ready`;
 * - a retried failure (`retry-policy`) fails the open sync response's body,
 *   as a dropped connection does. The client passes that error to every
 *   table listener and reconnects;
 * - the driver does not declare `delivery-error`: the service reports a
 *   stream error for the whole connection, and only a reconnect with other
 *   parameters can resolve it, so no later checkpoint on the same connection
 *   clears it (see the coverage map);
 * - a provider subscription is a stream lease (`acquireStreams`); its release
 *   is a call of the lease's `release` (LIFE-2, LIFE-10);
 * - the propagation step is the client reading the lines the driver sent
 *   (`settle`), followed by a few event-loop turns for it to apply them.
 *
 * Rows are JSON values in the sync protocol, so the driver declares
 * `jsonValueKinds`. PowerSync keys are strings, so row `n` is id `"n"`, and
 * the shared `observedView` maps each key back with `conformanceKey`. The
 * driver never reads the Collection.
 */
import { createCollection } from '@tanstack/db'
import {
  PowerSyncClient,
  StreamError,
  powerSyncCollectionOptions,
} from '../src'
import {
  conformanceKey,
  jsonValueKinds,
  observedView,
} from '../../db-adapter-conformance/src'
import { FakeService } from './fake-service'
import type { StreamLease } from '../src'
import type {
  ConformanceRow,
  ControlledProvider,
  EagerLiveSourceDriver,
  EagerLiveSourceFixture,
  ProviderChange,
} from '../../db-adapter-conformance/src'

const BUCKET = `rows`
const TABLE = `rows`
const STREAM = `rows`

type DirectRow = Omit<ConformanceRow, `id`> & { id: string }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** How long the driver waits for the client to open a sync request. */
const connectTimeoutMs = 2_000

class DirectProvider implements ControlledProvider {
  readonly service = new FakeService()
  readonly client = new PowerSyncClient({
    endpoint: `http://localhost:8080`,
    getToken: () => `token`,
    fetch: this.service.fetch,
    retryDelayMs: 1,
    maxRetryDelayMs: 1,
  })
  // Release counts, one per lease the adapter acquired.
  private readonly leaseReleases: Array<number> = []
  // The rows the client holds in its bucket.
  private held = new Map<number, ConformanceRow>()

  constructor() {
    // Record each lease the adapter acquires and each release of it.
    const acquire = this.client.acquireStreams.bind(this.client)
    this.client.acquireStreams = (streams, options): StreamLease => {
      const lease = acquire(streams, options)
      const index = this.leaseReleases.push(0) - 1
      return {
        waitForSync: lease.waitForSync,
        release: () => {
          this.leaseReleases[index]!++
          lease.release()
        },
      }
    }
  }

  releases = () => [...this.leaseReleases]

  // Deliveries go to the open sync request; after a retried failure or a
  // restart, the client opens a new one.
  private async connected() {
    const deadline = Date.now() + connectTimeoutMs
    while (!this.service.live) {
      if (Date.now() > deadline) throw new Error(`no open sync request`)
      await sleep(1)
    }
  }

  private async checkpoint(changes: ReadonlyArray<ProviderChange>) {
    await this.connected()
    this.service.checkpoint([BUCKET])
    for (const change of changes) {
      if (change.type === `upsert`) {
        const { id, ...data } = change.row
        this.service.put(BUCKET, TABLE, String(id), data)
        this.held.set(id, change.row)
      } else {
        this.service.remove(BUCKET, TABLE, String(change.id))
        this.held.delete(change.id)
      }
    }
    this.service.complete()
  }

  deliverSnapshot = (rows: ReadonlyArray<ConformanceRow>) => {
    const ids = new Set(rows.map((row) => row.id))
    return this.checkpoint([
      ...[...this.held.keys()]
        .filter((id) => !ids.has(id))
        .map((id) => ({ type: `delete` as const, id })),
      ...rows.map((row) => ({ type: `upsert` as const, row })),
    ])
  }

  deliverChanges = (changes: ReadonlyArray<ProviderChange>) =>
    this.checkpoint(changes)

  fail = async (error: Error) => {
    await this.connected()
    this.service.checkpoint([BUCKET], {
      streams: [
        {
          name: STREAM,
          is_default: false,
          errors: [{ subscription: 0, message: error.message }],
        },
      ],
    })
  }

  transientFailure = async (error: Error) => {
    await this.connected()
    this.service.error(error)
  }

  /** The propagation step: the client read every line, then applied it. */
  settle = async () => {
    if (this.service.live) await this.service.drained()
    for (let turn = 0; turn < 3; turn++) await sleep(0)
  }
}

/** Whether `message` is the oracle's message for injected failure `failure`. */
function namesFailure(message: string, failure: number): boolean {
  return (
    /^conformance (provider|transient) failure \d+$/.test(message) &&
    message.endsWith(` ${failure}`)
  )
}

export function directConformanceDriver(): EagerLiveSourceDriver {
  return {
    adapter: `@tanstack/powersync-direct-collection (eager)`,
    capabilities: new Set([`retry-policy`]),
    changeCommits: `per-batch`,
    valueKinds: jsonValueKinds,
    // The client creates the StreamError the adapter reports for a stream
    // error; it carries the service's message, which names the failure. A
    // retried failure reaches the adapter as the error the driver injected.
    matchesFailure: (reported, failure) =>
      reported instanceof StreamError
        ? reported.messages.some((message) => namesFailure(message, failure))
        : reported instanceof Error && namesFailure(reported.message, failure),
    create(): EagerLiveSourceFixture {
      const provider = new DirectProvider()
      const collection = createCollection(
        powerSyncCollectionOptions<DirectRow>({
          client: provider.client,
          table: TABLE,
          streams: [{ name: STREAM }],
          parse: (row) => row as DirectRow,
        }),
      )
      return {
        collection: observedView(collection, {
          row: ({ id, ...row }: DirectRow) => ({
            ...row,
            id: conformanceKey(id),
          }),
          key: conformanceKey,
        }),
        provider,
        settle: provider.settle,
      }
    },
  }
}

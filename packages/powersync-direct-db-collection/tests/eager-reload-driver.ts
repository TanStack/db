/**
 * PowerSync Direct receives the shared eager laws through its installed SDK.
 * Only the HTTP response is controlled. SDK subscriptions, row decoding,
 * Collection writes, readiness, reload, and cleanup all run production code.
 */
import {
  PowerSyncClient,
  StreamError,
  powerSyncCollectionOptions,
} from '../src'
import {
  EagerProtocolService,
  eagerProtocolTurn,
  untilEagerProtocol,
} from './eager-protocol-service'
import type {
  EagerGateAdapter,
  EagerReloadAdapter,
} from '../../db-adapter-conformance/tests/eager-reload-driver'
import type { StartupRow } from '../../db-adapter-conformance/tests/persisted-startup-oracle'

export function directEagerClient(defaultStream = false) {
  const service = new EagerProtocolService(defaultStream)
  const client = new PowerSyncClient({
    endpoint: `http://localhost:8080`,
    getToken: () => `token`,
    fetch: service.fetch,
    retryDelayMs: 1,
    maxRetryDelayMs: 1,
  })
  let rejectedGates = 0
  let reportedFailures = 0
  const acquire = client.acquireStreams.bind(client)
  client.acquireStreams = (streams, options) => {
    const lease = acquire(streams, {
      ...options,
      onError: (error) => {
        reportedFailures++
        options?.onError?.(error)
      },
    })
    return {
      release: lease.release,
      waitForSync: (signal) =>
        lease.waitForSync(signal).catch((error: unknown) => {
          if (error instanceof StreamError) rejectedGates++
          throw error
        }),
    }
  }
  const options = (id: string) =>
    powerSyncCollectionOptions<StartupRow>({
      id,
      client,
      table: `rows`,
      streams: defaultStream ? [] : [{ name: `rows` }],
      includeDefaultStreams: defaultStream,
      parse: (row) => {
        if (typeof row.id !== `string` || typeof row.value !== `number`)
          throw new Error(`Invalid controlled source row`)
        return { id: row.id, value: row.value }
      },
    })
  const propagate = async () => {
    await untilEagerProtocol(() => service.drained, `SDK consumed NDJSON`)
    // A drained queue establishes SDK consumption. These task boundaries let
    // its finite promise continuations run; the comparison records pending
    // outcomes instead of timing out when the adapter loses a verdict.
    for (let turn = 0; turn < 4; turn++) await eagerProtocolTurn()
  }
  return {
    service,
    client,
    options,
    propagate,
    terminalEntries: () => reportedFailures + rejectedGates,
    dispose: async () => {
      await propagate()
    },
  }
}

export const directEagerReloadAdapter: EagerReloadAdapter = {
  async open(initial, id) {
    const source = directEagerClient()
    // The shared driver changes these rows while target adapter entry is held.
    // Only a new SDK request consumes the staged complete source answer.
    let staged = structuredClone(initial)
    let completedResponse = 0
    const options = source.options(id)
    const sync = options.sync.sync
    options.sync.sync = (params) => {
      source.service.stageRows(staged)
      completedResponse = source.service.completions + 1
      return sync(params)
    }
    return {
      options,
      replace: async (rows) => {
        staged = structuredClone(rows)
      },
      propagate: async () => {
        // The transport must supply this run's checkpoint, including an empty
        // result. SDK readiness witnesses checkpoint application independently
        // of the Collection's readiness and commit calls under judgment.
        await untilEagerProtocol(
          () =>
            source.service.completions >= completedResponse &&
            source.client.status.state === `ready`,
          `new SDK checkpoint applied`,
        )
        await source.propagate()
      },
      dispose: source.dispose,
    }
  },
}

export const directEagerGateAdapter: EagerGateAdapter = {
  sources: [`explicit`, `default`],
  async open(sourceName) {
    const source = directEagerClient(sourceName === `default`)
    return {
      options: source.options,
      hold: () => source.service.hold(),
      deliver: (rows) => source.service.rows(rows),
      reject: (message, reconnect) => source.service.reject(message, reconnect),
      propagate: source.propagate,
      terminalEntries: source.terminalEntries,
      prepareRecovery: async (rows) => {
        await source.service.prepareRecovery(rows)
        await source.propagate()
      },
      matchesFailure: (error, message) =>
        error instanceof Error && error.message.includes(message),
      dispose: source.dispose,
    }
  },
}

/**
 * Two real source Collections share the installed standalone SDK. The service
 * sends protocol checkpoints; every listener, lease, parse, publication and
 * cleanup uses production. No fixture gate delays passive Collection readiness.
 */
import { createCollection } from '@tanstack/db'
import {
  PowerSyncClient,
  StreamError,
  powerSyncCollectionOptions,
} from '../src'
import {
  sortedStartupRows,
  startupRows,
} from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { FakeService } from './fake-service'
import { eagerProtocolTurn, untilEagerProtocol } from './eager-protocol-service'
import { resolveStreams } from './protocol-request'
import type {
  SharedClientCut,
  SharedClientHistory,
  SharedClientObservation,
  SharedClientResource,
  SharedClientState,
  SharedClientWait,
} from '../../db-adapter-conformance/tests/shared-client-oracle'
import type { StartupRow } from '../../db-adapter-conformance/tests/persisted-startup-oracle'

export async function observeDirectSharedClient(
  h: SharedClientHistory,
  id: string,
): Promise<SharedClientObservation> {
  const service = new FakeService()
  const client = new PowerSyncClient({
    endpoint: `http://localhost:8080`,
    getToken: () => `token`,
    fetch: service.fetch,
    retryDelayMs: 1,
  })
  const resources: Array<SharedClientResource> = []
  const waits: Array<SharedClientWait & { signal?: AbortSignal }> = []
  const snapshotWaits = () =>
    waits.map(({ signal, ...wait }) => ({
      ...wait,
      aborted: signal?.aborted === true,
    }))
  let armed = false
  let reentered = false
  // Registered before the Collections. This legal application callback changes
  // the requested generation while the SDK is still notifying ready listeners.
  const stopApplicationStatus = client.subscribeStatus(() => {
    if (!armed || client.status.state !== `ready`) return
    armed = false
    reentered = true
    client.acquireStreams([{ name: `application-transient` }]).release()
  })
  const connectionFailures = new Map<unknown, number>()
  let allocating = -1
  const retain = (kind: string, release: () => void) => {
    const resource = {
      id: resources.length,
      owner: allocating,
      kind,
      releases: 0,
    }
    resources.push(resource)
    return () => {
      resource.releases++
      release()
    }
  }
  const listen = client.listen.bind(client)
  client.listen = (table, listener) =>
    retain(
      `table-listener`,
      listen(table, {
        ...listener,
        onError: (error) => {
          if (!connectionFailures.has(error))
            connectionFailures.set(error, connectionFailures.size + 1)
          listener.onError?.(error)
        },
      }),
    )
  const status = client.subscribeStatus.bind(client)
  Object.defineProperty(client, `subscribeStatus`, {
    value: (...args: Parameters<PowerSyncClient['subscribeStatus']>) =>
      retain(`status-listener`, status(...args)),
  })
  const acquire = client.acquireStreams.bind(client)
  client.acquireStreams = (...args) => {
    const lease = acquire(...args)
    const owner = allocating
    return {
      waitForSync: (signal) => {
        const wait: SharedClientWait & { signal?: AbortSignal } = {
          owner,
          signaled: signal !== undefined,
          aborted: signal?.aborted === true,
          outcome: `pending`,
          signal,
        }
        waits.push(wait)
        const actual = lease.waitForSync(signal)
        void actual.then(
          () => {
            wait.outcome = `fulfilled`
          },
          () => {
            wait.outcome = `rejected`
          },
        )
        return actual
      },
      release: retain(`stream-lease`, lease.release.bind(lease)),
    }
  }
  const collections = [0, 1].map((owner) => {
    const options = powerSyncCollectionOptions<StartupRow>({
      id: `${id}-${owner}`,
      client,
      table: `rows`,
      streams:
        owner === 1 && h.join === `passive`
          ? []
          : [{ name: owner === 0 ? `alpha` : `beta` }],
      includeDefaultStreams: false,
      parse: (row) => {
        if (typeof row.id !== `string` || typeof row.value !== `number`)
          throw new Error(`Invalid controlled row`)
        return { id: row.id, value: row.value }
      },
    })
    const sync = options.sync.sync
    options.sync.sync = (params) => {
      allocating = owner
      try {
        return sync(params)
      } finally {
        allocating = -1
      }
    }
    return createCollection(options)
  })
  const first = collections[0]!
  const second = collections[1]!
  let targetSettled = false
  const snapshot = (): SharedClientCut => ({
    providerState: client.status.state,
    rows: [sortedStartupRows(first.toArray), sortedStartupRows(second.toArray)],
    statuses: [first.status, second.status],
    terminalErrors: [first.health.error !== null, second.health.error !== null],
    newestIsLast: [first, second].map((collection) => {
      const problem = collection.health.failureReason
      return !problem || problem.cause === problem.errors.at(-1)?.cause
    }) as [boolean, boolean],
    targetSettled,
    problems: [first, second].map(
      (collection) =>
        collection.health.failureReason?.errors.map((error) => {
          const cause = error.cause
          return cause instanceof StreamError
            ? {
                kind: `stream` as const,
                stream: cause.stream.name,
                messages: [...cause.messages],
              }
            : connectionFailures.has(cause)
              ? {
                  kind: `connection` as const,
                  attempt: connectionFailures.get(cause)!,
                }
              : { kind: `other` as const }
        }) ?? [],
    ) as SharedClientCut['problems'],
  })
  const propagate = async () => {
    await service.drained()
    for (let turn = 0; turn < 4; turn++) await eagerProtocolTurn()
  }
  const streams = () =>
    (service.lastRequest.streams.subscriptions as Array<{ stream: string }>)
      .map((s) => s.stream)
      .sort()
  const requested = async (names: Array<string>) =>
    untilEagerProtocol(
      () => service.live && JSON.stringify(streams()) === JSON.stringify(names),
      `SDK requested ${names.join(`,`)}`,
    )
  let held: [number, number] = [0, 0]
  const deliver = async (
    masks: [number, number],
    version: number,
    owners: Array<number>,
    failure?: { stream: 0 | 1; version: number },
  ) => {
    const buckets = owners.map((owner) => (owner === 0 ? `alpha` : `beta`))
    service.checkpoint(buckets, {
      streams: resolveStreams(service.lastRequest.streams, (subscription) =>
        subscription.stream ===
        (failure?.stream === 0
          ? `alpha`
          : failure?.stream === 1
            ? `beta`
            : undefined)
          ? `rejected-${failure!.version}-${subscription.stream}`
          : undefined,
      ),
    })
    for (const owner of owners) {
      const bucket = owner === 0 ? `alpha` : `beta`
      for (const row of startupRows(held[owner]! & ~masks[owner]!, version))
        service.remove(bucket, `rows`, row.id)
      for (const { id: key, value } of startupRows(masks[owner]!, version))
        service.put(bucket, `rows`, key, { value })
    }
    held = masks
    service.complete()
    await propagate()
  }
  const reconnect = async () => {
    const before = service.requests.length
    service.close()
    await untilEagerProtocol(
      () => service.live && service.requests.length > before,
      `configuration change opened a successor request`,
    )
  }
  return withOracleCleanup(async () => {
    const initial = first.preload()
    await requested([`alpha`])
    await deliver([h.first, 0], 1, [0])
    await initial
    const target = second.preload().then(() => {
      targetSettled = true
    })
    // The passive path uses no new response. The active path opens beta but
    // receives no checkpoint before the joined cut.
    await requested(h.join === `passive` ? [`alpha`] : [`alpha`, `beta`])
    await propagate()
    const joined = snapshot()
    const requestedAtJoin = streams()
    await deliver([h.first, h.second], 2, h.join === `passive` ? [0] : [0, 1])
    await target
    const both = snapshot()
    let pendingWaitReached = false
    let appliedWaitReached = false
    if (h.waitReentry) {
      // The first transient forces a fresh ready notification without a
      // transport error. The application callback then supersedes it before
      // the adapter's status callback can observe an already-synced lease.
      const revision = service.requests.length
      armed = true
      acquire([{ name: `trigger-transient` }]).release()
      await untilEagerProtocol(
        () => service.live && service.requests.length > revision,
        `trigger opened a successor SDK request`,
      )
      await deliver([h.first, h.second], 2, [0, 1])
      await untilEagerProtocol(
        () =>
          reentered &&
          waits.some(
            (wait) => wait.owner === h.retire && wait.outcome === `pending`,
          ),
        `real SDK wait pending after application status reentry`,
      )
      pendingWaitReached = true
      if (h.waitReentry === `after-checkpoint`) {
        const heldWaits = waits.filter(
          (wait) => wait.owner === h.retire && wait.outcome === `pending`,
        )
        await requested([`alpha`, `beta`])
        await deliver([h.first, h.second], 2, [0, 1])
        appliedWaitReached =
          heldWaits.length > 0 &&
          heldWaits.every((wait) => wait.outcome === `fulfilled`)
      }
    }
    let failed: SharedClientCut | undefined
    let failedAgain: SharedClientCut | undefined
    let peer: SharedClientCut | undefined
    let recovered: SharedClientCut | undefined
    let recoveryPending: SharedClientCut | undefined
    if (h.failure) {
      const fault = h.failure
      const healthy = fault.stream === 0 ? 1 : 0
      const healthyMask = healthy === 0 ? h.first : h.second
      const masks = (mask: number): [number, number] =>
        healthy === 0 ? [mask, 0] : [0, mask]
      await reconnect()
      await deliver(masks(healthyMask), 3, [healthy], {
        stream: fault.stream,
        version: 3,
      })
      failed = snapshot()
      if (fault.repeat) {
        await reconnect()
        await deliver(masks(healthyMask), 3, [healthy], {
          stream: fault.stream,
          version: 4,
        })
        failedAgain = snapshot()
      }
      const peerMask =
        fault.peer === `delete` ? healthyMask & (healthyMask - 1) : healthyMask
      await deliver(masks(peerMask), 4, [healthy], {
        stream: fault.stream,
        version: fault.repeat ? 4 : 3,
      })
      peer = snapshot()
      if (fault.recovery !== `none`) {
        await reconnect()
        await propagate()
        recoveryPending = snapshot()
        await deliver(
          fault.recovery === `unchanged`
            ? [peerMask, peerMask]
            : [h.first, h.second],
          fault.recovery === `unchanged` ? 4 : 5,
          [0, 1],
        )
        recovered = snapshot()
      }
    }
    const resourcesBeforeRetirement = structuredClone(resources)
    const waitsBeforeCleanup = snapshotWaits()
    await collections[h.retire]!.cleanup()
    await requested([h.retire === 0 ? `beta` : `alpha`])
    await propagate()
    const retired = snapshot()
    const resourcesAtRetirement = structuredClone(resources)
    const waitsAtCleanup = snapshotWaits()
    const requestedAfterRetirement = streams()
    const survivor = h.retire === 0 ? 1 : 0
    await deliver(
      survivor === 0 ? [h.next, 0] : [0, h.next],
      h.failure ? 6 : 3,
      [survivor],
    )
    const later = snapshot()
    await collections[survivor]!.cleanup()
    const reached: Array<SharedClientState> = [
      h.join === `passive` ? `passive-cached-join` : `active-join`,
      h.retire === 0 ? `first-retired` : `second-retired`,
    ]
    if (h.join === `active`)
      reached.push(
        h.first === h.second
          ? `equal-support`
          : h.first & h.second
            ? `partial-support`
            : `disjoint-support`,
      )
    if (pendingWaitReached && h.waitReentry === `before-cleanup`)
      reached.push(`wait-pending-before-cleanup`)
    if (appliedWaitReached) reached.push(`wait-applied-before-cleanup`)
    if ((h.first | h.second) & ~h.next) reached.push(`later-omission`)
    if (!h.next) reached.push(`later-empty`)
    if (h.failure && failed && peer) {
      const owner = h.failure.stream
      if (
        failed.providerState === `ready` &&
        failed.problems[owner].some((p) => p.kind === `stream`)
      )
        reached.push(`transport-recovered-stream-rejected`)
      if (
        failed.problems[owner].some((p) => p.kind === `stream`) &&
        failed.problems[owner === 0 ? 1 : 0].length === 0
      )
        reached.push(`rejected-scope`)
      if (
        failedAgain &&
        failedAgain.problems[owner].filter((p) => p.kind === `stream`).length >
          failed.problems[owner].filter((p) => p.kind === `stream`).length
      )
        reached.push(`changed-rejection`)
      if (peer.rows[0].length < failed.rows[0].length)
        reached.push(`healthy-peer-delete`)
      if (
        peer.rows[0].length === failed.rows[0].length &&
        JSON.stringify(peer.rows[0]) !== JSON.stringify(failed.rows[0])
      )
        reached.push(`healthy-peer-update`)
      if (
        recovered &&
        recovered.problems.every((problems) => problems.length === 0)
      )
        reached.push(
          JSON.stringify(recovered.rows) === JSON.stringify(peer.rows)
            ? `recovered-unchanged`
            : `recovered-changed`,
        )
      if (
        recoveryPending?.problems[owner].some(
          (problem) => problem.kind === `stream`,
        )
      )
        reached.push(`recovery-request-open`)
      if (!recovered && retired.statuses[h.retire] === `cleaned-up`)
        reached.push(
          h.retire === owner ? `failed-owner-retired` : `healthy-owner-retired`,
        )
    }
    return {
      joined,
      both,
      ...(failed ? { failed } : {}),
      ...(failedAgain ? { failedAgain } : {}),
      ...(peer ? { peer } : {}),
      ...(recovered ? { recovered } : {}),
      ...(recoveryPending ? { recoveryPending } : {}),
      retired,
      later,
      resourcesBeforeRetirement,
      resourcesAtRetirement,
      finalResources: structuredClone(resources),
      requestedAtJoin,
      requestedAfterRetirement,
      finalProviderState: client.status.state,
      waitsBeforeCleanup,
      waitsAtCleanup,
      reentered,
      reached,
    }
  }, [
    ...collections.map((collection) => () => collection.cleanup()),
    stopApplicationStatus,
  ])
}

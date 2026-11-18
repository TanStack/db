/**
 * Two real source Collections share the installed standalone SDK. The service
 * sends protocol checkpoints; every listener, lease, parse, publication and
 * cleanup uses production. No fixture gate delays passive Collection readiness.
 */
import { createCollection } from '@tanstack/db'
import { PowerSyncClient, powerSyncCollectionOptions } from '../src'
import {
  sortedStartupRows,
  startupRows,
} from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { FakeService } from './fake-service'
import { eagerProtocolTurn, untilEagerProtocol } from './eager-protocol-service'
import type {
  SharedClientCut,
  SharedClientHistory,
  SharedClientObservation,
  SharedClientResource,
  SharedClientState,
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
  client.listen = (...args) => retain(`table-listener`, listen(...args))
  const status = client.subscribeStatus.bind(client)
  Object.defineProperty(client, `subscribeStatus`, {
    value: (...args: Parameters<PowerSyncClient['subscribeStatus']>) =>
      retain(`status-listener`, status(...args)),
  })
  const acquire = client.acquireStreams.bind(client)
  client.acquireStreams = (...args) => {
    const lease = acquire(...args)
    return {
      waitForSync: lease.waitForSync.bind(lease),
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
    rows: [sortedStartupRows(first.toArray), sortedStartupRows(second.toArray)],
    statuses: [first.status, second.status],
    targetSettled,
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
  ) => {
    const buckets = owners.map((owner) => (owner === 0 ? `alpha` : `beta`))
    service.checkpoint(buckets)
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
  return withOracleCleanup(
    async () => {
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
      const resourcesBeforeRetirement = structuredClone(resources)
      await collections[h.retire]!.cleanup()
      await requested([h.retire === 0 ? `beta` : `alpha`])
      await propagate()
      const retired = snapshot()
      const resourcesAtRetirement = structuredClone(resources)
      const requestedAfterRetirement = streams()
      const survivor = h.retire === 0 ? 1 : 0
      await deliver(survivor === 0 ? [h.next, 0] : [0, h.next], 3, [survivor])
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
      if ((h.first | h.second) & ~h.next) reached.push(`later-omission`)
      if (!h.next) reached.push(`later-empty`)
      return {
        joined,
        both,
        retired,
        later,
        resourcesBeforeRetirement,
        resourcesAtRetirement,
        finalResources: structuredClone(resources),
        requestedAtJoin,
        requestedAfterRetirement,
        finalProviderState: client.status.state,
        reached,
      }
    },
    collections.map((collection) => () => collection.cleanup()),
  )
}

/**
 * Actual standalone SDK construction, with pass-through resource recording.
 * Invalid values reach the SDK normalizer. Other stage faults are explicit
 * collaborator exceptions before the public method accepts a new resource.
 * Public preload/cleanup and a surviving real peer supply observation cuts.
 */
import { createCollection } from '@tanstack/db'
import { PowerSyncClient, powerSyncCollectionOptions } from '../src'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { FakeService } from './fake-service'
import { eagerProtocolTurn, untilEagerProtocol } from './eager-protocol-service'
import type { StreamSubscription } from '../src'
import type {
  SharedClientResource,
  SharedConstructionHistory,
  SharedConstructionObservation,
} from '../../db-adapter-conformance/tests/shared-client-oracle'

export async function observeDirectConstruction(
  h: SharedConstructionHistory,
  id: string,
): Promise<SharedConstructionObservation> {
  const service = new FakeService()
  const client = new PowerSyncClient({
    endpoint: `http://localhost:8080`,
    getToken: () => `token`,
    fetch: service.fetch,
    retryDelayMs: 1,
  })
  let owner = 1
  let failedStageReached = h.stage === `successful-start`
  let primary: unknown
  const fault = new Error(`construction-${h.coordinate}`)
  const resources: Array<SharedClientResource & { dispose: () => void }> = []
  const retain = (kind: string, dispose: () => void) => {
    const record = { id: resources.length, owner, kind, releases: 0, dispose }
    resources.push(record)
    return () => {
      record.releases++
      dispose()
    }
  }
  const failAt = (
    stage: SharedConstructionHistory[`stage`],
    resourceOwner = owner,
  ) => {
    if (resourceOwner !== 0 || h.stage !== stage || failedStageReached) return
    failedStageReached = true
    primary = fault
    throw fault
  }
  const listen = client.listen.bind(client)
  client.listen = (...args) => {
    failAt(`table-listener`)
    return retain(`table-listener`, listen(...args))
  }
  const status = client.subscribeStatus
  Object.defineProperty(client, `subscribeStatus`, {
    value: (...args: Parameters<typeof status>) => {
      failAt(`status-listener`)
      return retain(`status-listener`, status(...args))
    },
  })
  const acquire = client.acquireStreams.bind(client)
  client.acquireStreams = (...args) => {
    const resourceOwner = owner
    let actual: ReturnType<typeof acquire>
    try {
      actual = acquire(...args)
    } catch (error) {
      failedStageReached = owner === 0 && h.stage === `subscription-values`
      primary = error
      throw error
    }
    return {
      release: retain(`stream-lease`, actual.release),
      waitForSync: (signal) => {
        failAt(`lease-wait`, resourceOwner)
        return actual.waitForSync(signal)
      },
    }
  }
  const values: Record<string, unknown> = {}
  if (h.value === `bigint-parameter`) values.value = BigInt(h.coordinate)
  if (h.value === `circular-parameter`) values.value = values
  if (h.value === `throwing-json`)
    values.toJSON = () => {
      throw fault
    }
  const subscriptions: Array<StreamSubscription> = Array.from(
    { length: h.failureIndex + 1 },
    (_value, index) => ({ name: `valid-${index}` }),
  )
  if (h.stage === `subscription-values`)
    subscriptions[h.failureIndex] = {
      name: h.value === `empty-name` ? `` : `invalid-${h.coordinate}`,
      parameters: values,
    }
  const options = (sourceOwner: number) => {
    const config = powerSyncCollectionOptions<{ id: string; value: number }>({
      id: `${id}-${sourceOwner}`,
      client,
      table: `rows`,
      streams: sourceOwner === 1 ? [{ name: `peer` }] : subscriptions,
      parse: (row) => ({ id: String(row.id), value: Number(row.value) }),
    })
    const sync = config.sync.sync
    config.sync.sync = (params) => {
      owner = sourceOwner
      return sync(params)
    }
    return config
  }
  const peer = h.peer ? createCollection(options(1)) : undefined
  const source = createCollection(options(0))
  const snapshot = () =>
    resources.map(({ dispose: _dispose, ...row }) => ({ ...row }))
  const propagate = async () => {
    if (service.live) await service.drained()
    for (let turn = 0; turn < 4; turn++) await eagerProtocolTurn()
  }
  const deliver = async (value: number) => {
    await untilEagerProtocol(() => service.live, `construction peer request`)
    service.sync(`rows`, `rows`, { [`peer-${h.coordinate}`]: { value } })
    await propagate()
  }
  return withOracleCleanup(async () => {
    if (peer) {
      const pending = peer.preload()
      await deliver(1)
      await pending
    }
    const startup = source.preload()
    let rejected: unknown
    void startup.catch((error) => {
      rejected = error
    })
    if (h.stage === `successful-start`) await deliver(2)
    await startup.catch(() => undefined)
    await propagate()
    const sourceStatus = source.status
    const afterStart = snapshot()
    const primaryErrorPreserved =
      rejected === primary && source.health.error?.cause === primary
    await source.cleanup()
    await propagate()
    const afterSourceCleanup = snapshot()
    await source.cleanup()
    await propagate()
    const afterRepeatedSourceCleanup = snapshot()
    if (peer) await deliver(3)
    const peerStatus = peer?.status
    const peerRows = peer?.toArray.map((row) => row.id).sort()
    await peer?.cleanup()
    await propagate()
    const afterPeerCleanup = snapshot()
    await peer?.cleanup()
    await propagate()
    const reached: Array<SharedConstructionObservation[`reached`][number]> = []
    if (failedStageReached) reached.push(h.stage)
    if (h.stage === `subscription-values` && failedStageReached)
      reached.push(h.value)
    if (peerStatus === `ready` && h.stage !== `successful-start`)
      reached.push(`ready-peer-survives`)
    return {
      primaryErrorPreserved,
      failedStageReached,
      sourceStatus,
      peerStatus,
      peerRows,
      afterStart,
      afterSourceCleanup,
      afterRepeatedSourceCleanup,
      afterPeerCleanup,
      finalResources: snapshot(),
      finalProviderState: client.status.state,
      reached,
    }
  }, [
    () => source.cleanup(),
    () => peer?.cleanup(),
    // Public cleanup cannot reclaim a run whose sync call never returned.
    // Force-dispose only after capturing that failure, so the fixture leaks none.
    () => {
      for (const resource of resources)
        if (!resource.releases) resource.dispose()
    },
  ])
}

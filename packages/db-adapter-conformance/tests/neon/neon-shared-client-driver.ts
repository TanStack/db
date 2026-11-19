/** One installed client carries two independently addressed v2 subscriptions. */
import { createCollection } from '@tanstack/db'
import { retainOracleCleanupObservation } from '../../../db/tests/oracle-cleanup'
import { startupRows } from '../persisted-startup-oracle'
import { NeonSDKProvider, neonSDKQuery } from './neon-sdk-driver'
import { realtimeCollectionOptions } from './vendor/collection-options'
import type { StartupRow } from '../persisted-startup-oracle'
import type {
  NeonSharedHistory,
  NeonSharedObservation,
  NeonSharedState,
} from './neon-shared-client-oracle'

export async function observeNeonSharedClient(
  h: NeonSharedHistory,
  id: string,
  omitResult?: 0 | 1,
): Promise<NeonSharedObservation> {
  const provider = new NeonSDKProvider([
    { name: `id`, type_oid: 25, typmod: -1, codec: `pg_text` },
    { name: `value`, type_oid: 23, typmod: -1, codec: `pg_text` },
  ])
  const collections = [0, 1].map((owner) => {
    const options = realtimeCollectionOptions({
      id: `${id}-${owner}`,
      client: provider.client,
      query: neonSDKQuery<StartupRow>((owner === 0 ? `11` : `22`).repeat(32)),
      getKey: (row: StartupRow) => row.id,
      startSync: false,
    })
    if (owner === omitResult) {
      const source = options.sync.sync
      options.sync.sync = (params) =>
        source({ ...params, commit: () => true, markReady: () => {} })
    }
    return createCollection(options)
  })
  const first = collections[0]!,
    second = collections[1]!
  const snapshot = () => ({
    rows: collections.map((collection) =>
      collection.toArray
        .map(({ id: key, value }) => ({ id: key, value }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ),
    statuses: collections.map((collection) => collection.status),
  })
  const deliver = (mask: number, epoch: number, owner: number) =>
    provider.deliverWireRows(
      startupRows(mask, epoch).map((row, index) => ({
        row_key: (index + 1).toString(16).padStart(64, `0`),
        values: [row.id, String(row.value)],
      })),
      owner,
    )
  return retainOracleCleanupObservation<NeonSharedObservation>(async () => {
    // Observe cancellation at cleanup without awaiting the readiness verdict
    // being tested. Delivery itself consumes the SDK frames synchronously.
    void first.preload().catch(() => {})
    if (h.join === `after-ready`) {
      await deliver(h.first, 1, 0)
    }
    void second.preload().catch(() => {})
    const joined = snapshot()
    if (h.join === `before-ready`) await deliver(h.first, 1, 0)
    await deliver(h.second, 2, 1)
    const both = snapshot()
    const beforeRetirement = provider.resources()
    await collections[h.retire]!.cleanup()
    const retired = snapshot()
    const atRetirement = provider.resources()
    await deliver(h.next, 3, 1 - h.retire)
    const later = snapshot()
    await collections[1 - h.retire]!.cleanup()
    // Reach records actual acquired SDK subscriptions, public status cuts,
    // delivered answers and cleanup. Input masks label their source relation.
    const reached: Array<NeonSharedState> = []
    if (
      beforeRetirement.filter((r) => r.name === `raw subscription`).length === 2
    ) {
      reached.push(
        h.join === `before-ready`
          ? `join-before-readiness`
          : `join-after-readiness`,
      )
      if (retired.statuses[h.retire] === `cleaned-up`)
        reached.push(h.retire === 0 ? `first-retired` : `second-retired`)
      if (h.first === h.second) reached.push(`equal-membership`)
      if ((h.first & h.second) !== 0 && h.first !== h.second)
        reached.push(`partial-membership`)
      if ((h.first & h.second) === 0) reached.push(`disjoint-membership`)
      if (h.next === 0) reached.push(`empty-later-result`)
      if (h.first === 0) reached.push(`empty-first-result`)
      if (h.second === 0) reached.push(`empty-peer-result`)
    }
    return {
      joined,
      both,
      retired,
      later,
      beforeRetirement,
      atRetirement,
      finalResources: provider.resources(),
      clientCloseCalls: provider.clientCloseCalls,
      reached,
    }
  }, [() => first.cleanup(), () => second.cleanup(), () => provider.dispose()])
}

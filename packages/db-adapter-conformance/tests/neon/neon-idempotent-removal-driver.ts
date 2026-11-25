/** Installed SDK raw removals receive the unchanged shared keyed-set judgment. */
import { observeEagerLiveSourceHistory } from '../eager-live-source-framework-oracle'
import { NeonSDKProvider, neonSDKDriver } from './neon-sdk-driver'
import type { EagerLiveSourceHistory } from '../../src'
import type {
  NeonRemovalHistory,
  NeonRemovalObservation,
} from './neon-idempotent-removal-oracle'

export async function observeNeonIdempotentRemoval(
  h: NeonRemovalHistory,
): Promise<NeonRemovalObservation> {
  const base = neonSDKDriver(h.ordered)
  let provider!: NeonSDKProvider
  const history: EagerLiveSourceHistory = [
    {
      kind: `snapshot`,
      rows: [1, 2]
        .filter((id) => h.baseline & (1 << (id - 1)))
        .map((id) => ({ id, title: `retained-${id}`, value: h.value })),
    },
    ...Array.from({ length: h.repeats }, () => ({
      kind: `changes` as const,
      changes:
        h.path === `absent`
          ? []
          : h.path === `present`
            ? [{ type: `delete` as const, id: 1 }]
            : [
                {
                  type: `upsert` as const,
                  row: { id: h.absent, title: `transient`, value: h.value },
                },
                { type: `delete` as const, id: h.absent },
              ],
    })),
  ]
  const raw = await observeEagerLiveSourceHistory(
    {
      ...base,
      create: () => {
        const fixture = base.create()
        if (!(fixture.provider instanceof NeonSDKProvider))
          throw new Error(
            `Neon receiver did not acquire the installed SDK provider`,
          )
        provider = fixture.provider
        const deliver = provider.deliverChanges
        if (h.path === `absent`)
          provider.deliverChanges = (changes, txid, index) =>
            deliver([...changes, { type: `delete`, id: h.absent }], txid, index)
        return fixture
      },
    },
    history,
  )
  const key = (h.path === `present` ? 1 : h.absent)
    .toString(16)
    .padStart(64, `0`)
  const decodedRemovals = provider.receivedRemovals.filter(
    (id) => id === key,
  ).length
  const removalStates: NeonRemovalObservation[`removalStates`] = []
  if (decodedRemovals > 0) {
    removalStates.push(h.baseline ? `retained-baseline` : `empty-baseline`)
    if (h.path === `absent`) {
      removalStates.push(
        h.ordered ? `ordered-absent-removal` : `plain-absent-removal`,
      )
      if (decodedRemovals === h.repeats && h.repeats > 1)
        removalStates.push(`repeated-absent-removal`)
    }
    if (h.path === `transient`) removalStates.push(`transient-row`)
    if (h.path === `present` && h.ordered)
      removalStates.push(`ordered-present-removal`)
  }
  return { ...raw, decodedRemovals, removalStates }
}

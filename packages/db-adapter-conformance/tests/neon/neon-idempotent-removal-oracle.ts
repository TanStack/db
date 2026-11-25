/**
 * A raw Neon removal refines keyed-set deletion, including an absent ID.
 * RawLiveQueryUpdate's public contract imposes no existence precondition; the
 * installed SDK's materialized path also applies removals with Map.delete.
 * Therefore redundant raw removals refine an empty logical change batch. The
 * shared eager-source model and comparison judge every public checkpoint.
 * This owner adds only that receiving translation and its actual SDK premise.
 *
 * Empty/nonempty baselines, plain/ordered protocol, one to three publications,
 * and transient upsert/remove pairs distinguish idempotence from suppressing all
 * removals. Each publication retains its real txid even when no row remains.
 * Baseline IDs1..2 and absent IDs8..12 are disjoint; masks0..3, values-100..100
 * and repeat counts1..3 bound the grammar. Existing-ID removal is excluded from
 * the absent path. Transient and explicit present paths exercise ordinary
 * deletion, including ordered wire.
 * This does not judge malformed frames, remote replication, or durable storage.
 */
import fc from 'fast-check'
import {
  oracleProperty,
  pass,
  violation,
} from '../../../db/tests/oracle-property'
import { eagerLiveSourceVerdict } from '../eager-live-source-framework-oracle'
import type { Observation } from '../../../db/tests/oracle-property'
import type { EagerHistoryResult } from '../eager-live-source-framework-oracle'

export type NeonRemovalHistory = {
  baseline: number
  absent: number
  value: number
  ordered: boolean
  repeats: number
  path: `absent` | `transient` | `present`
}
export const neonRemovalStates = [
  `empty-baseline`,
  `retained-baseline`,
  `plain-absent-removal`,
  `ordered-absent-removal`,
  `repeated-absent-removal`,
  `transient-row`,
  `ordered-present-removal`,
] as const
type RemovalState = (typeof neonRemovalStates)[number]
export type NeonRemovalObservation = EagerHistoryResult & {
  decodedRemovals: number
  removalStates: Array<RemovalState>
}
const suffix = {
  absent: fc.integer({ min: 8, max: 12 }),
  value: fc.integer({ min: -100, max: 100 }),
  ordered: fc.boolean(),
  repeats: fc.integer({ min: 1, max: 3 }),
}
const historyArb: fc.Arbitrary<NeonRemovalHistory> = fc.oneof(
  fc.record({
    ...suffix,
    baseline: fc.integer({ min: 0, max: 3 }),
    path: fc.constantFrom(`absent` as const, `transient` as const),
  }),
  fc.record({
    ...suffix,
    // Key1 must exist for this adjacent non-idempotent removal witness.
    baseline: fc.constantFrom(1, 3),
    path: fc.constant(`present` as const),
  }),
)
export function registerNeonIdempotentRemoval(
  property: string,
  receive: (h: NeonRemovalHistory) => Promise<NeonRemovalObservation>,
) {
  const required = new WeakMap<NeonRemovalHistory, RemovalState>()
  const constructed = neonRemovalStates.map((state) => ({
    name: `generated ${state}`,
    enters: [state],
    build: (h: NeonRemovalHistory) => {
      const next = { ...h }
      if (state === `empty-baseline`)
        Object.assign(next, { baseline: 0, path: `absent` })
      if (state === `retained-baseline`) next.baseline ||= 1
      if (state === `plain-absent-removal`)
        Object.assign(next, { path: `absent`, ordered: false })
      if (state === `ordered-absent-removal`)
        Object.assign(next, { path: `absent`, ordered: true })
      if (state === `repeated-absent-removal`)
        Object.assign(next, { path: `absent`, repeats: 3 })
      if (state === `transient-row`) next.path = `transient`
      if (state === `ordered-present-removal`)
        Object.assign(next, { path: `present`, ordered: true, baseline: 1 })
      required.set(next, state)
      return next
    },
  }))
  oracleProperty({
    id: property,
    owns: [`tests/neon/vendor/collection-options.ts`],
    law: {
      statement: `Valid raw Neon removal of an absent identity changes no keyed row, readiness, or health; repeated removals remain harmless and present-row removals still apply.`,
      authority: `@neon/realtime0.2 RawLiveQueryUpdate/LiveQueryChange public contracts; installed reconciliation/ordered-changes Map.delete semantics; shared eager-source PUB-3/FID-4 law.`,
      limits: `Installed SDK with controlled v2 WebSocket, two baseline keys, one absent or transient key, plain/ordered content and one to three publications. Shared eager-source model/checker owns public judgments. No malformed frames, remote replication or durable-storage claim.`,
    },
    histories: {
      arbitrary: historyArb,
      states: neonRemovalStates,
      constructed,
      runs: 60,
      fixedSeeds: [2377],
    },
    // Only the expected reach obligation is local. Public keyed-row, event,
    // status and health predictions remain in the independent shared model.
    model: (h) => required.get(h),
    driver: async (h, observe) => {
      const raw = await receive(h)
      for (const state of raw.removalStates) observe(`reach`, state)
      observe(`completed`, raw)
    },
    check: (_h, trace, expectedState) => {
      const shared = eagerLiveSourceVerdict(trace, [])
      if (shared.kind !== `pass`) return shared
      const raw = trace.find((entry) => entry.checkpoint === `completed`)
        ?.value as NeonRemovalObservation | undefined
      if (!raw?.decodedRemovals)
        return violation(
          `SDK removal`,
          `no decoded removal`,
          `SDK receiving premise`,
        )
      if (expectedState && !raw.removalStates.includes(expectedState))
        return violation(
          `reach`,
          `missing ${expectedState}`,
          `constructed builder reach`,
        )
      return pass
    },
    calibrations: [
      {
        name: `missing actual SDK removals`,
        history: { constructed: `generated ordered-absent-removal` },
        law: `SDK receiving premise`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint === `completed`
              ? {
                  ...entry,
                  value: {
                    ...(entry.value as NeonRemovalObservation),
                    decodedRemovals: 0,
                  },
                }
              : entry,
          ),
      },
      ...neonRemovalStates.map((state) => ({
        name: `missing construction ${state}`,
        history: { constructed: `generated ${state}` },
        law: `constructed builder reach`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint === `completed`
              ? {
                  ...entry,
                  value: {
                    ...(entry.value as NeonRemovalObservation),
                    removalStates: [],
                  },
                }
              : entry,
          ),
      })),
    ],
  })
}

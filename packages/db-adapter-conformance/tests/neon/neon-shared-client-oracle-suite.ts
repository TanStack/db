/** Both native hosts execute one exact-query isolation model and comparison. */
import {
  oracleProperty,
  pass,
  violation,
} from '../../../db/tests/oracle-property'
import {
  neonSharedHistoryArb,
  neonSharedModel,
  neonSharedStates,
  neonSharedViolations,
} from './neon-shared-client-oracle'
import type { Observation } from '../../../db/tests/oracle-property'
import type {
  NeonSharedHistory,
  NeonSharedObservation,
  NeonSharedState,
} from './neon-shared-client-oracle'

export function registerNeonSharedClient(
  property: string,
  receive: (
    h: NeonSharedHistory,
    id: string,
    omitResult?: 0 | 1,
  ) => Promise<NeonSharedObservation>,
  { owns }: { owns: ReadonlyArray<string> },
) {
  let sequence = 0
  const required = new WeakMap<NeonSharedHistory, NeonSharedState>()
  const constructed = neonSharedStates.map((state) => ({
    name: `generated ${state}`,
    enters: [state],
    build: (h: NeonSharedHistory): NeonSharedHistory => {
      const built = { ...h }
      if (state === `join-before-readiness`) built.join = `before-ready`
      if (state === `join-after-readiness`) built.join = `after-ready`
      if (state === `first-retired`) built.retire = 0
      if (state === `second-retired`) built.retire = 1
      if (state === `equal-membership`) built.second = h.first
      if (state === `partial-membership`)
        Object.assign(built, { first: 3, second: 6 })
      if (state === `disjoint-membership`)
        Object.assign(built, { first: 1, second: 2 })
      if (state === `empty-later-result`) built.next = 0
      if (state === `empty-first-result`)
        Object.assign(built, { first: 0, join: `after-ready` })
      if (state === `empty-peer-result`) built.second = 0
      required.set(built, state)
      return built
    },
  }))
  const corrupt =
    (
      mutate: (
        h: NeonSharedHistory,
        raw: NeonSharedObservation,
      ) => NeonSharedObservation,
    ) =>
    (trace: ReadonlyArray<Observation>, h: NeonSharedHistory) =>
      trace.map((entry) =>
        entry.checkpoint === `shared exact queries`
          ? { ...entry, value: mutate(h, entry.value as NeonSharedObservation) }
          : entry,
      )
  const drive =
    (omitResult?: 0 | 1) =>
    async (
      h: NeonSharedHistory,
      observe: (checkpoint: string, value: unknown) => void,
    ) => {
      const raw = await receive(h, `${property}-${sequence++}`, omitResult)
      for (const state of raw.reached) observe(`reach`, state)
      observe(`shared exact queries`, raw)
    }
  oracleProperty({
    id: property,
    owns,
    law: {
      statement: `Two exact-query Collections share a reusable Neon client independently: each authoritative answer replaces only its result, and peer cleanup preserves survivor readiness, rows, later delivery and resources.`,
      authority: `RealtimeCollectionConfig.client/query and RawLiveQuerySubscription.unsubscribe public contracts; Collection cleanup API and glossary sync run.`,
      limits: `Two distinct query fingerprints, three string keys and numeric values, joining before/after first readiness, either retirement and a later complete answer through installed Neon SDK over controlled v2 WebSocket. No table union, same-query cache, passive startup, error, mutation, persistence, renewal or deployed service claim.`,
    },
    histories: {
      arbitrary: neonSharedHistoryArb,
      states: neonSharedStates,
      constructed,
      runs: 40,
      fixedSeeds: [2377],
    },
    model: neonSharedModel,
    driver: drive(),
    check: (h, trace, expected) => {
      const raw = trace.find(
        (entry) => entry.checkpoint === `shared exact queries`,
      )?.value as NeonSharedObservation | undefined
      if (!raw)
        return violation(
          `shared exact queries`,
          `missing observation`,
          `exact query isolation`,
        )
      const failures = neonSharedViolations(h, raw)
      if (failures.length)
        return violation(
          `shared exact queries`,
          failures.join(`; `),
          `exact query isolation`,
          { actual: raw, expected },
        )
      if (raw.cleanupErrors?.length)
        return violation(
          `receiving cleanup`,
          raw.cleanupErrors.join(`; `),
          `receiving cleanup`,
        )
      const state = required.get(h)
      if (
        state &&
        !trace.some(
          (entry) => entry.checkpoint === `reach` && entry.value === state,
        )
      )
        return violation(
          `reach`,
          `missing ${state}`,
          `constructed builder reach`,
        )
      return pass
    },
    calibrations: [
      {
        name: `source skips first empty completion`,
        history: { constructed: `generated empty-first-result` },
        law: `exact query isolation`,
        driver: drive(0),
      },
      {
        name: `source skips peer empty completion`,
        history: { constructed: `generated empty-peer-result` },
        law: `exact query isolation`,
        driver: drive(1),
      },
      {
        name: `peer answer replaces the first query`,
        history: { constructed: `generated disjoint-membership` },
        law: `exact query isolation`,
        corrupt: corrupt((_h, raw) => ({
          ...raw,
          both: { ...raw.both, rows: [raw.both.rows[1]!, raw.both.rows[1]!] },
        })),
      },
      {
        name: `peer cleanup releases the survivor`,
        history: { constructed: `generated first-retired` },
        law: `exact query isolation`,
        corrupt: corrupt((_h, raw) => ({
          ...raw,
          atRetirement: raw.atRetirement.map((r) => ({ ...r, releases: 1 })),
        })),
      },
      {
        name: `survivor misses its later result`,
        history: { constructed: `generated empty-later-result` },
        law: `exact query isolation`,
        corrupt: corrupt((h, raw) => ({
          ...raw,
          later: {
            ...raw.later,
            rows:
              h.retire === 0
                ? [[], [{ id: `wrong`, value: 0 }]]
                : [[{ id: `wrong`, value: 0 }], []],
          },
        })),
      },
      {
        name: `duplicate final teardown`,
        history: { constructed: `generated second-retired` },
        law: `exact query isolation`,
        corrupt: corrupt((_h, raw) => ({
          ...raw,
          finalResources: raw.finalResources.map((r, index) =>
            index === 0 ? { ...r, releases: 2 } : r,
          ),
        })),
      },
      {
        name: `completed result keeps cleanup diagnostics`,
        history: { constructed: `generated join-after-readiness` },
        law: `receiving cleanup`,
        corrupt: corrupt((_h, raw) => ({
          ...raw,
          cleanupErrors: [`injected receiving cleanup failure`],
        })),
      },
      {
        name: `product mismatch keeps its primary law`,
        history: { constructed: `generated empty-later-result` },
        law: `exact query isolation`,
        corrupt: corrupt((h, raw) => ({
          ...raw,
          cleanupErrors: [`secondary receiving cleanup failure`],
          later: {
            ...raw.later,
            rows:
              h.retire === 0
                ? [[], [{ id: `wrong`, value: 0 }]]
                : [[{ id: `wrong`, value: 0 }], []],
          },
        })),
      },
      ...neonSharedStates.map((state) => ({
        name: `missing construction ${state}`,
        history: { constructed: `generated ${state}` },
        law: `constructed builder reach`,
        corrupt: (trace: ReadonlyArray<Observation>, h: NeonSharedHistory) =>
          required.get(h) === state
            ? trace.filter(
                (entry) =>
                  !(entry.checkpoint === `reach` && entry.value === state),
              )
            : undefined,
      })),
    ],
    timeout: 120_000,
  })
}

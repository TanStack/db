/** Same-table composition uses one independent judgment in Node and Chromium. */
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  sharedClientHistoryArb,
  sharedClientModel,
  sharedClientStates,
  sharedClientViolations,
} from './shared-client-oracle'
import type { Observation } from '../../db/tests/oracle-property'
import type {
  SharedClientHistory,
  SharedClientObservation,
  SharedClientState,
} from './shared-client-oracle'

export function registerSharedClientConformance(
  property: string,
  receive: (
    history: SharedClientHistory,
    id: string,
  ) => Promise<SharedClientObservation>,
  { owns }: { owns: ReadonlyArray<string> },
) {
  let sequence = 0
  const required = new WeakMap<SharedClientHistory, SharedClientState>()
  // Each builder starts with generated values and changes only the premise its
  // state needs. Fresh identities retain each built base's state obligation.
  const constructed = sharedClientStates.flatMap((state, stateIndex) =>
    Array.from({ length: stateIndex < 9 ? 1 : 5 }, (_, index) => ({
      name: `generated ${state}${index ? ` ${index + 1}` : ``}`,
      enters: [state],
      build: (h: SharedClientHistory): SharedClientHistory => {
        const built = { ...h }
        delete built.failure
        delete built.waitReentry
        if (state.startsWith(`wait-`))
          Object.assign(built, {
            join: `active`,
            second: h.second || 1,
            waitReentry:
              state === `wait-pending-before-cleanup`
                ? `before-cleanup`
                : `after-checkpoint`,
          })
        if (stateIndex >= 9 && !state.startsWith(`wait-`)) {
          built.join = `active`
          built.second ||= 1
          built.failure = {
            stream: h.failure?.stream ?? ((h.first % 2) as 0 | 1),
            repeat: state === `changed-rejection` || !!h.failure?.repeat,
            peer: state === `healthy-peer-delete` ? `delete` : `update`,
            recovery:
              state === `recovered-changed`
                ? `changed`
                : state === `recovered-unchanged` ||
                    state === `recovery-request-open`
                  ? `unchanged`
                  : `none`,
          }
          if (state === `failed-owner-retired`)
            built.retire = built.failure.stream
          if (state === `healthy-owner-retired`)
            built.retire = built.failure.stream === 0 ? 1 : 0
        }
        if (state === `passive-cached-join`)
          Object.assign(built, { join: `passive`, second: 0, retire: 1 })
        if (state === `active-join` || state === `first-retired`)
          Object.assign(built, {
            join: `active`,
            second: h.second || 1,
            retire: 0,
          })
        if (state === `second-retired`) built.retire = 1
        if (state === `equal-support`)
          Object.assign(built, { join: `active`, second: h.first })
        if (state === `partial-support`)
          Object.assign(built, { join: `active`, first: 3, second: 6 })
        if (state === `disjoint-support`)
          Object.assign(built, { join: `active`, first: 1, second: 2 })
        if (state === `later-omission` || state === `later-empty`)
          built.next = 0
        required.set(built, state)
        return built
      },
    })),
  )
  const check = (h: SharedClientHistory, trace: ReadonlyArray<Observation>) => {
    const raw = trace.find((entry) => entry.checkpoint === `shared client`)
      ?.value as SharedClientObservation | undefined
    if (!raw)
      return violation(
        `shared client`,
        `missing observation`,
        `same-table composition`,
      )
    const failures = sharedClientViolations(h, raw)
    if (failures.length)
      return violation(
        `shared client`,
        failures.join(`; `),
        `same-table composition`,
        {
          actual: { history: h, observation: raw },
          expected: sharedClientModel(h),
        },
      )
    const state = required.get(h)
    if (
      state &&
      !trace.some(
        (entry) => entry.checkpoint === `reach` && entry.value === state,
      )
    )
      return violation(`reach`, `missing ${state}`, `constructed builder reach`)
    return pass
  }
  const corrupt =
    (
      mutate: (
        h: SharedClientHistory,
        raw: SharedClientObservation,
      ) => SharedClientObservation,
    ) =>
    (trace: ReadonlyArray<Observation>, h: SharedClientHistory) =>
      trace.map((entry) =>
        entry.checkpoint === `shared client`
          ? {
              ...entry,
              value: mutate(h, entry.value as SharedClientObservation),
            }
          : entry,
      )
  oracleProperty({
    id: property,
    owns,
    law: {
      statement: `Same-table source Collections expose the complete synced table, including healthy-peer changes during a scoped rejection. Scoped health retains distinct errors until recovery or release; cleanup preserves the surviving sync run's delivery and resources, and releases pending SDK waits owned by the retired run. Passive cached startup needs no remote checkpoint.`,
      authority: `PowerSync Direct public table/streams options and docs/collections/powersync-direct-collection.md; glossary cleanup.`,
      limits: `Two eager Collections, passive or distinct explicit streams, three keys, request-scoped rejection/recovery or one synchronous application status-listener stream change, one cleanup and a later complete checkpoint over controlled HTTP. No deployed service, persistence, mutations or subsets.`,
    },
    histories: {
      arbitrary: sharedClientHistoryArb,
      states: sharedClientStates,
      constructed,
      runs: 40,
      fixedSeeds: [2377],
      fixed: [
        {
          name: `cached passive join retains a donor`,
          history: { join: `passive`, first: 1, second: 0, next: 2, retire: 1 },
        },
      ],
    },
    model: sharedClientModel,
    driver: async (h, observe) => {
      const raw = await receive(h, `${property}-${sequence++}`)
      for (const state of raw.reached) observe(`reach`, state)
      observe(`shared client`, raw)
    },
    check,
    calibrations: [
      {
        name: `a retired run cannot keep an unsettled SDK wait`,
        history: { constructed: `generated wait-applied-before-cleanup` },
        law: `same-table composition`,
        corrupt: corrupt((h, raw) => ({
          ...raw,
          waitsAtCleanup: [
            ...raw.waitsAtCleanup,
            {
              owner: h.retire,
              signaled: false,
              aborted: false,
              outcome: `pending`,
            },
          ],
        })),
      },
      {
        name: `an optional reported retry remains until recovery or release`,
        history: { constructed: `generated changed-rejection` },
        law: `same-table composition`,
        corrupt: corrupt((h, raw) => ({
          ...raw,
          failedAgain: {
            ...raw.failedAgain!,
            problems: raw.failedAgain!.problems.map((problems, owner) =>
              owner !== h.failure!.stream
                ? problems
                : [
                    ...problems.slice(0, 2),
                    { kind: `connection` as const, attempt: 2 },
                    ...problems.slice(2),
                  ],
            ) as SharedClientObservation['both']['problems'],
          },
        })),
      },
      {
        name: `a later retry cannot replace the original connection failure`,
        history: { constructed: `generated changed-rejection` },
        law: `same-table composition`,
        corrupt: corrupt((_h, raw) => ({
          ...raw,
          failedAgain: {
            ...raw.failedAgain!,
            problems: raw.failedAgain!.problems.map((problems) =>
              problems.map((problem) =>
                problem.kind === `connection`
                  ? { ...problem, attempt: 2 }
                  : problem,
              ),
            ) as SharedClientObservation['both']['problems'],
          },
        })),
      },
      {
        name: `a prior connection error cannot become newest`,
        history: { constructed: `generated changed-rejection` },
        law: `same-table composition`,
        corrupt: corrupt((_h, raw) => ({
          ...raw,
          failedAgain: {
            ...raw.failedAgain!,
            problems: raw.failedAgain!.problems.map((problems) => [
              ...problems.filter((problem) => problem.kind !== `connection`),
              ...problems.filter((problem) => problem.kind === `connection`),
            ]) as SharedClientObservation['both']['problems'],
          },
        })),
      },
      {
        name: `reported rejections preserve oldest-first order`,
        history: { constructed: `generated changed-rejection` },
        law: `same-table composition`,
        corrupt: corrupt((_h, raw) => ({
          ...raw,
          failedAgain: {
            ...raw.failedAgain!,
            problems: raw.failedAgain!.problems.map((problems) =>
              [...problems].reverse(),
            ) as SharedClientObservation['both']['problems'],
          },
        })),
      },
      {
        name: `public problem identifies its newest failure`,
        history: { constructed: `generated changed-rejection` },
        law: `same-table composition`,
        corrupt: corrupt((_h, raw) => ({
          ...raw,
          failedAgain: { ...raw.failedAgain!, newestIsLast: [false, false] },
        })),
      },
      {
        name: `opening a request cannot heal a rejected lease`,
        history: { constructed: `generated recovery-request-open` },
        law: `same-table composition`,
        corrupt: corrupt((_h, raw) => ({
          ...raw,
          recoveryPending: { ...raw.recoveryPending!, problems: [[], []] },
        })),
      },
      {
        name: `healthy peer must not become terminal`,
        history: { constructed: `generated rejected-scope` },
        law: `same-table composition`,
        corrupt: corrupt((_h, raw) => ({
          ...raw,
          failed: { ...raw.failed!, terminalErrors: [true, true] },
        })),
      },
      {
        name: `healthy peer must not clear a rejected lease`,
        history: { constructed: `generated rejected-scope` },
        law: `same-table composition`,
        corrupt: corrupt((_h, raw) => ({
          ...raw,
          failed: { ...raw.failed!, problems: [[], []] },
        })),
      },
      {
        name: `healthy peer changes must reach both Collections`,
        history: { constructed: `generated healthy-peer-delete` },
        law: `same-table composition`,
        corrupt: corrupt((_h, raw) => ({
          ...raw,
          peer: { ...raw.peer!, rows: raw.failed!.rows },
        })),
      },
      {
        name: `changed rejection retains the prior error`,
        history: { constructed: `generated changed-rejection` },
        law: `same-table composition`,
        corrupt: corrupt((_h, raw) => ({
          ...raw,
          failedAgain: { ...raw.failedAgain!, problems: raw.failed!.problems },
        })),
      },
      {
        name: `unchanged recovery clears scoped health`,
        history: { constructed: `generated recovered-unchanged` },
        law: `same-table composition`,
        corrupt: corrupt((_h, raw) => ({
          ...raw,
          recovered: { ...raw.recovered!, problems: raw.peer!.problems },
        })),
      },
      {
        name: `passive waits for another checkpoint`,
        history: { constructed: `generated passive-cached-join` },
        law: `same-table composition`,
        corrupt: corrupt((_h, raw) => ({
          ...raw,
          joined: { ...raw.joined, targetSettled: false },
        })),
      },
      {
        name: `peer table rows omitted`,
        history: { constructed: `generated disjoint-support` },
        law: `same-table composition`,
        corrupt: corrupt((_h, raw) => ({
          ...raw,
          both: { ...raw.both, rows: [[], raw.both.rows[1]] },
        })),
      },
      {
        name: `survivor misses later checkpoint`,
        history: { constructed: `generated equal-support` },
        law: `same-table composition`,
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
        name: `cleanup releases surviving resources`,
        history: { constructed: `generated first-retired` },
        law: `same-table composition`,
        corrupt: corrupt((_h, raw) => ({
          ...raw,
          resourcesAtRetirement: raw.resourcesAtRetirement.map((resource) => ({
            ...resource,
            releases: 1,
          })),
        })),
      },
      ...constructed.map((builder) => ({
        name: `missing construction ${builder.name}`,
        history: { constructed: builder.name },
        law: `constructed builder reach`,
        corrupt: (trace: ReadonlyArray<Observation>, h: SharedClientHistory) =>
          required.get(h) === builder.enters[0]
            ? trace.filter(
                (entry) =>
                  !(
                    entry.checkpoint === `reach` &&
                    entry.value === builder.enters[0]
                  ),
              )
            : undefined,
      })),
    ],
    timeout: 120_000,
  })
}

/**
 * # Can two Collections mirror one RxCollection independently?
 *
 * Each Collection mirrors the whole underlying RxCollection. Ending one sync
 * run releases its subscription and rows, while the peer keeps its rows and
 * receives later RxDB changes. Authority: RxDB collection docs Overview and
 * wrapper instructions; glossary cleanup. No Direct stream-union policy is
 * transferred to this law.
 *
 * Independent judgment is complete authored keyed membership, using the shared
 * startup owner's row constructor. Histories vary empty/nonempty membership,
 * overlap/omission, either retired owner, joining before/after initial readiness
 * and one/two-row pagination. This owner does not model SDK storage machinery,
 * remote replication, errors, persistence wrappers or mutation handlers.
 */
import fc from 'fast-check'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import { startupRows } from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import type { Observation } from '../../db/tests/oracle-property'
import type { StartupRow } from '../../db-adapter-conformance/tests/persisted-startup-oracle'

export type RxdbSharedHistory = {
  initial: number
  next: number
  retire: 0 | 1
  join: `while-loading` | `after-ready`
  batchSize: 1 | 2
}
type Cut = { rows: Array<Array<StartupRow>>; statuses: Array<string> }
export type RxdbSharedObservation = {
  joined: Cut
  both: Cut
  retired: Cut
  later: Cut
  acquisitions: Array<number>
  releasesAtRetirement: Array<number>
  releasesAfterCleanup: Array<number>
  queries: Array<number>
  sourceBefore: number
  sourceAfter: number
  browserErrors?: ReadonlyArray<string>
  cleanupErrors?: ReadonlyArray<string>
}
const arbitrary = fc.record({
  initial: fc.integer({ min: 0, max: 7 }),
  next: fc.integer({ min: 0, max: 7 }),
  retire: fc.constantFrom(0 as const, 1 as const),
  join: fc.constantFrom(`while-loading` as const, `after-ready` as const),
  batchSize: fc.constantFrom(1 as const, 2 as const),
})
const states = [
  `joined-while-loading`,
  `joined-after-ready`,
  `first-retired`,
  `second-retired`,
  `empty-initial`,
  `nonempty-initial`,
  `empty-later`,
  `changed-overlap`,
  `omission`,
  `paged-initial`,
] as const
type State = (typeof states)[number]

// One whole authored source table determines both views. Retirement changes
// only one Collection's lifecycle; it never changes the surviving source table.
function model(h: RxdbSharedHistory) {
  const initial = startupRows(h.initial, 1)
  const next = startupRows(h.next, 2)
  const retired = (rows: Array<StartupRow>): Cut => ({
    rows: h.retire === 0 ? [[], rows] : [rows, []],
    statuses:
      h.retire === 0 ? [`cleaned-up`, `ready`] : [`ready`, `cleaned-up`],
  })
  return {
    joined: {
      rows: h.join === `after-ready` ? [initial, []] : [[], []],
      statuses:
        h.join === `after-ready`
          ? [`ready`, `loading`]
          : [`loading`, `loading`],
    },
    both: { rows: [initial, initial], statuses: [`ready`, `ready`] },
    retired: retired(initial),
    later: retired(next),
    sourceBefore: initial.length,
    sourceAfter: next.length,
  }
}
function reached(
  h: RxdbSharedHistory,
  raw: RxdbSharedObservation,
): Array<State> {
  const entries: Array<State> = []
  if (
    raw.queries.every((count) => count > 0) &&
    raw.acquisitions.every((count) => count === 1)
  ) {
    if (
      raw.joined.statuses[0] === `ready` &&
      raw.joined.statuses[1] === `loading`
    )
      entries.push(`joined-after-ready`)
    if (raw.joined.statuses.every((status) => status === `loading`))
      entries.push(`joined-while-loading`)
    if (raw.sourceBefore === 0) entries.push(`empty-initial`)
    else entries.push(`nonempty-initial`)
    if (raw.sourceAfter === 0) entries.push(`empty-later`)
    if ((h.initial & h.next) !== 0) entries.push(`changed-overlap`)
    if ((h.initial & ~h.next) !== 0) entries.push(`omission`)
    if (
      raw.sourceBefore > h.batchSize &&
      raw.queries.every((count) => count > 2)
    )
      entries.push(`paged-initial`)
  }
  if (raw.retired.statuses[0] === `cleaned-up`) entries.push(`first-retired`)
  if (raw.retired.statuses[1] === `cleaned-up`) entries.push(`second-retired`)
  return entries
}
export function rxdbSharedClientViolations(
  h: RxdbSharedHistory,
  raw: RxdbSharedObservation,
) {
  const expected = model(h)
  const errors = [...(raw.browserErrors ?? [])]
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b)
  for (const cut of [
    `joined`,
    `both`,
    `retired`,
    `later`,
    `sourceBefore`,
    `sourceAfter`,
  ] as const)
    if (!same(raw[cut], expected[cut]))
      errors.push(`${cut} public source refinement`)
  if (
    !same(raw.acquisitions, [1, 1]) ||
    !raw.queries.every((count) => count > 0)
  )
    errors.push(`real provider receiving path`)
  if (!same(raw.releasesAtRetirement, h.retire === 0 ? [1, 0] : [0, 1]))
    errors.push(`cleanup owns only retired subscription`)
  if (!same(raw.releasesAfterCleanup, [1, 1]))
    errors.push(`each subscription released once`)
  return errors
}

export function registerRxdbSharedClient(
  property: string,
  receive: (h: RxdbSharedHistory, id: string) => Promise<RxdbSharedObservation>,
  { owns }: { owns: ReadonlyArray<string> },
) {
  const required = new WeakMap<RxdbSharedHistory, State>()
  const constructed = states.map((state) => ({
    name: `generated ${state}`,
    enters: [state],
    build: (generated: RxdbSharedHistory): RxdbSharedHistory => {
      const h = { ...generated }
      if (state === `joined-while-loading`) h.join = `while-loading`
      if (state === `joined-after-ready`) h.join = `after-ready`
      if (state === `first-retired`) h.retire = 0
      if (state === `second-retired`) h.retire = 1
      if (state === `empty-initial`) h.initial = 0
      if (state === `nonempty-initial`) h.initial ||= 1
      if (state === `empty-later`) h.next = 0
      if (state === `changed-overlap`) {
        h.initial |= 1
        h.next |= 1
      }
      if (state === `omission`) {
        h.initial |= 1
        h.next &= ~1
      }
      if (state === `paged-initial`) {
        h.initial = 7
        h.batchSize = 1
      }
      required.set(h, state)
      return h
    },
  }))
  const corrupt =
    (change: (raw: RxdbSharedObservation) => RxdbSharedObservation) =>
    (trace: ReadonlyArray<Observation>) =>
      trace.map((entry) =>
        entry.checkpoint === `shared RxCollection`
          ? { ...entry, value: change(entry.value as RxdbSharedObservation) }
          : entry,
      )
  let sequence = 0
  oracleProperty({
    id: property,
    owns,
    law: {
      statement: `Two source Collections mirror one whole RxCollection independently; cleanup releases only the retired run, and a surviving run receives later provider changes.`,
      authority: `docs/collections/rxdb-collection.md Overview and Wrap the RxDB collection; glossary cleanup.`,
      limits: `Real RxDB memory storage, two eager Collections, three numeric-valued keys, first query response holds, one cleanup, one later complete replacement through real delete/insert events. No remote replication, concurrent tabs, errors, mutation handlers or persistence wrapper.`,
    },
    histories: { arbitrary, states, constructed, runs: 60, fixedSeeds: [2377] },
    model,
    driver: async (h, observe) => {
      const raw = await receive(h, `${property}-${sequence++}`)
      for (const state of reached(h, raw)) observe(`reach`, state)
      observe(`shared RxCollection`, raw)
    },
    check: (h, trace) => {
      const raw = trace.find(
        (entry) => entry.checkpoint === `shared RxCollection`,
      )?.value as RxdbSharedObservation | undefined
      if (!raw)
        return violation(
          `shared RxCollection`,
          `missing observation`,
          `shared provider isolation`,
        )
      const errors = rxdbSharedClientViolations(h, raw)
      if (errors.length)
        return violation(
          `shared RxCollection`,
          errors.join(`; `),
          `shared provider isolation`,
          { actual: raw, expected: model(h) },
        )
      if (raw.cleanupErrors?.length)
        return violation(
          `receiving cleanup`,
          raw.cleanupErrors.join(`; `),
          `receiving cleanup`,
          { actual: raw, expected: model(h) },
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
        name: `primary wrong snapshot survives secondary cleanup failure`,
        history: { constructed: `generated nonempty-initial` },
        law: `shared provider isolation`,
        corrupt: corrupt((raw) => ({
          ...raw,
          both: { ...raw.both, rows: [[], []] },
          cleanupErrors: [`secondary teardown failure`],
        })),
      },
      {
        name: `wrong peer ready snapshot`,
        history: { constructed: `generated nonempty-initial` },
        law: `shared provider isolation`,
        corrupt: corrupt((raw) => ({
          ...raw,
          both: { ...raw.both, rows: [[], []] },
        })),
      },
      {
        name: `peer cleanup closes survivor`,
        history: { constructed: `generated first-retired` },
        law: `shared provider isolation`,
        corrupt: corrupt((raw) => ({ ...raw, releasesAtRetirement: [1, 1] })),
      },
      {
        name: `survivor loses later write`,
        history: { constructed: `generated changed-overlap` },
        law: `shared provider isolation`,
        corrupt: corrupt((raw) => ({ ...raw, later: raw.retired })),
      },
      ...states.map((state) => ({
        name: `missing construction ${state}`,
        history: { constructed: `generated ${state}` },
        law: `constructed builder reach`,
        corrupt: (trace: ReadonlyArray<Observation>, h: RxdbSharedHistory) =>
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

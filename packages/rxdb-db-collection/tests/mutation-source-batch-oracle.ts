/**
 * # Do RxDB's built-in handlers obey optimistic settlement?
 *
 * The existing optimistic-history owner supplies this judgment unchanged:
 * optimistic state overlays accepted source rows while the handler persists;
 * its own Promise decides completion or failure; an accepted source write
 * applies when optimistic state drops, including after handler rejection.
 * Authority: that owner's acceptance/settlement law, glossary optimistic state
 * and accepted sync transaction, and the RxDB adapter's documented built-in
 * insert/update/delete persistence handlers.
 *
 * The receiving grammar is one direct CRUD request, optional untouched peer,
 * and fulfillment or rejection before/after a real RxDB write. Source events
 * reach the adapter before or after handler settlement. The latter schedule
 * holds a real SDK event at the receiving boundary; it supplies no new event.
 * Numeric model IDs 1/2 map to RxDB primary keys "1"/"2". Its three fields
 * remain ordinary row data; the shared checker also observes source attribution
 * and pending flags. There is no explicit RxDB confirmation API to model.
 * Limits: real memory storage, one request and local SDK event; no competing
 * writer, field deletion, storage schema refusal or persistence wrapper claim.
 * No storage write exists after a before-write refusal, so that outcome has
 * no after-settlement source-event variant. All 15 legal CRUD/outcome/order
 * cells have their own generated construction and receiving reach obligation.
 */
import fc from 'fast-check'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  checkOptimisticHistory,
  optimisticHistoryModel,
  resolveOptimisticHistory,
} from '../../db/tests/optimistic-history-oracle'
import type { Observation } from '../../db/tests/oracle-property'
import type {
  OptimisticHistory,
  OptimisticObservation,
  OptimisticStep,
} from '../../db/tests/optimistic-history-oracle'
import type { RxdbMutationHistory, RxdbMutationResult } from './mutation-driver'

const common = {
  operation: fc.constantFrom(
    `insert` as const,
    `update` as const,
    `delete` as const,
  ),
  peer: fc.boolean(),
  coordinate: fc.integer({ min: -100, max: 100 }),
}
const arbitrary = fc.oneof(
  fc.record({
    ...common,
    outcome: fc.constant(`reject-before-write` as const),
    sourceOrder: fc.constant(`before-settlement` as const),
  }),
  fc.record({
    ...common,
    outcome: fc.constantFrom(
      `fulfilled` as const,
      `reject-after-write` as const,
    ),
    sourceOrder: fc.constantFrom(
      `before-settlement` as const,
      `after-settlement` as const,
    ),
  }),
)
const cells = ([`insert`, `update`, `delete`] as const).flatMap((operation) =>
  ([`fulfilled`, `reject-before-write`, `reject-after-write`] as const).flatMap(
    (outcome) =>
      (outcome === `reject-before-write`
        ? [`before-settlement` as const]
        : [`before-settlement` as const, `after-settlement` as const]
      ).map((sourceOrder) => ({
        operation,
        outcome,
        sourceOrder,
        name: `${operation}:${outcome}:${sourceOrder}`,
      })),
  ),
)
const aggregateStates = [
  `insert`,
  `update`,
  `delete`,
  `fulfilled`,
  `reject-before-write`,
  `reject-after-write`,
  `peer-retained`,
  `no-peer`,
  `source-before-settlement`,
  `source-after-settlement`,
] as const
const states = [...aggregateStates, ...cells.map((cell) => cell.name)]
type State = string

// This projection authors inputs for the existing reference model. It never
// reads provider rows, callback order or the adapter's handler branches.
function history(h: RxdbMutationHistory): OptimisticHistory {
  const before = { id: 1, a: h.coordinate, b: 11, c: 21 }
  const authored = { id: 1, a: h.coordinate + 1, b: 12, c: 22 }
  const steps: Array<OptimisticStep> = [
    h.operation === `delete`
      ? { type: `delete`, key: 1, optimistic: true }
      : {
          type: `edit`,
          key: 1,
          fields: { a: authored.a, b: authored.b, c: authored.c },
          optimistic: true,
        },
  ]
  const source: OptimisticStep = {
    type: `sync`,
    rows: h.operation === `delete` ? [] : [authored],
    deletes: h.operation === `delete` ? [1] : [],
    copies: 1,
    truncate: false,
  }
  const wrote = h.outcome !== `reject-before-write`
  if (wrote && h.sourceOrder === `before-settlement`) steps.push(source)
  steps.push({
    type: `settle`,
    slot: 0,
    success: h.outcome === `fulfilled`,
    cascade: true,
    failure: `reject`,
  })
  if (wrote && h.sourceOrder === `after-settlement`) steps.push(source)
  return {
    initial: [
      ...(h.operation === `insert` ? [] : [before]),
      ...(h.peer ? [{ id: 2, a: h.coordinate + 2, b: 13, c: 23 }] : []),
    ],
    steps,
  }
}
function rxdbMutationSourceBatchModel(h: RxdbMutationHistory) {
  const plan = resolveOptimisticHistory(history(h))
  return { plan, expected: optimisticHistoryModel(plan) }
}
// Keep the owner's exact primary law/checkpoint and row diff. Secondary host
// and cleanup facts must also survive the receiving verdict rendered by the
// framework; retaining them only on the raw observation would hide them.
export function checkRxdbMutationSourceBatch(
  h: RxdbMutationHistory,
  raw: RxdbMutationResult,
  expected = rxdbMutationSourceBatchModel(h),
) {
  const checked = checkOptimisticHistory(
    expected.plan,
    raw.trace,
    expected.expected,
  )
  if (checked.kind !== `pass`) {
    const secondary = {
      cleanupErrors: raw.cleanupErrors ?? [],
      browserErrors: raw.browserErrors ?? [],
    }
    return secondary.cleanupErrors.length || secondary.browserErrors.length
      ? {
          ...checked,
          difference: `${checked.difference}\nSecondary receiving diagnostics: ${JSON.stringify(secondary)}`,
        }
      : checked
  }
  if (
    !raw.entered ||
    !raw.settled ||
    (h.outcome !== `reject-before-write` &&
      (!raw.sourceAccepted || raw.sdkWrites !== 1)) ||
    (h.outcome === `reject-before-write` &&
      (raw.sourceAccepted || raw.sdkWrites))
  )
    return violation(
      `mutation source batch`,
      `real handler/source boundary not entered`,
      `RxDB handler receiving path`,
    )
  if (raw.browserErrors?.length)
    return violation(
      `receiving host`,
      raw.browserErrors.join(`; `),
      `receiving host`,
    )
  if (raw.cleanupErrors?.length)
    return violation(
      `receiving cleanup`,
      raw.cleanupErrors.join(`; `),
      `receiving cleanup`,
    )
  return pass
}
function reached(
  h: RxdbMutationHistory,
  raw: RxdbMutationResult,
): Array<State> {
  const entries: Array<State> = []
  if (raw.entered && raw.settled)
    entries.push(h.operation, h.outcome, h.peer ? `peer-retained` : `no-peer`)
  if (raw.sourceAccepted && raw.sdkWrites === 1)
    entries.push(
      raw.sourceBeforeSettlement
        ? `source-before-settlement`
        : `source-after-settlement`,
    )
  if (
    raw.entered &&
    raw.settled &&
    (h.outcome === `reject-before-write`
      ? !raw.sourceAccepted && !raw.sdkWrites
      : raw.sourceAccepted &&
        raw.sdkWrites === 1 &&
        raw.sourceBeforeSettlement === (h.sourceOrder === `before-settlement`))
  )
    entries.push(`${h.operation}:${h.outcome}:${h.sourceOrder}`)
  return entries
}
export function registerRxdbMutationSourceBatch(
  property: string,
  receive: (h: RxdbMutationHistory, id: string) => Promise<RxdbMutationResult>,
  { owns }: { owns: ReadonlyArray<string> },
) {
  const required = new WeakMap<RxdbMutationHistory, State>()
  const constructed = states.map((state) => ({
    name: `generated ${state}`,
    enters: [state],
    build: (generated: RxdbMutationHistory): RxdbMutationHistory => {
      const h = { ...generated }
      if (state === `insert` || state === `update` || state === `delete`)
        h.operation = state
      if (
        state === `fulfilled` ||
        state === `reject-before-write` ||
        state === `reject-after-write`
      )
        h.outcome = state
      if (state === `peer-retained`) h.peer = true
      if (state === `no-peer`) h.peer = false
      if (
        state === `source-before-settlement` ||
        state === `source-after-settlement`
      ) {
        if (h.outcome === `reject-before-write`) h.outcome = `fulfilled`
        h.sourceOrder =
          state === `source-before-settlement`
            ? `before-settlement`
            : `after-settlement`
      }
      const cell = cells.find((entry) => entry.name === state)
      if (cell)
        Object.assign(h, {
          operation: cell.operation,
          outcome: cell.outcome,
          sourceOrder: cell.sourceOrder,
        })
      if (h.outcome === `reject-before-write`)
        h.sourceOrder = `before-settlement`
      required.set(h, state)
      return h
    },
  }))
  const corrupt =
    (change: (raw: RxdbMutationResult) => RxdbMutationResult) =>
    (trace: ReadonlyArray<Observation>) =>
      trace.map((entry) =>
        entry.checkpoint === `mutation source batch`
          ? { ...entry, value: change(entry.value as RxdbMutationResult) }
          : entry,
      )
  let sequence = 0
  oracleProperty({
    id: property,
    owns,
    law: {
      statement: `RxDB's built-in CRUD handler Promise decides its transaction outcome; real source writes accepted while it persists apply with optimistic-state removal, including after a handler rejection.`,
      authority: `packages/db/tests/optimistic-history-oracle.ts acceptance/settlement law; docs/collections/rxdb-collection.md Overview and wrapper instructions; glossary accepted sync transaction and optimistic state.`,
      limits: `One direct CRUD request, optional peer, real RxDB memory storage, one actual source event and method rejection before/after its write. Numeric IDs map to RxDB string primary keys. No concurrent requests, field deletion, schema validation, remote replication or persistence wrapper.`,
    },
    histories: { arbitrary, states, constructed, runs: 60, fixedSeeds: [2377] },
    model: rxdbMutationSourceBatchModel,
    driver: async (h, observe) => {
      const raw = await receive(h, `${property}-${sequence++}`)
      for (const state of reached(h, raw)) observe(`reach`, state)
      observe(`mutation source batch`, raw)
    },
    check: (h, trace, expected) => {
      const raw = trace.find(
        (entry) => entry.checkpoint === `mutation source batch`,
      )?.value as RxdbMutationResult | undefined
      if (!raw)
        return violation(
          `mutation source batch`,
          `missing receiving trace`,
          `RxDB handler receiving path`,
        )
      const checked = checkRxdbMutationSourceBatch(h, raw, expected)
      if (checked.kind !== `pass`) return checked
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
        name: `settlement exposes stale rows`,
        history: { constructed: `generated fulfilled` },
        law: `rows`,
        corrupt: corrupt((raw) => ({
          ...raw,
          trace: raw.trace.map((entry) =>
            entry.checkpoint.includes(`settle`)
              ? {
                  ...entry,
                  value: {
                    ...entry.value,
                    rows: [
                      {
                        id: 99,
                        a: 0,
                        b: 0,
                        c: 0,
                        $origin: `remote` as const,
                        $hasPendingWrites: false,
                      },
                    ],
                  },
                }
              : entry,
          ),
        })),
      },
      {
        name: `handler rejection loses its exact error`,
        history: { constructed: `generated reject-after-write` },
        law: `outcomes`,
        corrupt: corrupt((raw) => ({
          ...raw,
          trace: raw.trace.map((entry) =>
            entry.checkpoint.includes(`settle`)
              ? {
                  ...entry,
                  value: {
                    ...entry.value,
                    requests: (
                      entry.value as OptimisticObservation
                    ).requests.map((request) => ({
                      ...request,
                      outcome: {
                        status: `rejected` as const,
                        handlerError: false,
                      },
                    })),
                  },
                }
              : entry,
          ),
        })),
      },
      ...states.map((state) => ({
        name: `missing construction ${state}`,
        history: { constructed: `generated ${state}` },
        law: `constructed builder reach`,
        corrupt: (trace: ReadonlyArray<Observation>, h: RxdbMutationHistory) =>
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

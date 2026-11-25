/**
 * # Does a built-in mutation wait for its own source confirmation?
 *
 * TrailBase's built-in handlers keep optimistic rows until they either reject
 * or receive both the backend response and a new change event. An older event for that key
 * cannot confirm a later mutation. Authority: the TrailBase guide's automatic
 * optimistic persistence contract and the handler's documented requirement to
 * wait for its write to appear through the subscription; optimistic history
 * defines acceptance versus application. Accepted source rows publish when
 * the handler settles, so the handler must not await its own applied receipt.
 *
 * This model tracks two obligations, not the adapter's timestamp/id store.
 * Histories vary CRUD, eager/on-demand, either arrival order, a prior same-key
 * event and an untouched peer. One numeric coordinate supplies distinct rows.
 * A public change callback may start the one handler while an older event
 * publishes. That older event cannot confirm the request it caused.
 * A stopped source cannot supply missing confirmation. Once the HTTP response
 * is available, that impossibility rejects without waiting for a deadline
 * (maintainer decision 2026-11-24, N11). A graceful close first drains buffered
 * events. Proof already accepted before closure, cleanup or a cache-prune tick
 * remains valid when the HTTP response follows. A retired run cannot borrow
 * proof from a replacement run. These are finite controlled turns, not an HTTP
 * cancellation or backend rollback promise.
 * No concurrent handlers, server transaction id, remote service, cancellation
 * or arbitrary identifier allocation policy is claimed.
 */
import fc from 'fast-check'
import { mutationConfirmationRows } from '../../db/tests/mutation-confirmation-oracle'
import type {
  MutationConfirmationInputs,
  MutationConfirmationRow,
  MutationOperation,
} from '../../db/tests/mutation-confirmation-oracle'

export type MutationEventHistory = {
  operation: MutationOperation
  mode: `eager` | `on-demand`
  first: `response` | `event`
  previousEvent: boolean
  clockMode: `fixed` | `system`
  peer: boolean
  coordinate: number
  streamEnd?:
    | `before-request`
    | `after-event`
    | `pending-confirmation`
    | `buffered-event`
    | `retired-unconfirmed`
    | `retired-confirmed`
  endKind?: `eof` | `error`
  proofExpiry?: boolean
  missingEvent?: boolean
  reentrantEntry?: boolean
}
// Pending confirmation and buffered EOF require the response first. Retired
// histories hold HTTP through replacement. Only graceful EOF preserves queued
// unread bytes; native stream error is not a legal buffered-event equivalent.
export function legalMutationEvent(h: MutationEventHistory): boolean {
  // The publishing trigger is the older event in these histories. Other
  // priming and lifecycle prefixes are explored by their existing dimensions.
  if (h.reentrantEntry)
    return (
      h.first === `response` &&
      !h.previousEvent &&
      !h.proofExpiry &&
      !h.missingEvent &&
      h.streamEnd === undefined
    )
  if (h.missingEvent)
    return !h.proofExpiry && h.first === `response` && h.streamEnd === undefined
  if (h.proofExpiry) return h.first === `event` && h.streamEnd === undefined
  if (h.streamEnd === `buffered-event`)
    return h.first === `response` && h.endKind === `eof`
  if (h.streamEnd === `pending-confirmation`) return h.first === `response`
  if (h.streamEnd?.startsWith(`retired-`)) return h.first === `event`
  return true
}
export const mutationEventHistoryArb: fc.Arbitrary<MutationEventHistory> = fc
  .record(
    {
      operation: fc.constantFrom(`insert`, `update`, `delete`),
      mode: fc.constantFrom(`eager`, `on-demand`),
      first: fc.constantFrom(`response`, `event`),
      previousEvent: fc.boolean(),
      clockMode: fc.constantFrom(`fixed`, `system`),
      peer: fc.boolean(),
      coordinate: fc.integer({ min: 1, max: 10_000 }),
      streamEnd: fc.constantFrom(
        undefined,
        `before-request`,
        `after-event`,
        `pending-confirmation`,
        `buffered-event`,
        `retired-unconfirmed`,
        `retired-confirmed`,
      ),
      endKind: fc.constantFrom(`eof`, `error`),
      proofExpiry: fc.boolean(),
      missingEvent: fc.boolean(),
      reentrantEntry: fc.boolean(),
    },
    {
      requiredKeys: [
        `operation`,
        `mode`,
        `first`,
        `previousEvent`,
        `clockMode`,
        `peer`,
        `coordinate`,
      ],
    },
  )
  .filter(legalMutationEvent)
export function mutationEventInputs(
  h: MutationEventHistory,
): MutationConfirmationInputs<MutationConfirmationRow> {
  const id = h.coordinate * 2
  return {
    before: { id, name: `before-${id}`, stable: `old-${id}` },
    optimistic: { id, name: `optimistic-${id}`, stable: `old-${id}` },
    confirmed: { id, name: `confirmed-${id}`, stable: `new-${id}` },
    peer: { id: id + 1, name: `peer-${id}`, stable: `peer-${id}` },
  }
}
export const mutationEventRows = (
  h: MutationEventHistory,
  version: `initial` | `optimistic` | `confirmed`,
) =>
  mutationConfirmationRows(h.operation, version, h.peer, mutationEventInputs(h))
export type MutationEventCut = {
  name:
    | `entered`
    | `first-obligation`
    | `both-obligations`
    | `response-without-confirmation`
    | `confirmation-deadline`
    | `replacement-event`
    | `proof-retention`
  rows: Array<MutationConfirmationRow>
  state: string
  settlement: string
  responseConsumed: boolean
  sourceAccepted: boolean
  handlerSettlement: string
}
export type MutationEventResult = {
  cuts: Array<MutationEventCut>
  reached: Array<MutationEventState>
  cleanupErrors?: Array<string>
  browserErrors?: ReadonlyArray<string>
  lifecycle: { status: string; stopped: boolean; subscriptions: number }
  timerLeaksAtCuts: Array<string>
  pruneCallbacksCaptured: number
  pruneCallbacksInvoked: number
  replacementReadiness?: { source: string; query: string }
}
export function mutationEventModel(
  h: MutationEventHistory,
): Array<ReadonlyArray<MutationEventCut>> {
  const unconfirmed =
    h.missingEvent ||
    h.streamEnd === `before-request` ||
    h.streamEnd === `pending-confirmation` ||
    h.streamEnd === `retired-unconfirmed`
  const retired = h.streamEnd?.startsWith(`retired-`) === true
  const confirmed = !unconfirmed
  const earlyRejected = (
    cut: MutationEventCut,
    responseConsumed = false,
  ): MutationEventCut => ({
    ...cut,
    rows: mutationEventRows(h, `initial`),
    state: `failed`,
    settlement: `rejected`,
    handlerSettlement: `rejected`,
    responseConsumed,
  })
  const cuts: Array<MutationEventCut> = [
    {
      name: `entered`,
      rows: mutationEventRows(h, `optimistic`),
      state: `persisting`,
      settlement: `pending`,
      responseConsumed: false,
      sourceAccepted: false,
      handlerSettlement: `pending`,
    },
    {
      name: `first-obligation`,
      rows: mutationEventRows(h, `optimistic`),
      state: `persisting`,
      settlement: `pending`,
      responseConsumed: h.first === `response`,
      sourceAccepted: confirmed && h.first === `event`,
      handlerSettlement: `pending`,
    },
    {
      name: confirmed ? `both-obligations` : `response-without-confirmation`,
      rows: mutationEventRows(
        h,
        confirmed || retired
          ? `confirmed`
          : h.missingEvent
            ? `optimistic`
            : `initial`,
      ),
      state: confirmed ? `completed` : h.missingEvent ? `persisting` : `failed`,
      settlement: confirmed
        ? `fulfilled`
        : h.missingEvent
          ? `pending`
          : `rejected`,
      responseConsumed: true,
      sourceAccepted: confirmed,
      handlerSettlement: confirmed
        ? `fulfilled`
        : h.missingEvent
          ? `pending`
          : `rejected`,
    },
  ]
  if (!confirmed)
    cuts.push({
      name: `confirmation-deadline`,
      rows: mutationEventRows(h, `initial`),
      state: `failed`,
      settlement: `rejected`,
      responseConsumed: true,
      sourceAccepted: false,
      handlerSettlement: `rejected`,
    })
  if (retired) {
    cuts.splice(2, 0, {
      name: `replacement-event`,
      rows: [],
      state: `persisting`,
      settlement: `pending`,
      handlerSettlement: `pending`,
      responseConsumed: false,
      sourceAccepted: confirmed,
    })
    if (unconfirmed) cuts.at(-1)!.rows = mutationEventRows(h, `confirmed`)
  }
  if (h.proofExpiry) cuts.splice(2, 0, { ...cuts[1]!, name: `proof-retention` })
  // Refusing a known-terminal source may happen before or after HTTP. While
  // HTTP remains in flight, this law imposes no cancellation requirement.
  return cuts.map((cut) => {
    if (h.streamEnd === `before-request`) {
      if (
        cut.name === `entered` ||
        (cut.name === `first-obligation` && h.first === `event`)
      )
        return [cut, earlyRejected(cut)]
      return [earlyRejected(cut, false), earlyRejected(cut, true)]
    }
    if (
      h.streamEnd === `retired-unconfirmed` &&
      cut.name === `replacement-event`
    )
      return [
        cut,
        {
          ...cut,
          state: `failed`,
          settlement: `rejected`,
          handlerSettlement: `rejected`,
          rows: mutationEventRows(h, `confirmed`),
        },
      ]
    return [cut]
  })
}
export function mutationEventViolations(
  expected: ReadonlyArray<ReadonlyArray<MutationEventCut>>,
  actual: ReadonlyArray<MutationEventCut>,
) {
  const failures: Array<string> = []
  for (const alternatives of expected) {
    const name = alternatives[0]!.name
    const cut = actual.find((item) => item.name === name)
    if (
      !alternatives.some(
        (wanted) =>
          cut !== undefined &&
          (
            [
              `name`,
              `rows`,
              `state`,
              `settlement`,
              `responseConsumed`,
              `sourceAccepted`,
              `handlerSettlement`,
            ] as const
          ).every(
            (field) =>
              JSON.stringify(cut[field]) === JSON.stringify(wanted[field]),
          ),
      )
    )
      failures.push(`${name}: mutation confirmation differs`)
  }
  return failures
}
export const mutationEventStates = [
  `insert`,
  `update`,
  `delete`,
  `eager`,
  `on-demand`,
  `response-first`,
  `event-first`,
  `old-event-response-first`,
  `fresh-event-response-first`,
  `fixed-clock`,
  `system-clock`,
  `same-clock-prior-event`,
  `terminal-stream-unconfirmed`,
  `terminal-stream-confirmed`,
  `terminal-stream-waiting`,
  `terminal-eof`,
  `terminal-error`,
  `terminal-entry-eof`,
  `terminal-entry-error`,
  `buffered-event-before-close`,
  `retired-unconfirmed-response`,
  `retired-confirmed-response`,
  `accepted-proof-survives-pruning`,
  `healthy-unconfirmed-deadline`,
  `reentrant-insert`,
  `reentrant-update`,
  `reentrant-delete`,
] as const
export type MutationEventState = (typeof mutationEventStates)[number]
export function constructMutationEvent(
  h: MutationEventHistory,
  state: MutationEventState,
): MutationEventHistory {
  h = { ...h, proofExpiry: false, missingEvent: false, reentrantEntry: false }
  if (
    state === `reentrant-insert` ||
    state === `reentrant-update` ||
    state === `reentrant-delete`
  )
    return {
      ...h,
      operation:
        state === `reentrant-insert`
          ? `insert`
          : state === `reentrant-update`
            ? `update`
            : `delete`,
      reentrantEntry: true,
      previousEvent: false,
      first: `response`,
      streamEnd: undefined,
    }
  if (state === `healthy-unconfirmed-deadline`)
    return { ...h, streamEnd: undefined, missingEvent: true, first: `response` }
  if (state === `terminal-entry-eof` || state === `terminal-entry-error`)
    return {
      ...h,
      streamEnd: `before-request`,
      first: `response`,
      endKind: state === `terminal-entry-eof` ? `eof` : `error`,
    }
  if (state === `terminal-stream-waiting`)
    return { ...h, streamEnd: `pending-confirmation`, first: `response` }
  if (state === `terminal-eof` || state === `terminal-error`)
    return {
      ...h,
      streamEnd: `pending-confirmation`,
      first: `response`,
      endKind: state === `terminal-eof` ? `eof` : `error`,
    }
  if (state === `buffered-event-before-close`)
    return {
      ...h,
      streamEnd: `buffered-event`,
      first: `response`,
      endKind: `eof`,
    }
  if (
    state === `retired-unconfirmed-response` ||
    state === `retired-confirmed-response`
  )
    return {
      ...h,
      streamEnd:
        state === `retired-unconfirmed-response`
          ? `retired-unconfirmed`
          : `retired-confirmed`,
      first: `event`,
    }
  if (state === `accepted-proof-survives-pruning`)
    return { ...h, streamEnd: undefined, proofExpiry: true, first: `event` }
  if (state === `terminal-stream-unconfirmed`)
    return { ...h, streamEnd: `before-request`, previousEvent: true }
  if (state === `terminal-stream-confirmed`)
    return { ...h, streamEnd: `after-event`, first: `event` }
  if (state === `insert` || state === `update` || state === `delete`)
    return { ...h, operation: state }
  if (state === `eager` || state === `on-demand`) return { ...h, mode: state }
  if (state === `fixed-clock` || state === `system-clock`)
    return { ...h, clockMode: state === `fixed-clock` ? `fixed` : `system` }
  if (state === `same-clock-prior-event`)
    return {
      ...h,
      clockMode: `fixed`,
      previousEvent: true,
      first: `response`,
      operation: `update`,
      streamEnd: undefined,
    }
  return {
    ...h,
    first: state === `event-first` ? `event` : `response`,
    streamEnd: undefined,
    ...(state === `old-event-response-first`
      ? { previousEvent: true, operation: `update` }
      : state === `fresh-event-response-first`
        ? { previousEvent: false }
        : {}),
  }
}

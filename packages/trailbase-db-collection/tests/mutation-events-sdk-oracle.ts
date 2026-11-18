/**
 * # Does a built-in mutation wait for its own source confirmation?
 *
 * TrailBase's built-in handlers keep optimistic rows until both its backend
 * request and the new change event have arrived. An older event for that key
 * cannot confirm a later mutation. Authority: the TrailBase guide's automatic
 * optimistic persistence contract and the handler's documented requirement to
 * wait for its write to appear through the subscription; optimistic history
 * defines acceptance versus application. Accepted source rows publish when
 * the handler settles, so the handler must not await its own applied receipt.
 *
 * This model tracks two obligations, not the adapter's timestamp/id store.
 * Histories vary CRUD, eager/on-demand, either arrival order, a prior same-key
 * event and an untouched peer. One numeric coordinate supplies distinct rows.
 * No concurrent handlers, server transaction id, remote service, cancellation
 * deadline or arbitrary identifier allocation policy is claimed.
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
  clock: `fixed` | `system`
  peer: boolean
  coordinate: number
}
export const mutationEventHistoryArb: fc.Arbitrary<MutationEventHistory> =
  fc.record({
    operation: fc.constantFrom(`insert`, `update`, `delete`),
    mode: fc.constantFrom(`eager`, `on-demand`),
    first: fc.constantFrom(`response`, `event`),
    previousEvent: fc.boolean(),
    clock: fc.constantFrom(`fixed`, `system`),
    peer: fc.boolean(),
    coordinate: fc.integer({ min: 1, max: 10_000 }),
  })
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
  name: `entered` | `first-obligation` | `both-obligations`
  rows: Array<MutationConfirmationRow>
  state: string
  settlement: string
  responseConsumed: boolean
  sourceAccepted: boolean
}
export type MutationEventResult = {
  cuts: Array<MutationEventCut>
  reached: Array<MutationEventState>
  cleanupErrors?: Array<string>
  browserErrors?: ReadonlyArray<string>
}
export function mutationEventModel(
  h: MutationEventHistory,
): Array<MutationEventCut> {
  return [
    {
      name: `entered`,
      rows: mutationEventRows(h, `optimistic`),
      state: `persisting`,
      settlement: `pending`,
      responseConsumed: false,
      sourceAccepted: false,
    },
    {
      name: `first-obligation`,
      rows: mutationEventRows(h, `optimistic`),
      state: `persisting`,
      settlement: `pending`,
      responseConsumed: h.first === `response`,
      sourceAccepted: h.first === `event`,
    },
    {
      name: `both-obligations`,
      rows: mutationEventRows(h, `confirmed`),
      state: `completed`,
      settlement: `fulfilled`,
      responseConsumed: true,
      sourceAccepted: true,
    },
  ]
}
export function mutationEventViolations(
  expected: ReadonlyArray<MutationEventCut>,
  actual: ReadonlyArray<MutationEventCut>,
) {
  const failures: Array<string> = []
  for (const wanted of expected) {
    const cut = actual.find((item) => item.name === wanted.name)
    if (JSON.stringify(cut) !== JSON.stringify(wanted))
      failures.push(`${wanted.name}: mutation confirmation differs`)
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
] as const
export type MutationEventState = (typeof mutationEventStates)[number]
export function constructMutationEvent(
  h: MutationEventHistory,
  state: MutationEventState,
): MutationEventHistory {
  if (state === `insert` || state === `update` || state === `delete`)
    return { ...h, operation: state }
  if (state === `eager` || state === `on-demand`) return { ...h, mode: state }
  if (state === `fixed-clock` || state === `system-clock`)
    return { ...h, clock: state === `fixed-clock` ? `fixed` : `system` }
  if (state === `same-clock-prior-event`)
    return {
      ...h,
      clock: `fixed`,
      previousEvent: true,
      first: `response`,
      operation: `update`,
    }
  return {
    ...h,
    first: state === `event-first` ? `event` : `response`,
    ...(state === `old-event-response-first`
      ? { previousEvent: true, operation: `update` }
      : state === `fresh-event-response-first`
        ? { previousEvent: false }
        : {}),
  }
}

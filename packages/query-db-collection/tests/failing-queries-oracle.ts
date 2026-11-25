/**
 * While any observed Query fails, the node's `failureReason` lists the
 * failures of the Queries still failing, oldest first, and shows the newest.
 * Each failing Query keeps one failure listed: its latest error. A Query
 * that fails again with a new error replaces its listed failure, so a Query
 * failing on every refetch for hours lists one failure, not one per fetch
 * (review ledger R21: one entry per failing Query, enforced in Query
 * Collection). A Query that recovers while another still fails removes its
 * own failure, so the other Queries' failures keep their places, their `at`,
 * and their causes. When the last failing Query recovers, the slot clears.
 *
 * Core lists one failure per error value (the adapter API's maintainer
 * decision: `reportError` of a value already listed changes nothing, and
 * `reportHealthy(error)` removes the failure whose cause is that value). So
 * Queries that fail with the same value, such as a module-level
 * `throw OFFLINE`, share one listed failure, and it stays while any of them
 * still fails (review ledger R22).
 *
 * The glossary's health tree entry adds identity: the tree keeps stable
 * object identity while its content is unchanged, and `health:change`
 * announces a change (ARCHITECTURE law 17 makes the tree an observation).
 *
 * Limits: one Collection, two subsets, histories of four fetches; a
 * recovery whose result applies late is an ordinary example in query.test.ts.
 */
import { differs, pass, violation } from '../../db/tests/oracle-property'
import type { Observation, Verdict } from '../../db/tests/oracle-property'

/**
 * The history grammar. Two subsets are loaded, and a history is four steps,
 * each a fetch of one subset's Query that succeeds, fails with a fresh error,
 * or fails with one error value shared by every Query and fetch. The source
 * enumerates every such history, once on Query Collection and once behind
 * the persisted wrapper, which relays the adapter's calls to core, so the
 * same model judges Query Collection behind it (receiving witness).
 */
export type Fetch = { subset: 1 | 2; fails: false | `fresh` | `shared` }
export type FailingQueryHistory = {
  persisted: boolean
  index: number
  fetches: Array<Fetch>
  failureStage?: `fetch` | `select`
}
const fetchKinds: ReadonlyArray<Fetch> = [1, 2].flatMap((subset) =>
  ([`fresh`, `shared`, false] as const).map((fails) => ({
    subset: subset as 1 | 2,
    fails,
  })),
)
export function failingQueryFetches(): Array<Array<Fetch>> {
  let histories: Array<Array<Fetch>> = [[]]
  for (let length = 0; length < 4; length++)
    histories = histories.flatMap((history) =>
      fetchKinds.map((fetch) => [...history, fetch]),
    )
  return histories
}
export function failingQueryHistories(): Array<FailingQueryHistory> {
  return [false, true].flatMap((persisted) =>
    failingQueryFetches().map((fetches, index) => ({
      persisted,
      index,
      fetches,
    })),
  )
}

/**
 * The model keeps each failing subset's latest error value and the listed
 * values, oldest first. A failure lists its value at the end unless it is
 * already listed. After every step, a listed value that no failing subset
 * still holds leaves the list.
 *
 * Error values are named by number, in the order the history first throws
 * them: a fresh failure throws a new value, and the first shared failure
 * names the shared value that every later shared failure throws again. The
 * driver names production's listed causes the same way, by the error value
 * the controlled queryFn threw, so the comparison is by identity.
 */
type ModelState = {
  latest: Map<number, number>
  listed: Array<number>
  values: number
  shared?: number
}
type ModelStep = {
  threw: number | null
  listed: Array<number>
  added: number
  removed: number
}
function stepModel(
  state: ModelState,
  { subset, fails }: Fetch,
): { state: ModelState; error: number | null } {
  let values = state.values
  let shared = state.shared
  let error: number | null = null
  if (fails === `fresh`) error = values++
  else if (fails === `shared`) error = shared ??= values++
  const latest = new Map(state.latest)
  let listed = state.listed
  if (error !== null) {
    latest.set(subset, error)
    if (!listed.includes(error)) listed = [...listed, error]
  } else latest.delete(subset)
  const held = new Set(latest.values())
  listed = listed.filter((value) => held.has(value))
  return {
    state: { latest, listed, values, shared },
    error,
  }
}
const initialModel = (): ModelState => ({
  latest: new Map(),
  listed: [],
  values: 0,
})

export function modelFailingQueries(
  history: FailingQueryHistory,
): Array<ModelStep> {
  let state = initialModel()
  return history.fetches.map((fetch) => {
    const previous = state.listed
    const next = stepModel(state, fetch)
    state = next.state
    return {
      threw: next.error,
      listed: state.listed,
      added: state.listed.filter((value) => !previous.includes(value)).length,
      removed: previous.filter((value) => !state.listed.includes(value)).length,
    }
  })
}

/**
 * Declared reach: the states a fetch enters, read from the model before it.
 * They are model-derived, so whether the exhaustive enumeration enters each
 * one is a fact about the grammar and the model alone. The property declares
 * them on its enumerated source and reads each history's states from this
 * classifier, so its `reach` test fails when no enumerated history enters
 * one of them.
 */
export const failingQueryStates = [
  `a Query recovers while another's failure stays listed`,
  `a Query fails again with a new error while its failure is listed`,
  `a Query fails with the error value another Query lists`,
  `a Query recovers while another lists the same error value`,
] as const
export function failingQueryReach(
  fetches: ReadonlyArray<Fetch>,
): Set<(typeof failingQueryStates)[number]> {
  const reached = new Set<(typeof failingQueryStates)[number]>()
  let state = initialModel()
  for (const fetch of fetches) {
    const { subset, fails } = fetch
    const next = stepModel(state, fetch)
    const own = state.latest.get(subset)
    const others = [...state.latest].filter(([other]) => other !== subset)
    if (fails && own !== undefined && own !== next.error)
      reached.add(
        `a Query fails again with a new error while its failure is listed`,
      )
    if (fails && others.some(([, value]) => value === next.error))
      reached.add(`a Query fails with the error value another Query lists`)
    if (!fails && own !== undefined && others.length > 0) {
      reached.add(`a Query recovers while another's failure stays listed`)
      if (others.some(([, value]) => value === own))
        reached.add(`a Query recovers while another lists the same error value`)
    }
    state = next.state
  }
  return reached
}

export type StepObservation = {
  thrownDelta: number
  threw: number | null
  threwMessage: string | null
  listed: Array<number>
  shown: number | null
  shownMessage: string | null
  atKept: Array<boolean | null>
  sameNode: boolean
  sameFailureReason: boolean
  changes: number
  refusalReached: boolean
  status: string
  rows: Array<{ id: number }>
  observers: number
}

/**
 * The check, after each step: a failing fetch threw once, the model's error
 * value; `failureReason.errors` lists exactly the model's values, by
 * identity and in order; its `cause` is the newest's, and its `message` is
 * the message that value had when the queryFn threw it; a failure listed before and after keeps its entry's `at`. A step
 * that leaves the list as it was keeps the node and its `failureReason`
 * object and announces no `health:change`. A step that adds or removes one
 * failure, or clears the slot, announces one; a step that replaces a Query's
 * failure announces at least one.
 */
export function checkFailingQueries(
  history: FailingQueryHistory,
  trace: ReadonlyArray<Observation>,
  expected: Array<ModelStep>,
): Verdict {
  const steps = trace
    .filter((entry) => entry.checkpoint === `step`)
    .map((entry) => entry.value as StepObservation)
  // The message each error value had when the queryFn threw it.
  const messages = new Map<number, string>()
  for (const [at, step] of steps.entries()) {
    const owed = expected[at]!
    const label = `step ${at}`
    if (step.threw !== null) messages.set(step.threw, step.threwMessage!)
    const newest = owed.listed.at(-1)
    const wrong =
      (history.fetches[at]!.fails
        ? differs(
            `step`,
            `the fetch failed`,
            { thrownDelta: step.thrownDelta, threw: step.threw },
            { thrownDelta: 1, threw: owed.threw },
            `${label}: the fetch did not throw the model's error value once`,
          )
        : undefined) ??
      differs(
        `step`,
        `listed causes`,
        step.listed,
        owed.listed,
        `${label}: failureReason.errors lists other causes`,
      ) ??
      differs(
        `step`,
        `shown cause`,
        step.shown,
        owed.listed.at(-1) ?? null,
        `${label}: failureReason shows another cause`,
      ) ??
      differs(
        `step`,
        `shown message`,
        step.shownMessage,
        newest === undefined ? null : (messages.get(newest) ?? null),
        `${label}: failureReason shows another message`,
      ) ??
      (step.atKept.includes(false)
        ? violation(
            `step`,
            `${label}: a failure listed before and after changed its at`,
            `a kept failure keeps its at`,
          )
        : undefined) ??
      (owed.added + owed.removed === 0
        ? differs(
            `step`,
            `an unchanged list keeps the health tree`,
            {
              sameNode: step.sameNode,
              sameFailureReason: step.sameFailureReason,
              changes: step.changes,
            },
            { sameNode: true, sameFailureReason: true, changes: 0 },
            `${label}: the health tree changed or announced a change`,
          )
        : owed.added + owed.removed === 1 || owed.listed.length === 0
          ? differs(
              `step`,
              `one change announces one health:change`,
              step.changes,
              1,
              `${label}: one failure added or removed, or the slot cleared, announced another number of changes`,
            )
          : step.changes > 0
            ? undefined
            : violation(
                `step`,
                `${label}: a replaced failure announced no health:change`,
                `a replaced failure announces a change`,
              ))
    if (wrong) return wrong
  }
  return steps.length === history.fetches.length
    ? pass
    : violation(
        `step`,
        `the history recorded ${steps.length} of its ${history.fetches.length} steps`,
        `trace complete`,
      )
}

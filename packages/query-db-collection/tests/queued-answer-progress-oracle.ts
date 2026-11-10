import { isDeepStrictEqual } from 'node:util'
import fc from 'fast-check'
import { declareOracle } from '../../db/tests/oracle-declaration.js'
import {
  checkReplayPublication,
  modelOrderedReplayWindow,
} from '../../db/tests/query/load-subset-retained-publication-oracle.js'

/**
 * A finite backend answer already queued in the host must get a turn. This
 * conditional progress law was accepted in H02-CONDITIONAL-QUEUED-PROGRESS;
 * receipt SHA256 e12e53f13adc3ee9d393501deb588e26d8a0aae1c9bb9191b86fb71cd634e142.
 * Cached observer ownership and atomic publication remain separate laws.
 *
 * The new judgment observes host callback execution, not graph iterations.
 * Operational watchdog expiry is bounded non-completion evidence, never a
 * product deadline or proof of infinite execution. Permanent cache conflict,
 * failed answers and providers that never answer are outside this grammar.
 * Final/publication values reuse the replay owner's independent computation.
 */
export type QueryProgressHistory = {
  kind: `query`
  scheduler: `microtask` | `timer`
  cacheIdentity: `subscription` | `scope`
  includes: boolean
  window: boolean
  nonemptyPrior: boolean
  keyShift: number
  rankScale: number
}

export type SynchronousProgressHistory = {
  kind: `sync-initial` | `sync-mutation`
  keyShift: number
  rankScale: number
}

export type ProgressHistory = QueryProgressHistory | SynchronousProgressHistory
// This model observes the authored query payload. Published Collection rows
// also expose the four public VirtualRowProps fields (live-queries.md, Virtual
// properties); raw receipts preserve those fields. Their classification and
// attribution law belongs to virtual-row-fields-oracle.test.ts. This payload
// judgment does not establish temporal metadata coherence across Query reloads.
export type ProgressRow = { id: number; rank: number; markers: Array<number> }

export const queuedAnswerExample: QueryProgressHistory = {
  kind: `query`,
  scheduler: `microtask`,
  cacheIdentity: `subscription`,
  includes: true,
  window: true,
  nonemptyPrior: false,
  keyShift: 0,
  rankScale: 10,
}

/**
 * Five ordered roots reconstruct the known trace. Translation and rank scale
 * preserve its relations without relying on literal key3. A second unmatched
 * root challenges retention with a nonempty prior publication. Scope-only
 * function keys, no include and no window ablate the conflicting cache path.
 * Both function-key forms extend their own actual empty-options callback.
 */
export const progressExamples: Array<ProgressHistory> = [
  queuedAnswerExample,
  { ...queuedAnswerExample, scheduler: `timer` },
  { ...queuedAnswerExample, nonemptyPrior: true },
  { ...queuedAnswerExample, cacheIdentity: `scope` },
  { ...queuedAnswerExample, includes: false },
  { ...queuedAnswerExample, window: false },
  { kind: `sync-initial`, keyShift: 0, rankScale: 10 },
  { kind: `sync-mutation`, keyShift: 0, rankScale: 10 },
]

export const progressHistoryArbitrary: fc.Arbitrary<ProgressHistory> = fc.oneof(
  fc.record({
    kind: fc.constant(`query` as const),
    scheduler: fc.constantFrom(`microtask` as const, `timer` as const),
    cacheIdentity: fc.constantFrom(`subscription` as const, `scope` as const),
    includes: fc.boolean(),
    window: fc.boolean(),
    nonemptyPrior: fc.boolean(),
    keyShift: fc.integer({ min: 0, max: 20 }),
    rankScale: fc.integer({ min: 1, max: 20 }),
  }),
  fc.record({
    kind: fc.constantFrom(`sync-initial` as const, `sync-mutation` as const),
    keyShift: fc.integer({ min: 0, max: 20 }),
    rankScale: fc.integer({ min: 1, max: 20 }),
  }),
)

// Every generated family includes both prior-publication shapes. This avoids
// depending on random sampling to reach the conditional law's hard premise.
export function progressHistoryFamily(
  history: ProgressHistory,
): Array<ProgressHistory> {
  const strict = {
    ...queuedAnswerExample,
    keyShift: history.keyShift,
    rankScale: history.rankScale,
    scheduler:
      history.kind === `query` ? history.scheduler : (`microtask` as const),
  }
  return [history, strict, { ...strict, nonemptyPrior: true }]
}

export function progressFacts(history: ProgressHistory) {
  const roots = Array.from({ length: 5 }, (_, index) => ({
    id: history.keyShift + index + 1,
    rank: (index + 1) * history.rankScale,
  }))
  const pivot = history.keyShift + 3
  const marked = new Set(
    roots
      .filter(
        ({ id }) =>
          id !== history.keyShift + 2 &&
          !(
            history.kind === `query` &&
            history.nonemptyPrior &&
            id === history.keyShift + 4
          ),
      )
      .map(({ id }) => id),
  )
  return { roots, pivot, marked }
}

/**
 * This is a stateless model of public values, not cache contents. Backend
 * facts define the final result only after every finite successful answer
 * applies. Before that cut, publication retains the preceding complete value.
 */
export function modelProgressValue(history: ProgressHistory, final: boolean) {
  const { roots, marked, pivot } = progressFacts(history)
  if (history.kind === `query` && final) marked.delete(pivot)
  if (history.kind === `sync-mutation` && final) {
    roots[0]!.rank = 6 * history.rankScale
  }
  return modelOrderedReplayWindow(
    roots,
    marked,
    `asc`,
    history.kind === `query` && history.window ? 1 : 0,
    history.kind === `query` && history.window ? 1 : roots.length,
    history.kind === `query` ? `unmarked` : `all`,
    history.kind === `query` && history.includes,
  )
}

export type ProgressReceipt = {
  phase: string
  rows?: Array<ProgressRow>
  [key: string]: unknown
}

export type ProgressOutcome = {
  reason: `exited` | `wall` | `rss` | `heap` | `observation`
  exitCode: number | null
  signal: string | null
  receipts: Array<ProgressReceipt>
  keyCallbacks: number
  prefixViolations: number
  warnings: number
  cleanupErrors: Array<string>
  primaryObservationError?: string
  logPath: string
  bindingStatus?: `bound` | `unresolved`
  bindingError?: string
}

// Use the same observation abstraction for snapshots and event values. It
// preserves payload order, multiplicity and every selected marker; it changes
// no raw receipt or expected model value. Public metadata remains recorded, not
// compared as absent or required to match between distinct output Collections.
function projectProgressRow(value: unknown): ProgressRow {
  if (
    typeof value !== `object` ||
    value === null ||
    !(`id` in value) ||
    typeof value.id !== `number` ||
    !(`rank` in value) ||
    typeof value.rank !== `number` ||
    !(`markers` in value) ||
    !Array.isArray(value.markers) ||
    !value.markers.every((marker: unknown) => typeof marker === `number`)
  )
    throw new Error(`public row has an invalid id/rank/markers payload`)
  return { id: value.id, rank: value.rank, markers: [...value.markers] }
}

export function projectProgressRows(value: unknown): Array<ProgressRow> {
  if (!Array.isArray(value)) throw new Error(`public snapshot is not an array`)
  return value.map(projectProgressRow)
}

export function checkProgressValue(
  history: ProgressHistory,
  receipt: ProgressReceipt,
) {
  if (
    receipt.phase === `retained-publication` ||
    receipt.phase === `initial-publication`
  ) {
    checkReplayPublication(
      projectProgressRows(receipt.rows),
      modelProgressValue(history, false),
      `pending answer retains complete publication`,
    )
  }
  if (
    receipt.phase === `immediate-publication` ||
    receipt.phase === `final-publication`
  ) {
    if (
      history.kind === `sync-initial` &&
      receipt.phase === `immediate-publication`
    )
      checkReplayPublication(
        receipt.cut,
        `subscriber-return-before-preload`,
        `initial synchronous observation precedes a second public call`,
      )
    checkReplayPublication(
      projectProgressRows(receipt.rows),
      modelProgressValue(history, true),
      receipt.phase,
    )
    checkReplayPublication(
      receipt.ready,
      true,
      `readiness holds at the named public cut`,
    )
    if (history.kind === `query`) {
      checkReplayPublication(
        projectProgressRows(receipt.downstream),
        modelProgressValue(history, true),
        `downstream observes the same complete publication`,
      )
      checkReplayPublication(
        receipt.syncError,
        false,
        `finite successful answers leave no sync error`,
      )
    }
  }
}

/**
 * All reload callbacks expose a complete prior or final value (architecture
 * law 9). Once final appears, this finite history has no further backend
 * change that could restore prior. Provider release is not applied settlement:
 * named held-answer cuts remain stricter than these two permitted snapshots.
 *
 * The event map below accumulates observations, not expected query semantics.
 * It keeps the last callback-visible id/rank/markers projection. Duplicate
 * inserts and missing deletes cannot disappear into Map.set/delete. Sorting
 * uses this grammar's distinct numeric ranks; it checks event membership and
 * values, while the callback snapshot separately checks contractual order.
 * Raw payloads, including keys and metadata, remain in the receipt unchanged.
 */
export function createProgressReceiptCheck(history: ProgressHistory) {
  const prior = modelProgressValue(history, false)
  const final = modelProgressValue(history, true)
  const eventRows = new Map(prior.map((row) => [row.id, row]))
  let reloading = false
  let finalPublished = false
  return (receipt: ProgressReceipt) => {
    checkProgressValue(history, receipt)
    if (history.kind !== `query`) return
    if (receipt.phase === `reload-start`) reloading = true
    if (receipt.phase === `cleanup-start`) reloading = false
    if (receipt.phase === `final-publication`) {
      checkReplayPublication(
        reloading,
        true,
        `query final checkpoint follows reload start`,
      )
      checkReplayPublication(
        [...eventRows.values()].sort((left, right) => left.rank - right.rank),
        projectProgressRows(receipt.rows),
        `final checkpoint includes every event-derived public row`,
      )
    }
    if (!reloading || receipt.phase !== `public-change`) return
    const rows = projectProgressRows(receipt.rows)
    const isFinal = isDeepStrictEqual(rows, final)
    checkReplayPublication(
      rows,
      finalPublished || isFinal ? final : prior,
      `every reload callback publishes one complete snapshot without regression`,
    )
    finalPublished ||= isFinal
    if (!Array.isArray(receipt.changes))
      throw new Error(`public-change payload is missing`)
    const changedIds = new Set<number>()
    for (const change of receipt.changes) {
      if (typeof change !== `object` || change === null)
        throw new Error(`public-change operation is invalid`)
      const value = projectProgressRow(change.value)
      // Public-key reduction emits at most one replacement/removal per key.
      checkReplayPublication(
        changedIds.has(value.id),
        false,
        `one public-change operation per projected row`,
      )
      changedIds.add(value.id)
      const present = eventRows.has(value.id)
      if (change.type === `insert`) {
        checkReplayPublication(present, false, `event insert has no prior row`)
        eventRows.set(value.id, value)
      } else if (change.type === `delete` || change.type === `update`) {
        checkReplayPublication(present, true, `event operation has a prior row`)
        if (change.type === `delete`) {
          checkReplayPublication(
            value,
            eventRows.get(value.id),
            `event delete carries the preceding public value`,
          )
          eventRows.delete(value.id)
        } else {
          if (change.previousValue !== undefined)
            checkReplayPublication(
              projectProgressRow(change.previousValue),
              eventRows.get(value.id),
              `event update carries the preceding public value`,
            )
          eventRows.set(value.id, value)
        }
      } else throw new Error(`public-change operation type is invalid`)
    }
    checkReplayPublication(
      [...eventRows.values()].sort((left, right) => left.rank - right.rank),
      rows,
      `public-change payload and callback read expose the same complete value`,
    )
  }
}

/**
 * Queued and executed split one host callback into two observation cuts.
 * Queued is emitted AFTER the host enqueue call returns. Executed is the
 * callback's FIRST action. Neither state represents a production controller.
 * A queued resolving answer distinguishes progress failure from absent setup.
 */
export function checkQueuedAnswerProgress(
  history: ProgressHistory,
  outcome: ProgressOutcome,
) {
  const queuedReceipts = outcome.receipts.filter(
    ({ phase }) => phase === `answer-queued`,
  )
  const executedReceipts = outcome.receipts.filter(
    ({ phase }) => phase === `answer-executed`,
  )
  const queued = queuedReceipts[0]
  const executed = executedReceipts[0]
  const premise = outcome.receipts.find(
    ({ phase }) => phase === `conflicting-cache-premise`,
  )
  if (outcome.reason === `rss` || outcome.reason === `heap`)
    throw new Error(
      `resource termination; no progress verdict: ${outcome.logPath}`,
    )
  if (outcome.bindingStatus !== `bound`)
    throw new Error(
      `setup/provenance unresolved: ${outcome.bindingError ?? outcome.logPath}`,
    )
  if (outcome.primaryObservationError)
    throw new Error(outcome.primaryObservationError)
  if (outcome.reason === `wall`) {
    if (queued && premise && !executed) {
      throw new Error(
        `bounded queued-answer progress failure after reached premise: ${outcome.logPath}`,
      )
    }
    throw new Error(
      `${executed ? `runtime after callback` : `unmet premise or setup`}; watchdog: ${outcome.logPath}`,
    )
  }
  const workerError = outcome.receipts.find(
    ({ phase }) => phase === `worker-error`,
  )
  if (workerError && String(workerError.message).includes(`not reached`))
    throw new Error(
      `unmet premise: ${String(workerError.message)}; ${outcome.logPath}`,
    )
  checkReplayPublication(
    outcome.exitCode,
    0,
    `receiving worker exits successfully`,
  )
  checkReplayPublication(
    outcome.cleanupErrors,
    [],
    `supervisor releases process group`,
  )
  checkReplayPublication(
    outcome.prefixViolations,
    0,
    `all actual keys extend actual empty-options base`,
  )
  checkReplayPublication(
    outcome.warnings,
    0,
    `receiving path emits no warnings`,
  )
  if (history.kind === `query`) {
    checkReplayPublication(
      outcome.keyCallbacks > 0,
      true,
      `real function queryKey callbacks ran`,
    )
    checkReplayPublication(
      Boolean(queued && executed),
      true,
      `host answer actually queued and executed`,
    )
    checkReplayPublication(
      queuedReceipts.length,
      1,
      `one resolving host callback is queued`,
    )
    checkReplayPublication(
      executedReceipts.length,
      1,
      `the resolving callback executes once`,
    )
    checkReplayPublication(
      queued?.enqueueReturned,
      true,
      `queued receipt follows actual host enqueue return`,
    )
    checkReplayPublication(
      typeof queued?.sequence === `number` &&
        typeof executed?.sequence === `number` &&
        queued.sequence < executed.sequence,
      true,
      `host callback executes after the queued receipt`,
    )
    if (
      history.includes &&
      history.window &&
      history.cacheIdentity === `subscription`
    ) {
      checkReplayPublication(
        Boolean(premise),
        true,
        `conflicting cache premise was actually reached`,
      )
    }
  }
  const final = outcome.receipts.find(
    ({ phase }) => phase === `final-publication`,
  )
  checkReplayPublication(Boolean(final), true, `final semantic checkpoint ran`)
  if (history.kind !== `query`)
    checkReplayPublication(
      outcome.receipts.filter(({ phase }) => phase === `immediate-publication`)
        .length,
      1,
      `synchronous control records its immediate observation`,
    )
  const observe = createProgressReceiptCheck(history)
  for (const receipt of outcome.receipts) observe(receipt)
}

declareOracle({
  check: [
    checkQueuedAnswerProgress,
    checkProgressValue,
    createProgressReceiptCheck,
  ],
  model: [modelProgressValue],
  grammar: [progressHistoryArbitrary, progressHistoryFamily, progressFacts],
})

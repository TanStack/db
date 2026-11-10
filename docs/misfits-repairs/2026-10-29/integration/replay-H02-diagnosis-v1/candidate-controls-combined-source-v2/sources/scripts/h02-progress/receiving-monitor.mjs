import { isDeepStrictEqual } from 'node:util'

export const postEnqueueWindowMs = 1000

/** @typedef {'exited' | 'wall' | 'rss' | 'heap' | 'observation'} SupervisorReason */
/** @typedef {import('../../packages/query-db-collection/tests/queued-answer-progress-oracle.js').ProgressReceipt} Receipt */

// Resource and instrument failure cannot become queued-progress evidence when
// a later watchdog fires. Keep the first kill trigger separately in the parent.
/**
 * @param {SupervisorReason} current
 * @param {SupervisorReason} next
 * @param {boolean} heapDetected
 * @returns {SupervisorReason}
 */
export function selectSupervisorReason(current, next, heapDetected) {
  if (heapDetected || current === `heap` || next === `heap`) return `heap`
  if (current === `rss` || next === `rss`) return `rss`
  if (current === `observation` || next === `observation`) return `observation`
  if (current === `wall` || next === `wall`) return `wall`
  return `exited`
}

/** Diagnostic storage is bounded. Scan the entire incoming chunk before trimming. */
export function createHeapDiagnostic() {
  let tail = ``
  let heap = false
  return {
    /** @param {string} text */
    feed(text) {
      const incoming = tail + text
      heap ||=
        /FATAL ERROR:.*heap|Allocation failed - JavaScript heap out of memory/.test(
          incoming,
        )
      tail = incoming.slice(-4000)
      return heap
    },
    detected: () => heap,
  }
}

/** @param {unknown} value @returns {value is number} */
const positive = (value) =>
  typeof value === `number` && Number.isSafeInteger(value) && value > 0
/** @param {unknown} value @returns {value is number} */
const count = (value) =>
  typeof value === `number` && Number.isSafeInteger(value) && value >= 0
/** @param {unknown} value @returns {Record<string, unknown>} */
const fields = (value) =>
  typeof value === `object` && value !== null
    ? /** @type {Record<string, unknown>} */ (value)
    : {}

// Validate the driver's measured receipt, not a second ownership model. The
// source-bound driver remains responsible for reading actual current Queries.
/** @param {Receipt} receipt */
function conflictIdentity(receipt) {
  const observed = fields(receipt.observed)
  const cached = fields(receipt.cached)
  const sibling = fields(receipt.emptySibling)
  const answer = fields(sibling.answer)
  if (
    !positive(receipt.sequence) ||
    !Number.isFinite(receipt.pivot) ||
    typeof receipt.cut !== `string` ||
    ![
      `held-queryFn-registration`,
      `existing-pending-before-acquisition`,
    ].includes(receipt.cut) ||
    typeof receipt.pendingAtom !== `string` ||
    !Array.isArray(receipt.pendingKey) ||
    JSON.stringify(receipt.pendingKey) !== receipt.pendingAtom ||
    !Array.isArray(sibling?.key) ||
    JSON.stringify(sibling.key) !== sibling.atom ||
    sibling.atom === receipt.pendingAtom ||
    !positive(cached?.version) ||
    cached.backendVersion !== 0 ||
    !isDeepStrictEqual(cached.rows, [receipt.pivot]) ||
    !positive(answer?.version) ||
    answer.version <= cached.version ||
    answer.backendVersion !== 1 ||
    !isDeepStrictEqual(answer.rows, []) ||
    observed?.pending !== true ||
    observed.aborted !== false ||
    !isDeepStrictEqual(observed.pendingScope, [receipt.pivot]) ||
    !isDeepStrictEqual(observed.siblingScope, [receipt.pivot]) ||
    !positive(observed.pendingOwner) ||
    !positive(observed.siblingOwner) ||
    observed.pendingOwner === observed.siblingOwner ||
    !count(observed.pendingStartCount) ||
    observed.pendingActualCount !== observed.pendingStartCount ||
    observed.pendingStatus !== `success` ||
    observed.pendingFetchStatus !== `fetching` ||
    !count(observed.siblingStartCount) ||
    !count(observed.siblingActualCount) ||
    observed.siblingActualCount <= observed.siblingStartCount ||
    observed.siblingStatus !== `success` ||
    !isDeepStrictEqual(observed.siblingRows, []) ||
    observed.physicalQueriesCurrent !== true ||
    !positive(observed.pendingPhysicalQuery) ||
    observed.pendingPhysicalQuery !== observed.currentPhysicalQuery ||
    !positive(observed.siblingPhysicalQuery) ||
    observed.siblingPhysicalQuery !== observed.siblingAnswerPhysicalQuery ||
    observed.pendingPhysicalQuery === observed.siblingPhysicalQuery
  )
    throw new Error(`invalid measured conflict receipt`)
  return {
    sequence: receipt.sequence,
    atom: receipt.pendingAtom,
    cachedVersion: cached.version,
    emptyVersion: answer.version,
  }
}

/**
 * These fixed-storage milestones belong to the parent instrument. They add no
 * receiving-thread allocation, yield, graph cap or product scheduling rule.
 * Parent observation time starts containment only after measured conflict and
 * completed host enqueue. Callback execution disarms this progress window.
 */
export function createPostEnqueueMonitor() {
  /** @type {ReturnType<typeof conflictIdentity> | undefined} */
  let premise
  /** @type {number | undefined} */
  let queuedSequence
  /** @type {number | undefined} */
  let queuedAtMs
  /** @type {number | undefined} */
  let executedSequence
  let receiptCount = 0
  let acquisitionCount = 0
  let releaseCount = 0
  let lastSequence = 0
  /** @type {string | undefined} */
  let lastPhase
  return {
    /** @param {Receipt} receipt @param {number} nowMs */
    observe(receipt, nowMs) {
      receiptCount++
      if (typeof receipt.sequence === `number`) lastSequence = receipt.sequence
      lastPhase = receipt.phase
      if (receipt.phase === `acquisition-attempt`) acquisitionCount++
      if (receipt.phase === `acquisition-release`) releaseCount++
      if (receipt.phase === `conflicting-cache-premise`) {
        if (premise) throw new Error(`duplicate measured conflict receipt`)
        premise = conflictIdentity(receipt)
      }
      if (
        receipt.phase === `answer-queued` &&
        receipt.kind === `resolving-conflict`
      ) {
        if (
          !premise ||
          queuedSequence !== undefined ||
          !positive(receipt.sequence) ||
          receipt.sequence <= premise.sequence ||
          receipt.atom !== premise.atom ||
          JSON.stringify(receipt.key) !== premise.atom ||
          receipt.cachedVersion !== premise.cachedVersion ||
          receipt.emptyVersion !== premise.emptyVersion ||
          typeof receipt.scheduler !== `string` ||
          ![`microtask`, `timer`].includes(receipt.scheduler) ||
          receipt.enqueueReturned !== true ||
          !Number.isFinite(nowMs)
        )
          throw new Error(`invalid resolving enqueue receipt`)
        queuedSequence = receipt.sequence
        queuedAtMs = nowMs
      }
      if (
        receipt.phase === `answer-executed` &&
        receipt.kind === `resolving-conflict`
      ) {
        if (
          !premise ||
          queuedSequence === undefined ||
          executedSequence !== undefined ||
          !positive(receipt.sequence) ||
          receipt.sequence <= queuedSequence ||
          receipt.atom !== premise.atom ||
          JSON.stringify(receipt.key) !== premise.atom ||
          receipt.cachedVersion !== premise.cachedVersion ||
          receipt.emptyVersion !== premise.emptyVersion
        )
          throw new Error(`invalid resolving execution receipt`)
        executedSequence = receipt.sequence
      }
    },
    /** @param {number} nowMs */
    expired(nowMs) {
      return (
        queuedAtMs !== undefined &&
        executedSequence === undefined &&
        nowMs - queuedAtMs >= postEnqueueWindowMs
      )
    },
    snapshot() {
      return {
        postEnqueueWindowMs,
        conflictSequence: premise?.sequence,
        queuedSequence,
        queuedAtParentMonotonicMs: queuedAtMs,
        executedSequence,
        receiptCount,
        acquisitionCount,
        releaseCount,
        lastSequence,
        lastPhase,
      }
    },
  }
}

/**
 * A shared event vocabulary for small, independent refinement projections.
 *
 * This is deliberately not a second implementation of the Collection state
 * machine. Each projector owns one law and ignores unrelated events. The
 * lifecycle command model generates legal acquisition/release histories;
 * boundary suites compare these projections with public Collection
 * observations at the points where planes meet.
 */
export type FullFlowOwnerId = string
export type FullFlowSessionId = string
export type FullFlowDemandId = string
export type FullFlowAttemptId = string
export type FullFlowSourceId = string
export type FullFlowTransactionId = string
export type FullFlowAcquisitionId = string
export type FullFlowVersionedRow = {
  sourceId: FullFlowSourceId
  rowKey: string
  version: number
}
export type FullFlowPublicationId = string

export type FullFlowPublishedOrderRow = {
  key: string
  orderValue: number
}

export type FullFlowSourceDemand = {
  sourceId: FullFlowSourceId
  demandId: FullFlowDemandId
}

export type OrderedContinuationEvidencePage = {
  requestedPrefix: number
  appliedKeys: ReadonlyArray<string>
  extent: `continues` | `exhausted`
}

export type OrderedContinuationEvidence = {
  visibleKeys: ReadonlyArray<string>
  boundaryKey: string | undefined
  coveredPrefixSize: number
  coversTarget: boolean
  rowsNeeded: number
}

export type OrderedSourceStep = {
  sourceKey: string
  resultKeys: ReadonlyArray<string>
  demandKeys: ReadonlyArray<string>
}

export type OrderedSourceProgress = {
  visibleResultKeys: ReadonlyArray<string>
  scannedSourceKeys: ReadonlyArray<string>
  sourceCursorKeys: ReadonlyArray<string | undefined>
  demandedKeys: ReadonlyArray<string>
  rowsNeeded: number
  sourceExhausted: boolean
}

/**
 * Projects the smallest forward source scan that fills a result window. Each
 * step contains result contributions already evaluated by the owning DBSP
 * oracle or an eager production control. This model owns source progress only;
 * it does not interpret predicates, joins, grouping, ordering, or includes.
 */
export function projectOrderedSourceProgress(options: {
  sourceSteps: ReadonlyArray<OrderedSourceStep>
  offset: number
  limit: number
}): OrderedSourceProgress {
  const scannedSourceKeys: Array<string> = []
  const resultKeys: Array<string> = []
  const demandedKeys: Array<string> = []
  const seenDemandKeys = new Set<string>()
  const targetSize = options.limit === 0 ? 0 : options.offset + options.limit

  for (const step of options.sourceSteps) {
    if (resultKeys.length >= targetSize) break

    scannedSourceKeys.push(step.sourceKey)
    for (const demandKey of step.demandKeys) {
      if (!seenDemandKeys.has(demandKey)) {
        seenDemandKeys.add(demandKey)
        demandedKeys.push(demandKey)
      }
    }
    resultKeys.push(...step.resultKeys)
  }

  const visibleResultKeys = resultKeys.slice(
    options.offset,
    options.offset + options.limit,
  )

  return {
    visibleResultKeys,
    scannedSourceKeys,
    sourceCursorKeys: scannedSourceKeys.map((_, index) =>
      index === 0 ? undefined : scannedSourceKeys[index - 1],
    ),
    demandedKeys,
    rowsNeeded: Math.max(0, options.limit - visibleResultKeys.length),
    sourceExhausted: scannedSourceKeys.length === options.sourceSteps.length,
  }
}

/**
 * Projects ordered evidence from request receipts alone. Requested size and
 * source progress are independent inputs; only eligible applied rows count
 * toward the visible prefix, while every applied row may advance its cursor.
 */
export function projectOrderedContinuationEvidence(options: {
  sourceOrder: ReadonlyArray<string>
  eligibleKeys: ReadonlySet<string>
  targetSize: number
  pages: ReadonlyArray<OrderedContinuationEvidencePage>
}): OrderedContinuationEvidence {
  const { sourceOrder, eligibleKeys, targetSize, pages } = options
  const sourcePosition = new Map(
    sourceOrder.map((key, position) => [key, position]),
  )
  const known = (keys: ReadonlySet<string>) =>
    sourceOrder.filter((key) => keys.has(key))
  const candidates = new Set<string>()
  const provenance = new Set<string>()
  const admitted = new Set<string>()
  let coveredPrefixSize = 0
  let exhausted = false

  const initial = pages[0]
  if (initial) {
    for (const key of initial.appliedKeys) {
      if (sourcePosition.has(key)) candidates.add(key)
    }
    exhausted = initial.extent === `exhausted`
  }

  for (const page of pages.slice(1)) {
    if (exhausted) break
    if (page.extent === `exhausted`) {
      exhausted = true
      break
    }
    for (const key of candidates) {
      provenance.add(key)
      admitted.add(key)
    }
    candidates.clear()
    for (const key of page.appliedKeys) {
      if (!sourcePosition.has(key)) continue
      provenance.add(key)
      admitted.add(key)
    }
    const eligibleAdmitted = known(admitted).filter((key) =>
      eligibleKeys.has(key),
    )
    coveredPrefixSize = Math.max(
      coveredPrefixSize,
      Math.min(
        page.requestedPrefix,
        eligibleAdmitted.slice(0, targetSize).length,
      ),
    )
  }

  const visibleKeys = exhausted
    ? sourceOrder.filter((key) => eligibleKeys.has(key)).slice(0, targetSize)
    : known(admitted)
        .filter((key) => eligibleKeys.has(key))
        .slice(0, targetSize)
  const boundaryKeys = exhausted
    ? sourceOrder.slice(0, targetSize)
    : provenance.size > 0
      ? known(provenance)
      : known(candidates).slice(0, targetSize)

  return {
    visibleKeys,
    boundaryKey: boundaryKeys.at(-1),
    coveredPrefixSize: exhausted ? Number.POSITIVE_INFINITY : coveredPrefixSize,
    coversTarget: exhausted || coveredPrefixSize >= targetSize,
    rowsNeeded: Math.max(0, targetSize - visibleKeys.length),
  }
}

export type LoadSubsetFullFlowEvent =
  | {
      type: `requestDemand`
      ownerId: FullFlowOwnerId
      sessionId: FullFlowSessionId
      sourceId: FullFlowSourceId
      demandId: FullFlowDemandId
      attemptId: FullFlowAttemptId
      alreadyAborted: boolean
    }
  | {
      type: `applyAuthoritativeRows`
      ownerId: FullFlowOwnerId
      sourceId: FullFlowSourceId
      demandId: FullFlowDemandId
      attemptId: FullFlowAttemptId
      rowKeys: ReadonlyArray<string>
    }
  | {
      type: `settleDemandWithoutEvidence`
      sourceId: FullFlowSourceId
      demandId: FullFlowDemandId
      attemptId: FullFlowAttemptId
    }
  | {
      type: `applyUnprovenRows`
      ownerId: FullFlowOwnerId
      sourceId: FullFlowSourceId
      demandId: FullFlowDemandId
      attemptId: FullFlowAttemptId
      rowKeys: ReadonlyArray<string>
    }
  | {
      type: `rejectDemand`
      ownerId: FullFlowOwnerId
      sourceId: FullFlowSourceId
      demandId: FullFlowDemandId
      attemptId: FullFlowAttemptId
    }
  | {
      type: `truncateSource`
      sessionId: FullFlowSessionId
      sourceId: FullFlowSourceId
    }
  | {
      type: `releaseDemand`
      ownerId: FullFlowOwnerId
      sourceId: FullFlowSourceId
      demandId: FullFlowDemandId
      attemptId: FullFlowAttemptId
    }
  | {
      type: `restartSession`
      previousSessionId: FullFlowSessionId
      nextSessionId: FullFlowSessionId
    }
  | {
      type: `cleanupSession`
      sessionId: FullFlowSessionId
    }
  | {
      type: `advanceWindowRevision`
      sessionId: FullFlowSessionId
      revision: number
    }
  | {
      type: `scheduleContinuation`
      taskId: string
      sessionId: FullFlowSessionId
      windowRevision: number
    }
  | {
      type: `runContinuation`
      taskId: string
    }
  | {
      type: `stageSyncTransaction`
      transactionId: FullFlowTransactionId
      sourceId: FullFlowSourceId
      rowKeys: ReadonlyArray<string>
    }
  | {
      type: `commitSyncTransaction`
      transactionId: FullFlowTransactionId
      parked: boolean
      signalAborted: boolean
    }
  | {
      type: `enterSyncApplication`
      transactionId: FullFlowTransactionId
    }
  | {
      type: `abortSyncTransaction`
      transactionId: FullFlowTransactionId
    }
  | {
      type: `publishSyncTransaction`
      transactionId: FullFlowTransactionId
    }
  | {
      type: `settleSyncReceipt`
      transactionId: FullFlowTransactionId
    }
  | {
      type: `establishPublication`
      sourceId: FullFlowSourceId
      rows: ReadonlyArray<FullFlowVersionedRow>
    }
  | {
      type: `startReplay`
      attemptId: string
      sourceId: FullFlowSourceId
    }
  | {
      type: `writeReplayRows`
      attemptId: string
      rows: ReadonlyArray<FullFlowVersionedRow>
      acceptedByCore: boolean
    }
  | {
      type: `settleReplay`
      attemptId: string
      outcome: `resolve` | `reject`
    }
  | {
      type: `registerSourceDemand`
      sessionId: FullFlowSessionId
      sourceId: FullFlowSourceId
      demandId: FullFlowDemandId
      attemptId: FullFlowAttemptId
    }
  | {
      type: `settleSourceDemand`
      sessionId: FullFlowSessionId
      sourceId: FullFlowSourceId
      demandId: FullFlowDemandId
      attemptId: FullFlowAttemptId
      outcome: `resolve` | `reject`
    }
  | {
      type: `retireSourceDemand`
      sessionId: FullFlowSessionId
      sourceId: FullFlowSourceId
      demandId: FullFlowDemandId
      attemptId: FullFlowAttemptId
    }
  | {
      type: `startAcquisition`
      acquisitionId: FullFlowAcquisitionId
      sourceId: FullFlowSourceId
      demandId: FullFlowDemandId
    }
  | {
      type: `attachAcquisitionOwner`
      acquisitionId: FullFlowAcquisitionId
      ownerId: FullFlowOwnerId
    }
  | {
      type: `settleAcquisition`
      acquisitionId: FullFlowAcquisitionId
      outcome: `resolve` | `reject`
      rowKeys: ReadonlyArray<string>
    }
  | {
      type: `stagePublicationRows`
      publicationId: FullFlowPublicationId
      sourceId: FullFlowSourceId
      demandId: FullFlowDemandId
      rows: ReadonlyArray<FullFlowPublishedOrderRow>
    }
  | {
      type: `commitPublication`
      publicationId: FullFlowPublicationId
    }
  | {
      type: `beginReplacement`
      publicationId: FullFlowPublicationId
      demands: ReadonlyArray<FullFlowSourceDemand>
    }
  | {
      type: `settleReplacement`
      publicationId: FullFlowPublicationId
      sourceId: FullFlowSourceId
      demandId: FullFlowDemandId
      outcome: `failure` | `abort`
    }
  | {
      type: `settleReplacement`
      publicationId: FullFlowPublicationId
      sourceId: FullFlowSourceId
      demandId: FullFlowDemandId
      outcome: `success`
      extent: `exhausted` | `continues`
    }
  | {
      type: `establishReplacementCoverage`
      publicationId: FullFlowPublicationId
      sourceId: FullFlowSourceId
      demandId: FullFlowDemandId
    }
  | {
      type: `resizeOrderedWindow`
      sourceId: FullFlowSourceId
      demandId: FullFlowDemandId
      size: number
    }

export type ExpectedAdapterLifecycleEvent = {
  type: `invoke` | `release`
  ownerId: FullFlowOwnerId
  sourceId: FullFlowSourceId
  attemptId: FullFlowAttemptId
}

type ScopedIdentity = string
type ActiveDemandAttempts = Map<ScopedIdentity, Set<ScopedIdentity>>
type AcquisitionAttempts = Map<ScopedIdentity, Set<ScopedIdentity>>

function scopedIdentity(...parts: ReadonlyArray<string>): ScopedIdentity {
  return parts.map((part) => `${part.length}:${part}`).join(`|`)
}

function sourceDemandIdentity(
  sourceId: FullFlowSourceId,
  demandId: FullFlowDemandId,
): ScopedIdentity {
  return scopedIdentity(sourceId, demandId)
}

function sourceAttemptIdentity(
  sourceId: FullFlowSourceId,
  attemptId: FullFlowAttemptId,
): ScopedIdentity {
  return scopedIdentity(sourceId, attemptId)
}

function sourceDemandAttemptIdentity(
  sourceId: FullFlowSourceId,
  demandId: FullFlowDemandId,
  attemptId: FullFlowAttemptId,
): ScopedIdentity {
  return scopedIdentity(sourceId, demandId, attemptId)
}

function sourceRowIdentity(
  sourceId: FullFlowSourceId,
  rowKey: string,
): ScopedIdentity {
  return scopedIdentity(sourceId, rowKey)
}

function belongsToSource(
  identity: ScopedIdentity,
  sourceId: FullFlowSourceId,
): boolean {
  return identity.startsWith(`${sourceId.length}:${sourceId}|`)
}

function addActiveDemandAttempt(
  activeAttempts: ActiveDemandAttempts,
  demandId: ScopedIdentity,
  attemptId: ScopedIdentity,
): void {
  let attempts = activeAttempts.get(demandId)
  if (!attempts) {
    attempts = new Set()
    activeAttempts.set(demandId, attempts)
  }
  attempts.add(attemptId)
}

function releaseActiveDemandAttempt(
  activeAttempts: ActiveDemandAttempts,
  demandId: ScopedIdentity,
  attemptId: ScopedIdentity,
): boolean {
  const attempts = activeAttempts.get(demandId)
  if (!attempts?.delete(attemptId)) return false
  if (attempts.size > 0) return false
  activeAttempts.delete(demandId)
  return true
}

function addAcquisitionAttempt(
  acquisitionAttempts: AcquisitionAttempts,
  acquisitionId: ScopedIdentity,
  attemptId: ScopedIdentity,
): void {
  let attempts = acquisitionAttempts.get(acquisitionId)
  if (!attempts) {
    attempts = new Set()
    acquisitionAttempts.set(acquisitionId, attempts)
  }
  attempts.add(attemptId)
}

function releaseAcquisitionAttempt(
  acquisitionAttempts: AcquisitionAttempts,
  acquisitionId: ScopedIdentity,
  attemptId: ScopedIdentity,
): boolean {
  const attempts = acquisitionAttempts.get(acquisitionId)
  if (!attempts?.delete(attemptId) || attempts.size > 0) return false
  acquisitionAttempts.delete(acquisitionId)
  return true
}

type DemandAttemptRecord = {
  ownerId: FullFlowOwnerId
  demandId: FullFlowDemandId
  settled: boolean
  released: boolean
}

/** Reject histories that cannot name logical demand attempts unambiguously. */
function assertWellFormedDemandAttempts(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
): void {
  const attempts = new Map<ScopedIdentity, DemandAttemptRecord>()

  for (const event of history) {
    if (event.type === `requestDemand`) {
      const attemptKey = sourceAttemptIdentity(event.sourceId, event.attemptId)
      if (attempts.has(attemptKey)) {
        throw new Error(
          `Demand attempt "${event.attemptId}" was requested more than once`,
        )
      }
      attempts.set(attemptKey, {
        ownerId: event.ownerId,
        demandId: event.demandId,
        settled: false,
        released: false,
      })
      continue
    }

    const usesDemandAttempt =
      event.type === `applyAuthoritativeRows` ||
      event.type === `applyUnprovenRows` ||
      event.type === `rejectDemand` ||
      event.type === `settleDemandWithoutEvidence` ||
      event.type === `releaseDemand`
    if (!usesDemandAttempt) continue

    const attempt = attempts.get(
      sourceAttemptIdentity(event.sourceId, event.attemptId),
    )
    if (!attempt) {
      throw new Error(
        `Demand attempt "${event.attemptId}" was used before it was requested`,
      )
    }
    if (attempt.demandId !== event.demandId) {
      throw new Error(
        `Demand attempt "${event.attemptId}" changed its demand identity`,
      )
    }
    if (`ownerId` in event && attempt.ownerId !== event.ownerId) {
      throw new Error(
        `Demand attempt "${event.attemptId}" changed its owner identity`,
      )
    }

    if (event.type === `releaseDemand`) {
      if (attempt.released) {
        throw new Error(
          `Demand attempt "${event.attemptId}" was released more than once`,
        )
      }
      attempt.released = true
    } else {
      if (attempt.settled) {
        throw new Error(
          `Demand attempt "${event.attemptId}" settled more than once`,
        )
      }
      attempt.settled = true
    }
  }
}

/**
 * Projects logical adapter callback obligations.
 *
 * An already-aborted request never crosses the adapter boundary, so its later
 * logical release has no adapter callback. This projection intentionally says
 * nothing about physical transport deduplication.
 */
export function projectAdapterLifecycle(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
): Array<ExpectedAdapterLifecycleEvent> {
  assertWellFormedDemandAttempts(history)
  const invokedAttempts = new Set<ScopedIdentity>()
  const projected: Array<ExpectedAdapterLifecycleEvent> = []

  for (const event of history) {
    if (event.type === `requestDemand` && !event.alreadyAborted) {
      invokedAttempts.add(
        sourceAttemptIdentity(event.sourceId, event.attemptId),
      )
      projected.push({
        type: `invoke`,
        ownerId: event.ownerId,
        sourceId: event.sourceId,
        attemptId: event.attemptId,
      })
    }
    if (
      event.type === `releaseDemand` &&
      invokedAttempts.delete(
        sourceAttemptIdentity(event.sourceId, event.attemptId),
      )
    ) {
      projected.push({
        type: `release`,
        ownerId: event.ownerId,
        sourceId: event.sourceId,
        attemptId: event.attemptId,
      })
    }
  }

  return projected
}

/**
 * Projects physical transport work from adapter evidence lifetime.
 *
 * Concurrent owners attach to one in-flight exact demand. Settlement alone is
 * not reusable evidence: only an applied authoritative row publication makes
 * the demand reusable, and an unload that invalidates that evidence forces the
 * next owner to fetch again.
 */
export function projectTransportLoads(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
): number {
  assertWellFormedDemandAttempts(history)
  const reusableAcquisitions = new Map<ScopedIdentity, ScopedIdentity>()
  const inFlightAcquisitions = new Map<ScopedIdentity, ScopedIdentity>()
  const attemptAcquisitions = new Map<ScopedIdentity, ScopedIdentity>()
  const acquisitionAttempts: AcquisitionAttempts = new Map()
  let loads = 0

  for (const event of history) {
    switch (event.type) {
      case `requestDemand`: {
        if (event.alreadyAborted) break
        const demandKey = sourceDemandIdentity(event.sourceId, event.demandId)
        const attemptKey = sourceAttemptIdentity(
          event.sourceId,
          event.attemptId,
        )
        let acquisitionId =
          inFlightAcquisitions.get(demandKey) ??
          reusableAcquisitions.get(demandKey)
        if (acquisitionId === undefined) {
          loads++
          acquisitionId = attemptKey
          inFlightAcquisitions.set(demandKey, acquisitionId)
        }
        attemptAcquisitions.set(attemptKey, acquisitionId)
        addAcquisitionAttempt(acquisitionAttempts, acquisitionId, attemptKey)
        break
      }
      case `applyAuthoritativeRows`: {
        const demandKey = sourceDemandIdentity(event.sourceId, event.demandId)
        const attemptKey = sourceAttemptIdentity(
          event.sourceId,
          event.attemptId,
        )
        const acquisitionId = attemptAcquisitions.get(attemptKey)
        if (
          acquisitionId === undefined ||
          inFlightAcquisitions.get(demandKey) !== acquisitionId
        ) {
          break
        }
        inFlightAcquisitions.delete(demandKey)
        reusableAcquisitions.set(demandKey, acquisitionId)
        break
      }
      case `truncateSource`:
        for (const demandKey of reusableAcquisitions.keys()) {
          if (belongsToSource(demandKey, event.sourceId)) {
            reusableAcquisitions.delete(demandKey)
          }
        }
        for (const demandKey of inFlightAcquisitions.keys()) {
          if (belongsToSource(demandKey, event.sourceId)) {
            inFlightAcquisitions.delete(demandKey)
          }
        }
        break
      case `applyUnprovenRows`:
      case `rejectDemand`:
      case `settleDemandWithoutEvidence`: {
        const demandKey = sourceDemandIdentity(event.sourceId, event.demandId)
        const attemptKey = sourceAttemptIdentity(
          event.sourceId,
          event.attemptId,
        )
        const acquisitionId = attemptAcquisitions.get(attemptKey)
        if (
          acquisitionId !== undefined &&
          inFlightAcquisitions.get(demandKey) === acquisitionId
        ) {
          inFlightAcquisitions.delete(demandKey)
        }
        break
      }
      case `releaseDemand`: {
        const demandKey = sourceDemandIdentity(event.sourceId, event.demandId)
        const attemptKey = sourceAttemptIdentity(
          event.sourceId,
          event.attemptId,
        )
        const acquisitionId = attemptAcquisitions.get(attemptKey)
        if (
          acquisitionId !== undefined &&
          releaseAcquisitionAttempt(
            acquisitionAttempts,
            acquisitionId,
            attemptKey,
          )
        ) {
          if (reusableAcquisitions.get(demandKey) === acquisitionId) {
            reusableAcquisitions.delete(demandKey)
          }
          if (inFlightAcquisitions.get(demandKey) === acquisitionId) {
            inFlightAcquisitions.delete(demandKey)
          }
        }
        break
      }
      case `restartSession`:
      case `cleanupSession`:
      case `advanceWindowRevision`:
      case `scheduleContinuation`:
      case `runContinuation`:
      case `stageSyncTransaction`:
      case `commitSyncTransaction`:
      case `enterSyncApplication`:
      case `abortSyncTransaction`:
      case `publishSyncTransaction`:
      case `settleSyncReceipt`:
      case `establishPublication`:
      case `startReplay`:
      case `writeReplayRows`:
      case `settleReplay`:
      case `registerSourceDemand`:
      case `settleSourceDemand`:
      case `retireSourceDemand`:
      case `startAcquisition`:
      case `attachAcquisitionOwner`:
      case `settleAcquisition`:
      case `stagePublicationRows`:
      case `commitPublication`:
      case `beginReplacement`:
      case `settleReplacement`:
      case `establishReplacementCoverage`:
      case `resizeOrderedWindow`:
        break
    }
  }

  return loads
}

/**
 * Counts follow-up loads that a settled ordered continuation may authorize.
 * Authority is scoped to both the current live-query session and the window
 * revision captured when the continuation was scheduled.
 */
export function projectAuthorizedContinuationStarts(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
): number {
  const activeSessions = new Set<FullFlowSessionId>()
  const revisions = new Map<FullFlowSessionId, number>()
  const tasks = new Map<
    string,
    { sessionId: FullFlowSessionId; windowRevision: number }
  >()
  let currentSession: FullFlowSessionId | undefined
  let starts = 0

  for (const event of history) {
    switch (event.type) {
      case `requestDemand`:
        currentSession ??= event.sessionId
        activeSessions.add(event.sessionId)
        revisions.set(event.sessionId, revisions.get(event.sessionId) ?? 0)
        break
      case `cleanupSession`:
        activeSessions.delete(event.sessionId)
        break
      case `restartSession`:
        currentSession = event.nextSessionId
        activeSessions.add(event.nextSessionId)
        revisions.set(event.nextSessionId, 0)
        break
      case `advanceWindowRevision`:
        revisions.set(event.sessionId, event.revision)
        break
      case `scheduleContinuation`:
        tasks.set(event.taskId, {
          sessionId: event.sessionId,
          windowRevision: event.windowRevision,
        })
        break
      case `runContinuation`: {
        const task = tasks.get(event.taskId)
        if (
          task &&
          currentSession === task.sessionId &&
          activeSessions.has(task.sessionId) &&
          revisions.get(task.sessionId) === task.windowRevision
        ) {
          starts++
        }
        tasks.delete(event.taskId)
        break
      }
      case `applyAuthoritativeRows`:
      case `settleDemandWithoutEvidence`:
      case `applyUnprovenRows`:
      case `rejectDemand`:
      case `truncateSource`:
      case `releaseDemand`:
      case `stageSyncTransaction`:
      case `commitSyncTransaction`:
      case `enterSyncApplication`:
      case `abortSyncTransaction`:
      case `publishSyncTransaction`:
      case `settleSyncReceipt`:
      case `establishPublication`:
      case `startReplay`:
      case `writeReplayRows`:
      case `settleReplay`:
      case `registerSourceDemand`:
      case `settleSourceDemand`:
      case `retireSourceDemand`:
      case `startAcquisition`:
      case `attachAcquisitionOwner`:
      case `settleAcquisition`:
      case `stagePublicationRows`:
      case `commitPublication`:
      case `beginReplacement`:
      case `settleReplacement`:
      case `establishReplacementCoverage`:
      case `resizeOrderedWindow`:
        break
    }
  }

  return starts
}

export type ExpectedReusableDemand = {
  sourceId: FullFlowSourceId
  demandId: FullFlowDemandId
}

/** Projects source-qualified reusable demand evidence without registry state. */
export function projectReusableSourceDemands(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
): Array<ExpectedReusableDemand> {
  assertWellFormedDemandAttempts(history)
  const activeAttempts: ActiveDemandAttempts = new Map()
  const currentAcquisitions = new Map<ScopedIdentity, ScopedIdentity>()
  const reusableAcquisitions = new Map<
    ScopedIdentity,
    { acquisitionId: ScopedIdentity; demand: ExpectedReusableDemand }
  >()
  const attemptAcquisitions = new Map<ScopedIdentity, ScopedIdentity>()
  const acquisitionAttempts: AcquisitionAttempts = new Map()

  for (const event of history) {
    switch (event.type) {
      case `requestDemand`:
        if (!event.alreadyAborted) {
          const demandKey = sourceDemandIdentity(event.sourceId, event.demandId)
          const attemptKey = sourceAttemptIdentity(
            event.sourceId,
            event.attemptId,
          )
          addActiveDemandAttempt(activeAttempts, demandKey, attemptKey)
          const acquisitionId =
            currentAcquisitions.get(demandKey) ??
            reusableAcquisitions.get(demandKey)?.acquisitionId ??
            attemptKey
          currentAcquisitions.set(demandKey, acquisitionId)
          attemptAcquisitions.set(attemptKey, acquisitionId)
          addAcquisitionAttempt(acquisitionAttempts, acquisitionId, attemptKey)
        }
        break
      case `applyAuthoritativeRows`: {
        const demandKey = sourceDemandIdentity(event.sourceId, event.demandId)
        const attemptKey = sourceAttemptIdentity(
          event.sourceId,
          event.attemptId,
        )
        const acquisitionId = attemptAcquisitions.get(attemptKey)
        if (
          acquisitionId !== undefined &&
          currentAcquisitions.get(demandKey) === acquisitionId
        ) {
          reusableAcquisitions.set(demandKey, {
            acquisitionId,
            demand: { sourceId: event.sourceId, demandId: event.demandId },
          })
          currentAcquisitions.delete(demandKey)
        }
        break
      }
      case `truncateSource`:
        for (const demandKey of currentAcquisitions.keys()) {
          if (belongsToSource(demandKey, event.sourceId)) {
            currentAcquisitions.delete(demandKey)
          }
        }
        for (const demandKey of reusableAcquisitions.keys()) {
          if (belongsToSource(demandKey, event.sourceId)) {
            reusableAcquisitions.delete(demandKey)
          }
        }
        break
      case `releaseDemand`: {
        const demandKey = sourceDemandIdentity(event.sourceId, event.demandId)
        const attemptKey = sourceAttemptIdentity(
          event.sourceId,
          event.attemptId,
        )
        releaseActiveDemandAttempt(activeAttempts, demandKey, attemptKey)
        const acquisitionId = attemptAcquisitions.get(attemptKey)
        if (
          acquisitionId !== undefined &&
          releaseAcquisitionAttempt(
            acquisitionAttempts,
            acquisitionId,
            attemptKey,
          )
        ) {
          if (currentAcquisitions.get(demandKey) === acquisitionId) {
            currentAcquisitions.delete(demandKey)
          }
          if (
            reusableAcquisitions.get(demandKey)?.acquisitionId === acquisitionId
          ) {
            reusableAcquisitions.delete(demandKey)
          }
        }
        break
      }
      case `applyUnprovenRows`:
      case `rejectDemand`:
      case `settleDemandWithoutEvidence`:
      case `restartSession`:
      case `cleanupSession`:
      case `advanceWindowRevision`:
      case `scheduleContinuation`:
      case `runContinuation`:
      case `stageSyncTransaction`:
      case `commitSyncTransaction`:
      case `enterSyncApplication`:
      case `abortSyncTransaction`:
      case `publishSyncTransaction`:
      case `settleSyncReceipt`:
      case `establishPublication`:
      case `startReplay`:
      case `writeReplayRows`:
      case `settleReplay`:
      case `registerSourceDemand`:
      case `settleSourceDemand`:
      case `retireSourceDemand`:
      case `startAcquisition`:
      case `attachAcquisitionOwner`:
      case `settleAcquisition`:
      case `stagePublicationRows`:
      case `commitPublication`:
      case `beginReplacement`:
      case `settleReplacement`:
      case `establishReplacementCoverage`:
      case `resizeOrderedWindow`:
        break
    }
  }

  return [...reusableAcquisitions.values()]
    .map(({ demand }) => demand)
    .sort((left, right) =>
      left.sourceId === right.sourceId
        ? left.demandId.localeCompare(right.demandId)
        : left.sourceId.localeCompare(right.sourceId),
    )
}

/** Single-source convenience projection retained for existing controls. */
export function projectReusableDemands(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
): Array<FullFlowDemandId> {
  return projectReusableSourceDemands(history).map(({ demandId }) => demandId)
}

/**
 * Projects the last complete ordered boundary from public publication
 * provenance. Rows published for another demand cannot move this boundary,
 * and an uncommitted replacement cannot supersede the last complete snapshot.
 */
export function projectOrderedPublicationBoundary(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
  options: {
    sourceId: FullFlowSourceId
    demandId: FullFlowDemandId
    direction: `asc` | `desc`
    prefixSize: number
  },
): FullFlowPublishedOrderRow | undefined {
  const staged = new Map<
    FullFlowPublicationId,
    Map<ScopedIdentity, ReadonlyArray<FullFlowPublishedOrderRow>>
  >()
  const targetDemand = sourceDemandIdentity(options.sourceId, options.demandId)
  let committedRows: ReadonlyArray<FullFlowPublishedOrderRow> = []

  for (const event of history) {
    if (event.type === `stagePublicationRows`) {
      let publication = staged.get(event.publicationId)
      if (!publication) {
        publication = new Map()
        staged.set(event.publicationId, publication)
      }
      publication.set(
        sourceDemandIdentity(event.sourceId, event.demandId),
        event.rows,
      )
      continue
    }
    if (event.type === `commitPublication`) {
      const publication = staged.get(event.publicationId)
      if (publication?.has(targetDemand)) {
        committedRows = publication.get(targetDemand) ?? []
      }
    }
  }

  const sorted = [...committedRows].sort((left, right) => {
    const valueOrder =
      options.direction === `asc`
        ? left.orderValue - right.orderValue
        : right.orderValue - left.orderValue
    if (valueOrder !== 0) return valueOrder
    if (left.key === right.key) return 0
    return left.key < right.key ? -1 : 1
  })
  return sorted.slice(0, options.prefixSize).at(-1)
}

/**
 * Projects semantic ordered publications across replacement epochs. Empty
 * transport callbacks do not appear here because they cannot change public
 * state. Demand activity comes only from request and release events, and the
 * retained window size is grow-only. Staged rows stay private until every
 * acquisition has settled, then the current replacement publishes the retained
 * ordered prefix plus rows required by still-active demands. Abort or failure
 * from a released demand or obsolete attempt satisfies its barrier without
 * vetoing the current attempt. Failure of a current active demand keeps the
 * previous publication, and cleanup is a terminal fence against late writes
 * and settlements.
 */
export function projectAtomicOrderedPublications(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
  options: {
    sourceId: FullFlowSourceId
    demandId: FullFlowDemandId
    direction: `asc` | `desc`
    initialWindowSize: number
  },
): ReadonlyArray<ReadonlyArray<FullFlowPublishedOrderRow>> {
  return projectAtomicOrderedPublicationState(history, options).publications
}

export type AtomicOrderedPublicationState = {
  rows: ReadonlyArray<FullFlowPublishedOrderRow>
  orderedPrefixSize: number
  orderedBoundary: FullFlowPublishedOrderRow | undefined
}

export type AtomicOrderedPublicationProjection = {
  publications: ReadonlyArray<ReadonlyArray<FullFlowPublishedOrderRow>>
  currentPublication: AtomicOrderedPublicationState | undefined
  retainsPreviousPublication: boolean
}

/**
 * Projects both reader-visible rows and the ordered continuation state owned by
 * that publication. The explicit optional boundary matters: an empty retained
 * publication has a valid `undefined` boundary and must not fall through to a
 * private replacement's progress boundary.
 */
export function projectAtomicOrderedPublicationState(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
  options: {
    sourceId: FullFlowSourceId
    demandId: FullFlowDemandId
    direction: `asc` | `desc`
    initialWindowSize: number
  },
): AtomicOrderedPublicationProjection {
  assertWellFormedDemandAttempts(history)
  const staged = new Map<
    FullFlowPublicationId,
    Map<ScopedIdentity, ReadonlyArray<FullFlowPublishedOrderRow>>
  >()
  const attempts = new Map<
    FullFlowPublicationId,
    Map<
      ScopedIdentity,
      | { outcome: `success`; publishable: boolean }
      | { outcome: `failure` | `abort`; publishable: false }
      | undefined
    >
  >()
  const activeAdditionalDemands: ActiveDemandAttempts = new Map()
  const publications: Array<ReadonlyArray<FullFlowPublishedOrderRow>> = []
  let currentPublication: AtomicOrderedPublicationState | undefined
  let retainsPreviousPublication = false
  let currentReplacement: FullFlowPublicationId | undefined
  let retainedSize = options.initialWindowSize
  let closed = false
  const targetDemand = sourceDemandIdentity(options.sourceId, options.demandId)

  const sortRows = (rows: ReadonlyArray<FullFlowPublishedOrderRow>) =>
    [...rows].sort((left, right) => {
      const valueOrder =
        options.direction === `asc`
          ? left.orderValue - right.orderValue
          : right.orderValue - left.orderValue
      if (valueOrder !== 0) return valueOrder
      if (left.key === right.key) return 0
      return left.key < right.key ? -1 : 1
    })

  const publicationState = (
    publicationId: FullFlowPublicationId,
  ): AtomicOrderedPublicationState | undefined => {
    const publication = staged.get(publicationId)
    const orderedRows = publication?.get(targetDemand)
    if (!publication || !orderedRows) return undefined

    const orderedPrefix = sortRows(orderedRows).slice(0, retainedSize)
    const desired = new Map(orderedPrefix.map((row) => [row.key, row] as const))
    for (const demandId of activeAdditionalDemands.keys()) {
      for (const row of publication.get(demandId) ?? []) {
        desired.set(row.key, row)
      }
    }
    return {
      rows: sortRows([...desired.values()]),
      orderedPrefixSize: orderedPrefix.length,
      orderedBoundary: orderedPrefix.at(-1),
    }
  }

  const publish = (publicationId: FullFlowPublicationId) => {
    const next = publicationState(publicationId)
    if (!next) return
    const previous = publications.at(-1)
    if (previous === undefined && next.rows.length === 0) {
      currentPublication = next
      return
    }
    if (
      previous?.length === next.rows.length &&
      previous.every(
        (row, index) =>
          row.key === next.rows[index]!.key &&
          row.orderValue === next.rows[index]!.orderValue,
      )
    ) {
      currentPublication = next
      return
    }
    publications.push(next.rows)
    currentPublication = next
  }

  const finishCurrentReplacement = () => {
    if (currentReplacement === undefined) return
    if (
      [...attempts.values()].some((demands) =>
        [...demands.values()].some((outcome) => outcome === undefined),
      )
    ) {
      return
    }

    const current = attempts.get(currentReplacement)
    const ordered = current?.get(targetDemand)
    const activeDemandFailed = [...activeAdditionalDemands.keys()].some(
      (demandId) => current?.get(demandId)?.outcome !== `success`,
    )
    if (ordered?.outcome !== `success` || activeDemandFailed) {
      attempts.clear()
      currentReplacement = undefined
      retainsPreviousPublication = true
      return
    }
    if (!ordered.publishable) return

    publish(currentReplacement)
    attempts.clear()
    currentReplacement = undefined
    retainsPreviousPublication = false
  }

  for (const event of history) {
    if (closed) continue
    switch (event.type) {
      case `stagePublicationRows`: {
        let publication = staged.get(event.publicationId)
        if (!publication) {
          publication = new Map()
          staged.set(event.publicationId, publication)
        }
        publication.set(
          sourceDemandIdentity(event.sourceId, event.demandId),
          event.rows,
        )
        break
      }
      case `commitPublication`: {
        if (attempts.size > 0) break
        publish(event.publicationId)
        retainsPreviousPublication = false
        break
      }
      case `beginReplacement`:
        attempts.set(
          event.publicationId,
          new Map(
            event.demands.map(({ sourceId, demandId }) => [
              sourceDemandIdentity(sourceId, demandId),
              undefined,
            ]),
          ),
        )
        currentReplacement = event.publicationId
        retainsPreviousPublication = true
        break
      case `resizeOrderedWindow`:
        if (
          event.sourceId !== options.sourceId ||
          event.demandId !== options.demandId
        ) {
          break
        }
        retainedSize = Math.max(retainedSize, event.size)
        break
      case `settleReplacement`: {
        const attempt = attempts.get(event.publicationId)
        const demandKey = sourceDemandIdentity(event.sourceId, event.demandId)
        if (!attempt?.has(demandKey)) break
        attempt.set(
          demandKey,
          event.outcome === `success`
            ? {
                outcome: `success`,
                publishable: event.extent === `exhausted`,
              }
            : { outcome: event.outcome, publishable: false },
        )
        finishCurrentReplacement()
        break
      }
      case `establishReplacementCoverage`: {
        if (
          event.publicationId !== currentReplacement ||
          event.sourceId !== options.sourceId ||
          event.demandId !== options.demandId
        ) {
          break
        }
        const ordered = attempts.get(event.publicationId)?.get(targetDemand)
        if (ordered?.outcome === `success`) {
          ordered.publishable = true
          finishCurrentReplacement()
        }
        break
      }
      case `requestDemand`:
        if (
          !event.alreadyAborted &&
          (event.sourceId !== options.sourceId ||
            event.demandId !== options.demandId)
        ) {
          addActiveDemandAttempt(
            activeAdditionalDemands,
            sourceDemandIdentity(event.sourceId, event.demandId),
            sourceAttemptIdentity(event.sourceId, event.attemptId),
          )
        }
        break
      case `applyAuthoritativeRows`:
      case `applyUnprovenRows`:
      case `rejectDemand`:
        break
      case `releaseDemand`:
        releaseActiveDemandAttempt(
          activeAdditionalDemands,
          sourceDemandIdentity(event.sourceId, event.demandId),
          sourceAttemptIdentity(event.sourceId, event.attemptId),
        )
        break
      case `truncateSource`:
      case `restartSession`:
      case `advanceWindowRevision`:
      case `scheduleContinuation`:
      case `runContinuation`:
        break
      case `cleanupSession`:
        attempts.clear()
        currentReplacement = undefined
        activeAdditionalDemands.clear()
        retainsPreviousPublication = false
        closed = true
        break
    }
  }

  return {
    publications,
    currentPublication,
    retainsPreviousPublication,
  }
}

/** Derives source-qualified row identity without consulting Collection state. */
export function projectRetainedSourceRows(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
): Array<ExpectedPublicRow> {
  assertWellFormedDemandAttempts(history)
  const activeAttempts: ActiveDemandAttempts = new Map()
  const activeAttemptIds = new Set<ScopedIdentity>()
  const currentAcquisitions = new Map<ScopedIdentity, ScopedIdentity>()
  const reusableRows = new Map<
    ScopedIdentity,
    { acquisitionId: ScopedIdentity; rows: Set<string> }
  >()
  const attemptAcquisitions = new Map<ScopedIdentity, ScopedIdentity>()
  const acquisitionAttempts: AcquisitionAttempts = new Map()
  const rowClaims = new Map<
    ScopedIdentity,
    { row: ExpectedPublicRow; attempts: Set<ScopedIdentity> }
  >()
  const attemptRows = new Map<ScopedIdentity, Set<ScopedIdentity>>()

  const claimRows = (
    attemptKey: ScopedIdentity,
    sourceId: FullFlowSourceId,
    rowKeys: Iterable<string>,
  ) => {
    let claimed = attemptRows.get(attemptKey)
    if (!claimed) {
      claimed = new Set()
      attemptRows.set(attemptKey, claimed)
    }
    for (const rowKey of rowKeys) {
      const rowIdentity = sourceRowIdentity(sourceId, rowKey)
      claimed.add(rowIdentity)
      let claim = rowClaims.get(rowIdentity)
      if (!claim) {
        claim = { row: { sourceId, rowKey }, attempts: new Set() }
        rowClaims.set(rowIdentity, claim)
      }
      claim.attempts.add(attemptKey)
    }
  }

  const releaseRows = (attemptKey: ScopedIdentity) => {
    for (const rowIdentity of attemptRows.get(attemptKey) ?? []) {
      const claim = rowClaims.get(rowIdentity)
      claim?.attempts.delete(attemptKey)
      if (claim?.attempts.size === 0) rowClaims.delete(rowIdentity)
    }
    attemptRows.delete(attemptKey)
  }

  for (const event of history) {
    switch (event.type) {
      case `requestDemand`: {
        if (event.alreadyAborted) break
        const demandKey = sourceDemandIdentity(event.sourceId, event.demandId)
        const attemptKey = sourceAttemptIdentity(
          event.sourceId,
          event.attemptId,
        )
        addActiveDemandAttempt(activeAttempts, demandKey, attemptKey)
        activeAttemptIds.add(attemptKey)
        const retained = reusableRows.get(demandKey)
        const acquisitionId =
          currentAcquisitions.get(demandKey) ??
          retained?.acquisitionId ??
          attemptKey
        currentAcquisitions.set(demandKey, acquisitionId)
        attemptAcquisitions.set(attemptKey, acquisitionId)
        addAcquisitionAttempt(acquisitionAttempts, acquisitionId, attemptKey)
        if (retained) claimRows(attemptKey, event.sourceId, retained.rows)
        break
      }
      case `applyAuthoritativeRows`: {
        const demandKey = sourceDemandIdentity(event.sourceId, event.demandId)
        const attemptKey = sourceAttemptIdentity(
          event.sourceId,
          event.attemptId,
        )
        const acquisitionId = attemptAcquisitions.get(attemptKey)
        const participants =
          acquisitionId === undefined
            ? []
            : (acquisitionAttempts.get(acquisitionId) ?? [])
        if (
          acquisitionId !== undefined &&
          currentAcquisitions.get(demandKey) === acquisitionId
        ) {
          const rows = new Set(event.rowKeys)
          reusableRows.set(demandKey, { acquisitionId, rows })
          currentAcquisitions.delete(demandKey)
        }
        for (const participant of participants) {
          if (activeAttemptIds.has(participant)) {
            claimRows(participant, event.sourceId, event.rowKeys)
          }
        }
        break
      }
      case `applyUnprovenRows`: {
        const demandKey = sourceDemandIdentity(event.sourceId, event.demandId)
        const attemptKey = sourceAttemptIdentity(
          event.sourceId,
          event.attemptId,
        )
        const acquisitionId = attemptAcquisitions.get(attemptKey)
        if (
          acquisitionId !== undefined &&
          currentAcquisitions.get(demandKey) === acquisitionId
        ) {
          currentAcquisitions.delete(demandKey)
        }
        const participants =
          acquisitionId === undefined
            ? []
            : (acquisitionAttempts.get(acquisitionId) ?? [])
        for (const participant of participants) {
          if (activeAttemptIds.has(participant)) {
            claimRows(participant, event.sourceId, event.rowKeys)
          }
        }
        break
      }
      case `rejectDemand`:
      case `settleDemandWithoutEvidence`: {
        const demandKey = sourceDemandIdentity(event.sourceId, event.demandId)
        const attemptKey = sourceAttemptIdentity(
          event.sourceId,
          event.attemptId,
        )
        const acquisitionId = attemptAcquisitions.get(attemptKey)
        if (
          acquisitionId !== undefined &&
          currentAcquisitions.get(demandKey) === acquisitionId
        ) {
          currentAcquisitions.delete(demandKey)
        }
        break
      }
      case `truncateSource`:
        for (const scope of currentAcquisitions.keys()) {
          if (belongsToSource(scope, event.sourceId)) {
            currentAcquisitions.delete(scope)
          }
        }
        for (const scope of reusableRows.keys()) {
          if (belongsToSource(scope, event.sourceId)) {
            reusableRows.delete(scope)
          }
        }
        for (const rowIdentity of rowClaims.keys()) {
          if (belongsToSource(rowIdentity, event.sourceId)) {
            rowClaims.delete(rowIdentity)
            for (const rows of attemptRows.values()) rows.delete(rowIdentity)
          }
        }
        break
      case `releaseDemand`: {
        const demandKey = sourceDemandIdentity(event.sourceId, event.demandId)
        const attemptKey = sourceAttemptIdentity(
          event.sourceId,
          event.attemptId,
        )
        activeAttemptIds.delete(attemptKey)
        const acquisitionId = attemptAcquisitions.get(attemptKey)
        releaseActiveDemandAttempt(activeAttempts, demandKey, attemptKey)
        releaseRows(attemptKey)
        if (
          acquisitionId !== undefined &&
          releaseAcquisitionAttempt(
            acquisitionAttempts,
            acquisitionId,
            attemptKey,
          )
        ) {
          if (currentAcquisitions.get(demandKey) === acquisitionId) {
            currentAcquisitions.delete(demandKey)
          }
          if (reusableRows.get(demandKey)?.acquisitionId === acquisitionId) {
            reusableRows.delete(demandKey)
          }
        }
        break
      }
      default:
        break
    }
  }

  return sortPublicRows([...rowClaims.values()].map(({ row }) => row))
}

/** Single-source convenience projection retained for existing controls. */
export function projectRetainedRowKeys(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
): Array<string> {
  return projectRetainedSourceRows(history).map(({ rowKey }) => rowKey)
}

export type ExpectedSyncReceiptState = `pending` | `resolved` | `rejected`

export type ExpectedPublicRow = {
  sourceId: FullFlowSourceId
  rowKey: string
}

export type ExpectedSyncTransactionObservation = {
  visibleRows: Array<ExpectedPublicRow>
  publishedBatches: Array<Array<ExpectedPublicRow>>
  callbackReads: Array<Array<ExpectedPublicRow>>
  receipts: Array<{
    transactionId: FullFlowTransactionId
    state: ExpectedSyncReceiptState
  }>
}

type SyncTransactionState =
  | `staged`
  | `committed`
  | `parked`
  | `applying`
  | `published`
  | `resolved`
  | `rejected`

type ProjectedSyncTransaction = {
  sourceId: FullFlowSourceId
  rowKeys: ReadonlyArray<string>
  state: SyncTransactionState
}

function sortPublicRows(
  rows: Iterable<ExpectedPublicRow>,
): Array<ExpectedPublicRow> {
  return [...rows].sort((left, right) =>
    left.sourceId === right.sourceId
      ? left.rowKey.localeCompare(right.rowKey)
      : left.sourceId.localeCompare(right.sourceId),
  )
}

/**
 * Projects the sync transaction's public contract without consulting the
 * collection queue. Abort can still win while work is staged, committed, or
 * parked. Once application starts, publication is irrevocable. A receipt does
 * not resolve until the published batch and callback-time reads are visible.
 */
export function projectSyncTransactions(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
): ExpectedSyncTransactionObservation {
  const transactions = new Map<
    FullFlowTransactionId,
    ProjectedSyncTransaction
  >()
  const visibleRows = new Map<string, ExpectedPublicRow>()
  const publishedBatches: Array<Array<ExpectedPublicRow>> = []
  const callbackReads: Array<Array<ExpectedPublicRow>> = []

  for (const event of history) {
    switch (event.type) {
      case `stageSyncTransaction`:
        transactions.set(event.transactionId, {
          sourceId: event.sourceId,
          rowKeys: event.rowKeys,
          state: `staged`,
        })
        break
      case `commitSyncTransaction`: {
        const transaction = transactions.get(event.transactionId)
        if (!transaction || transaction.state !== `staged`) break
        transaction.state = event.signalAborted
          ? `rejected`
          : event.parked
            ? `parked`
            : `committed`
        break
      }
      case `enterSyncApplication`: {
        const transaction = transactions.get(event.transactionId)
        if (
          transaction?.state === `committed` ||
          transaction?.state === `parked`
        ) {
          transaction.state = `applying`
        }
        break
      }
      case `abortSyncTransaction`: {
        const transaction = transactions.get(event.transactionId)
        if (
          transaction?.state === `staged` ||
          transaction?.state === `committed` ||
          transaction?.state === `parked`
        ) {
          transaction.state = `rejected`
        }
        break
      }
      case `publishSyncTransaction`: {
        const transaction = transactions.get(event.transactionId)
        if (transaction?.state !== `applying`) break
        const batch = transaction.rowKeys.map((rowKey) => ({
          sourceId: transaction.sourceId,
          rowKey,
        }))
        for (const row of batch) {
          visibleRows.set(`${row.sourceId}\u0000${row.rowKey}`, row)
        }
        transaction.state = `published`
        publishedBatches.push(sortPublicRows(batch))
        callbackReads.push(sortPublicRows(visibleRows.values()))
        break
      }
      case `settleSyncReceipt`: {
        const transaction = transactions.get(event.transactionId)
        if (transaction?.state === `published`) {
          transaction.state = `resolved`
        }
        break
      }
      case `requestDemand`:
      case `applyAuthoritativeRows`:
      case `settleDemandWithoutEvidence`:
      case `releaseDemand`:
      case `restartSession`:
      case `cleanupSession`:
      case `advanceWindowRevision`:
      case `scheduleContinuation`:
      case `runContinuation`:
      case `establishPublication`:
      case `startReplay`:
      case `writeReplayRows`:
      case `settleReplay`:
      case `registerSourceDemand`:
      case `settleSourceDemand`:
      case `retireSourceDemand`:
      case `startAcquisition`:
      case `attachAcquisitionOwner`:
      case `settleAcquisition`:
        break
    }
  }

  return {
    visibleRows: sortPublicRows(visibleRows.values()),
    publishedBatches,
    callbackReads,
    receipts: [...transactions]
      .map(([transactionId, transaction]) => {
        const state =
          transaction.state === `resolved`
            ? `resolved`
            : transaction.state === `rejected`
              ? `rejected`
              : `pending`
        return { transactionId, state } as const
      })
      .sort((left, right) =>
        left.transactionId.localeCompare(right.transactionId),
      ),
  }
}

export type ExpectedVersionedChange = {
  type: `insert` | `update` | `delete`
  row: FullFlowVersionedRow
  previousVersion?: number
}

export type ExpectedReplayObservation = {
  coreRows: Array<FullFlowVersionedRow>
  visibleRows: Array<FullFlowVersionedRow>
  publishedBatches: Array<Array<ExpectedVersionedChange>>
  callbackReads: Array<Array<FullFlowVersionedRow>>
}

type ProjectedReplayAttempt = {
  outcome?: `resolve` | `reject`
}

type ProjectedReplaySession = {
  sourceId: FullFlowSourceId
  currentAttemptId: string
  attempts: Map<string, ProjectedReplayAttempt>
  baseline: Map<string, FullFlowVersionedRow>
}

function versionedRowIdentity(row: FullFlowVersionedRow): string {
  return `${row.sourceId}\u0000${row.rowKey}`
}

function sortVersionedRows(
  rows: Iterable<FullFlowVersionedRow>,
): Array<FullFlowVersionedRow> {
  return [...rows].sort((left, right) =>
    versionedRowIdentity(left).localeCompare(versionedRowIdentity(right)),
  )
}

function versionedPublicationDiff(
  baseline: ReadonlyMap<string, FullFlowVersionedRow>,
  replacement: ReadonlyMap<string, FullFlowVersionedRow>,
): Array<ExpectedVersionedChange> {
  const changes: Array<ExpectedVersionedChange> = []
  for (const [identity, previous] of baseline) {
    const next = replacement.get(identity)
    if (!next) {
      changes.push({ type: `delete`, row: previous })
    } else if (next.version !== previous.version) {
      changes.push({
        type: `update`,
        row: next,
        previousVersion: previous.version,
      })
    }
  }
  for (const [identity, row] of replacement) {
    if (!baseline.has(identity)) changes.push({ type: `insert`, row })
  }
  return changes.sort((left, right) =>
    versionedRowIdentity(left.row).localeCompare(
      versionedRowIdentity(right.row),
    ),
  )
}

/**
 * Projects truncate replay as a replacement protocol. Core rows and last-good
 * publication are independent domains: truncate clears core immediately, but
 * public rows change only after every overlapping attempt settles and the
 * newest attempt succeeds.
 */
export function projectReplayPublication(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
): ExpectedReplayObservation {
  const coreRows = new Map<string, FullFlowVersionedRow>()
  const visibleRows = new Map<string, FullFlowVersionedRow>()
  const publishedBatches: Array<Array<ExpectedVersionedChange>> = []
  const callbackReads: Array<Array<FullFlowVersionedRow>> = []
  const sessions = new Map<FullFlowSourceId, ProjectedReplaySession>()
  const attemptSessions = new Map<string, ProjectedReplaySession>()

  for (const event of history) {
    switch (event.type) {
      case `establishPublication`: {
        const batch: Array<ExpectedVersionedChange> = []
        for (const row of event.rows) {
          const identity = versionedRowIdentity(row)
          coreRows.set(identity, row)
          visibleRows.set(identity, row)
          batch.push({ type: `insert`, row })
        }
        if (batch.length > 0) {
          publishedBatches.push(batch)
          callbackReads.push(sortVersionedRows(visibleRows.values()))
        }
        break
      }
      case `startReplay`: {
        let session = sessions.get(event.sourceId)
        if (!session) {
          session = {
            sourceId: event.sourceId,
            currentAttemptId: event.attemptId,
            attempts: new Map(),
            baseline: new Map(
              [...visibleRows].filter(
                ([, row]) => row.sourceId === event.sourceId,
              ),
            ),
          }
          sessions.set(event.sourceId, session)
        }
        session.currentAttemptId = event.attemptId
        session.attempts.set(event.attemptId, {})
        attemptSessions.set(event.attemptId, session)
        for (const [identity, row] of coreRows) {
          if (row.sourceId === event.sourceId) coreRows.delete(identity)
        }
        break
      }
      case `writeReplayRows`:
        if (event.acceptedByCore) {
          for (const row of event.rows) {
            coreRows.set(versionedRowIdentity(row), row)
          }
        }
        break
      case `settleReplay`: {
        const session = attemptSessions.get(event.attemptId)
        const attempt = session?.attempts.get(event.attemptId)
        if (!session || !attempt) break
        attempt.outcome = event.outcome
        if ([...session.attempts.values()].some(({ outcome }) => !outcome)) {
          break
        }

        const current = session.attempts.get(session.currentAttemptId)
        if (current?.outcome === `resolve`) {
          const replacement = new Map(
            [...coreRows].filter(
              ([, row]) => row.sourceId === session.sourceId,
            ),
          )
          const changes = versionedPublicationDiff(
            session.baseline,
            replacement,
          )
          for (const [identity, row] of visibleRows) {
            if (row.sourceId === session.sourceId) visibleRows.delete(identity)
          }
          for (const [identity, row] of replacement) {
            visibleRows.set(identity, row)
          }
          if (changes.length > 0) {
            publishedBatches.push(changes)
            callbackReads.push(sortVersionedRows(visibleRows.values()))
          }
        }
        sessions.delete(session.sourceId)
        for (const attemptId of session.attempts.keys()) {
          attemptSessions.delete(attemptId)
        }
        break
      }
      case `requestDemand`:
      case `applyAuthoritativeRows`:
      case `settleDemandWithoutEvidence`:
      case `releaseDemand`:
      case `restartSession`:
      case `cleanupSession`:
      case `advanceWindowRevision`:
      case `scheduleContinuation`:
      case `runContinuation`:
      case `stageSyncTransaction`:
      case `commitSyncTransaction`:
      case `enterSyncApplication`:
      case `abortSyncTransaction`:
      case `publishSyncTransaction`:
      case `settleSyncReceipt`:
      case `registerSourceDemand`:
      case `settleSourceDemand`:
      case `retireSourceDemand`:
      case `startAcquisition`:
      case `attachAcquisitionOwner`:
      case `settleAcquisition`:
        break
    }
  }

  return {
    coreRows: sortVersionedRows(coreRows.values()),
    visibleRows: sortVersionedRows(visibleRows.values()),
    publishedBatches,
    callbackReads,
  }
}

export type ExpectedSourceReadiness = {
  status: `loading` | `ready` | `error` | `cleaned-up`
  pendingSources: Array<FullFlowSourceId>
  failedSources: Array<FullFlowSourceId>
}

/** Projects initial live-query readiness across every reachable source. */
export function projectSourceReadiness(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
): ExpectedSourceReadiness {
  const demands = new Map<
    string,
    {
      sourceId: FullFlowSourceId
      demandId: FullFlowDemandId
      attemptId: FullFlowAttemptId
      state: `pending` | `resolved` | `rejected`
    }
  >()
  let currentSession: FullFlowSessionId | undefined
  let cleanedUp = false

  for (const event of history) {
    switch (event.type) {
      case `registerSourceDemand`:
        currentSession ??= event.sessionId
        if (event.sessionId !== currentSession) break
        cleanedUp = false
        demands.set(
          sourceDemandAttemptIdentity(
            event.sourceId,
            event.demandId,
            event.attemptId,
          ),
          {
            sourceId: event.sourceId,
            demandId: event.demandId,
            attemptId: event.attemptId,
            state: `pending`,
          },
        )
        break
      case `settleSourceDemand`: {
        if (event.sessionId !== currentSession) break
        const demand = demands.get(
          sourceDemandAttemptIdentity(
            event.sourceId,
            event.demandId,
            event.attemptId,
          ),
        )
        if (demand)
          demand.state = event.outcome === `resolve` ? `resolved` : `rejected`
        break
      }
      case `retireSourceDemand`:
        if (event.sessionId !== currentSession) break
        demands.delete(
          sourceDemandAttemptIdentity(
            event.sourceId,
            event.demandId,
            event.attemptId,
          ),
        )
        break
      case `cleanupSession`:
        if (event.sessionId === currentSession) {
          cleanedUp = true
          demands.clear()
        }
        break
      case `restartSession`:
        currentSession = event.nextSessionId
        cleanedUp = false
        demands.clear()
        break
      case `requestDemand`:
      case `applyAuthoritativeRows`:
      case `settleDemandWithoutEvidence`:
      case `releaseDemand`:
      case `advanceWindowRevision`:
      case `scheduleContinuation`:
      case `runContinuation`:
      case `stageSyncTransaction`:
      case `commitSyncTransaction`:
      case `enterSyncApplication`:
      case `abortSyncTransaction`:
      case `publishSyncTransaction`:
      case `settleSyncReceipt`:
      case `establishPublication`:
      case `startReplay`:
      case `writeReplayRows`:
      case `settleReplay`:
      case `startAcquisition`:
      case `attachAcquisitionOwner`:
      case `settleAcquisition`:
        break
    }
  }

  const currentDemands = [...demands.values()]
  const pendingSources = [
    ...new Set(
      currentDemands
        .filter(({ state }) => state === `pending`)
        .map(({ sourceId }) => sourceId),
    ),
  ].sort()
  const failedSources = [
    ...new Set(
      currentDemands
        .filter(({ state }) => state === `rejected`)
        .map(({ sourceId }) => sourceId),
    ),
  ].sort()

  return {
    status: cleanedUp
      ? `cleaned-up`
      : failedSources.length > 0
        ? `error`
        : pendingSources.length > 0 || currentDemands.length === 0
          ? `loading`
          : `ready`,
    pendingSources,
    failedSources,
  }
}

export type ExpectedAcquisitionObservation = {
  physicalStarts: Array<FullFlowAcquisitionId>
  owners: Array<{
    ownerId: FullFlowOwnerId
    state: `pending` | `resolved` | `rejected`
    rowKeys: Array<string>
  }>
  visibleRowKeys: Array<string>
}

/**
 * Projects the semantic result of physical acquisition sharing.
 *
 * A physical acquisition may serve one or many logical owners. Sharing may
 * reduce transport starts, but it cannot change any owner's settlement or the
 * rows made visible by successful work.
 */
export function projectAcquisitionSettlement(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
): ExpectedAcquisitionObservation {
  const acquisitions = new Map<
    FullFlowAcquisitionId,
    {
      owners: Set<FullFlowOwnerId>
      state: `pending` | `resolved` | `rejected`
      rowKeys: Array<string>
    }
  >()
  const physicalStarts: Array<FullFlowAcquisitionId> = []
  const visibleRowKeys = new Set<string>()

  for (const event of history) {
    switch (event.type) {
      case `startAcquisition`:
        if (!acquisitions.has(event.acquisitionId)) {
          acquisitions.set(event.acquisitionId, {
            owners: new Set(),
            state: `pending`,
            rowKeys: [],
          })
          physicalStarts.push(event.acquisitionId)
        }
        break
      case `attachAcquisitionOwner`:
        acquisitions.get(event.acquisitionId)?.owners.add(event.ownerId)
        break
      case `settleAcquisition`: {
        const acquisition = acquisitions.get(event.acquisitionId)
        if (!acquisition || acquisition.state !== `pending`) break
        acquisition.state =
          event.outcome === `resolve` ? `resolved` : `rejected`
        acquisition.rowKeys = [...new Set(event.rowKeys)].sort()
        if (acquisition.state === `resolved`) {
          acquisition.rowKeys.forEach((rowKey) => visibleRowKeys.add(rowKey))
        }
        break
      }
      default:
        break
    }
  }

  return {
    physicalStarts,
    owners: [...acquisitions.values()]
      .flatMap((acquisition) =>
        [...acquisition.owners].map((ownerId) => ({
          ownerId,
          state: acquisition.state,
          rowKeys: acquisition.state === `resolved` ? acquisition.rowKeys : [],
        })),
      )
      .sort((left, right) => left.ownerId.localeCompare(right.ownerId)),
    visibleRowKeys: [...visibleRowKeys].sort(),
  }
}

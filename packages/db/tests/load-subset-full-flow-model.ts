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

export type MultiSourceOrderedRow = {
  key: string
  joinKey: string
}

export type MultiSourceSecondaryRow = {
  key: string
  joinKey: string
}

export type MultiSourceOrderedWindow = {
  visiblePairKeys: ReadonlyArray<string>
  scannedPrimaryKeys: ReadonlyArray<string>
  primaryCursorKeys: ReadonlyArray<string | undefined>
  demandedJoinKeys: ReadonlyArray<string>
  rowsNeeded: number
  sourceExhausted: boolean
}

/**
 * Projects the smallest forward primary-source scan that fills a joined
 * window. The caller supplies primary rows in total order, so this projector
 * only owns the cross-source relational law: every scanned primary row advances
 * source progress, while joined pair multiplicity fills offset plus limit.
 * Production may prove the same result with reverse authoritative demands; the
 * boundary harness compares the public result and each transport law separately.
 */
export function projectMultiSourceOrderedWindow(options: {
  primaryOrder: ReadonlyArray<MultiSourceOrderedRow>
  secondaryRows: ReadonlyArray<MultiSourceSecondaryRow>
  offset: number
  limit: number
}): MultiSourceOrderedWindow {
  const scannedPrimaryKeys: Array<string> = []
  const joinedPairKeys: Array<string> = []
  const demandedJoinKeys: Array<string> = []
  const seenJoinKeys = new Set<string>()
  const targetSize = options.limit === 0 ? 0 : options.offset + options.limit
  const secondaryRows = [...options.secondaryRows].sort((left, right) =>
    left.key.localeCompare(right.key),
  )

  for (const row of options.primaryOrder) {
    if (joinedPairKeys.length >= targetSize) break

    scannedPrimaryKeys.push(row.key)
    if (!seenJoinKeys.has(row.joinKey)) {
      seenJoinKeys.add(row.joinKey)
      demandedJoinKeys.push(row.joinKey)
    }
    for (const secondaryRow of secondaryRows) {
      if (secondaryRow.joinKey === row.joinKey) {
        joinedPairKeys.push(`${row.key}:${secondaryRow.key}`)
      }
    }
  }

  const visiblePairKeys = joinedPairKeys.slice(
    options.offset,
    options.offset + options.limit,
  )

  return {
    visiblePairKeys,
    scannedPrimaryKeys,
    primaryCursorKeys: scannedPrimaryKeys.map((_, index) =>
      index === 0 ? undefined : scannedPrimaryKeys[index - 1],
    ),
    demandedJoinKeys,
    rowsNeeded: Math.max(0, options.limit - visiblePairKeys.length),
    sourceExhausted: scannedPrimaryKeys.length === options.primaryOrder.length,
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
      demandId: FullFlowDemandId
      attemptId: FullFlowAttemptId
      alreadyAborted: boolean
    }
  | {
      type: `applyAuthoritativeRows`
      ownerId: FullFlowOwnerId
      demandId: FullFlowDemandId
      attemptId: FullFlowAttemptId
      rowKeys: ReadonlyArray<string>
    }
  | {
      type: `settleDemandWithoutEvidence`
      demandId: FullFlowDemandId
      attemptId: FullFlowAttemptId
    }
  | {
      type: `applyUnprovenRows`
      ownerId: FullFlowOwnerId
      demandId: FullFlowDemandId
      attemptId: FullFlowAttemptId
      rowKeys: ReadonlyArray<string>
    }
  | {
      type: `rejectDemand`
      ownerId: FullFlowOwnerId
      demandId: FullFlowDemandId
      attemptId: FullFlowAttemptId
    }
  | {
      type: `truncateSource`
      sessionId: FullFlowSessionId
    }
  | {
      type: `releaseDemand`
      ownerId: FullFlowOwnerId
      demandId: FullFlowDemandId
      attemptId: FullFlowAttemptId
      rowKeys: ReadonlyArray<string>
      finalRowOwner: boolean
      invalidatesAdapterEvidence: boolean
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
    }
  | {
      type: `settleSourceDemand`
      sessionId: FullFlowSessionId
      sourceId: FullFlowSourceId
      demandId: FullFlowDemandId
      outcome: `resolve` | `reject`
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
      demandIds: ReadonlyArray<FullFlowDemandId>
    }
  | {
      type: `settleReplacement`
      publicationId: FullFlowPublicationId
      demandId: FullFlowDemandId
      outcome: `failure` | `abort`
    }
  | {
      type: `settleReplacement`
      publicationId: FullFlowPublicationId
      demandId: FullFlowDemandId
      outcome: `success`
      extent: `exhausted` | `continues`
    }
  | {
      type: `establishReplacementCoverage`
      publicationId: FullFlowPublicationId
    }
  | {
      type: `resizeOrderedWindow`
      size: number
    }

export type ExpectedAdapterLifecycleEvent = {
  type: `invoke` | `release`
  ownerId: FullFlowOwnerId
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
  const attempts = new Map<FullFlowAttemptId, DemandAttemptRecord>()

  for (const event of history) {
    if (event.type === `requestDemand`) {
      if (attempts.has(event.attemptId)) {
        throw new Error(
          `Demand attempt "${event.attemptId}" was requested more than once`,
        )
      }
      attempts.set(event.attemptId, {
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

    const attempt = attempts.get(event.attemptId)
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
  const invokedOwners = new Set<FullFlowOwnerId>()
  const projected: Array<ExpectedAdapterLifecycleEvent> = []

  for (const event of history) {
    if (event.type === `requestDemand` && !event.alreadyAborted) {
      invokedOwners.add(event.ownerId)
      projected.push({ type: `invoke`, ownerId: event.ownerId })
    }
    if (event.type === `releaseDemand` && invokedOwners.delete(event.ownerId)) {
      projected.push({ type: `release`, ownerId: event.ownerId })
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
  const reusableDemands = new Map<FullFlowDemandId, FullFlowAttemptId>()
  const inFlightDemands = new Map<FullFlowDemandId, FullFlowAttemptId>()
  let loads = 0

  for (const event of history) {
    switch (event.type) {
      case `requestDemand`:
        if (
          !event.alreadyAborted &&
          !reusableDemands.has(event.demandId) &&
          !inFlightDemands.has(event.demandId)
        ) {
          loads++
          inFlightDemands.set(event.demandId, event.attemptId)
        }
        break
      case `applyAuthoritativeRows`: {
        if (inFlightDemands.get(event.demandId) !== event.attemptId) break
        inFlightDemands.delete(event.demandId)
        reusableDemands.set(event.demandId, event.attemptId)
        break
      }
      case `truncateSource`:
        reusableDemands.clear()
        inFlightDemands.clear()
        break
      case `applyUnprovenRows`:
      case `rejectDemand`:
      case `settleDemandWithoutEvidence`:
        if (inFlightDemands.get(event.demandId) === event.attemptId) {
          inFlightDemands.delete(event.demandId)
        }
        break
      case `releaseDemand`:
        if (event.invalidatesAdapterEvidence) {
          if (reusableDemands.get(event.demandId) === event.attemptId) {
            reusableDemands.delete(event.demandId)
          }
          if (inFlightDemands.get(event.demandId) === event.attemptId) {
            inFlightDemands.delete(event.demandId)
          }
        }
        break
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

/** Projects reusable demand evidence without using registry state. */
export function projectReusableDemands(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
): Array<FullFlowDemandId> {
  assertWellFormedDemandAttempts(history)
  const reusableDemands = new Map<FullFlowDemandId, FullFlowAttemptId>()
  const attemptEpochs = new Map<FullFlowAttemptId, number>()
  let sourceEpoch = 0

  for (const event of history) {
    switch (event.type) {
      case `requestDemand`:
        if (!event.alreadyAborted) {
          attemptEpochs.set(event.attemptId, sourceEpoch)
        }
        break
      case `applyAuthoritativeRows`:
        if (attemptEpochs.get(event.attemptId) === sourceEpoch) {
          reusableDemands.set(event.demandId, event.attemptId)
        }
        break
      case `truncateSource`:
        sourceEpoch++
        reusableDemands.clear()
        break
      case `releaseDemand`:
        if (event.invalidatesAdapterEvidence) {
          attemptEpochs.delete(event.attemptId)
          if (reusableDemands.get(event.demandId) === event.attemptId) {
            reusableDemands.delete(event.demandId)
          }
        }
        break
      case `applyUnprovenRows`:
      case `rejectDemand`:
      case `restartSession`:
      case `cleanupSession`:
      case `advanceWindowRevision`:
      case `scheduleContinuation`:
      case `runContinuation`:
      case `stagePublicationRows`:
      case `commitPublication`:
      case `beginReplacement`:
      case `settleReplacement`:
      case `establishReplacementCoverage`:
      case `resizeOrderedWindow`:
        break
    }
  }

  return [...reusableDemands.keys()].sort()
}

/**
 * Projects the last complete ordered boundary from public publication
 * provenance. Rows published for another demand cannot move this boundary,
 * and an uncommitted replacement cannot supersede the last complete snapshot.
 */
export function projectOrderedPublicationBoundary(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
  options: {
    demandId: FullFlowDemandId
    direction: `asc` | `desc`
    prefixSize: number
  },
): FullFlowPublishedOrderRow | undefined {
  const staged = new Map<
    FullFlowPublicationId,
    Map<FullFlowDemandId, ReadonlyArray<FullFlowPublishedOrderRow>>
  >()
  let committedRows: ReadonlyArray<FullFlowPublishedOrderRow> = []

  for (const event of history) {
    if (event.type === `stagePublicationRows`) {
      let publication = staged.get(event.publicationId)
      if (!publication) {
        publication = new Map()
        staged.set(event.publicationId, publication)
      }
      publication.set(event.demandId, event.rows)
      continue
    }
    if (event.type === `commitPublication`) {
      const publication = staged.get(event.publicationId)
      if (publication?.has(options.demandId)) {
        committedRows = publication.get(options.demandId) ?? []
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
    demandId: FullFlowDemandId
    direction: `asc` | `desc`
    initialWindowSize: number
  },
): AtomicOrderedPublicationProjection {
  const staged = new Map<
    FullFlowPublicationId,
    Map<FullFlowDemandId, ReadonlyArray<FullFlowPublishedOrderRow>>
  >()
  const attempts = new Map<
    FullFlowPublicationId,
    Map<
      FullFlowDemandId,
      | { outcome: `success`; publishable: boolean }
      | { outcome: `failure` | `abort`; publishable: false }
      | undefined
    >
  >()
  const activeAdditionalDemands = new Set<FullFlowDemandId>()
  const publications: Array<ReadonlyArray<FullFlowPublishedOrderRow>> = []
  let currentPublication: AtomicOrderedPublicationState | undefined
  let retainsPreviousPublication = false
  let currentReplacement: FullFlowPublicationId | undefined
  let retainedSize = options.initialWindowSize
  let closed = false

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
    const orderedRows = publication?.get(options.demandId)
    if (!publication || !orderedRows) return undefined

    const orderedPrefix = sortRows(orderedRows).slice(0, retainedSize)
    const desired = new Map(orderedPrefix.map((row) => [row.key, row] as const))
    for (const demandId of activeAdditionalDemands) {
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
    const ordered = current?.get(options.demandId)
    const activeDemandFailed = [...activeAdditionalDemands].some(
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
        publication.set(event.demandId, event.rows)
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
          new Map(event.demandIds.map((demandId) => [demandId, undefined])),
        )
        currentReplacement = event.publicationId
        retainsPreviousPublication = true
        break
      case `resizeOrderedWindow`:
        retainedSize = Math.max(retainedSize, event.size)
        break
      case `settleReplacement`: {
        const attempt = attempts.get(event.publicationId)
        if (!attempt?.has(event.demandId)) break
        attempt.set(
          event.demandId,
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
        if (event.publicationId !== currentReplacement) break
        const ordered = attempts.get(event.publicationId)?.get(options.demandId)
        if (ordered?.outcome === `success`) {
          ordered.publishable = true
          finishCurrentReplacement()
        }
        break
      }
      case `requestDemand`:
        if (!event.alreadyAborted && event.demandId !== options.demandId) {
          activeAdditionalDemands.add(event.demandId)
        }
        break
      case `applyAuthoritativeRows`:
      case `applyUnprovenRows`:
      case `rejectDemand`:
        break
      case `releaseDemand`:
        activeAdditionalDemands.delete(event.demandId)
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

/** Derives visible row identity without consulting Collection implementation. */
export function projectRetainedRowKeys(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
): Array<string> {
  const retainedRows = new Set<string>()

  for (const event of history) {
    if (
      event.type === `applyAuthoritativeRows` ||
      event.type === `applyUnprovenRows`
    ) {
      event.rowKeys.forEach((key) => retainedRows.add(key))
    }
    if (event.type === `truncateSource`) retainedRows.clear()
    if (event.type === `releaseDemand` && event.finalRowOwner) {
      event.rowKeys.forEach((key) => retainedRows.delete(key))
    }
  }

  return [...retainedRows].sort()
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
        demands.set(`${event.sourceId}\u0000${event.demandId}`, {
          sourceId: event.sourceId,
          state: `pending`,
        })
        break
      case `settleSourceDemand`: {
        if (event.sessionId !== currentSession) break
        const demand = demands.get(`${event.sourceId}\u0000${event.demandId}`)
        if (demand)
          demand.state = event.outcome === `resolve` ? `resolved` : `rejected`
        break
      }
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

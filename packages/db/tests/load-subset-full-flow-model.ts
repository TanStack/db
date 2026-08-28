export type FullFlowOwnerId = string
export type FullFlowSessionId = string
export type FullFlowDemandId = string
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
      alreadyAborted: boolean
    }
  | {
      type: `applyAuthoritativeRows`
      ownerId: FullFlowOwnerId
      demandId: FullFlowDemandId
      rowKeys: ReadonlyArray<string>
    }
  | {
      type: `applyUnprovenRows`
      ownerId: FullFlowOwnerId
      demandId: FullFlowDemandId
      rowKeys: ReadonlyArray<string>
    }
  | {
      type: `rejectDemand`
      ownerId: FullFlowOwnerId
      demandId: FullFlowDemandId
    }
  | {
      type: `truncateSource`
      sessionId: FullFlowSessionId
    }
  | {
      type: `releaseDemand`
      ownerId: FullFlowOwnerId
      demandId: FullFlowDemandId
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
 * Request settlement alone is not evidence. Only an applied authoritative row
 * publication makes the exact demand reusable, and an unload that invalidates
 * that evidence forces the next owner to fetch again.
 */
export function projectTransportLoads(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
): number {
  const reusableDemands = new Set<FullFlowDemandId>()
  const requestEpochs = new Map<FullFlowOwnerId, number>()
  let sourceEpoch = 0
  let loads = 0

  for (const event of history) {
    switch (event.type) {
      case `requestDemand`:
        if (!event.alreadyAborted && !reusableDemands.has(event.demandId)) {
          loads++
        }
        if (!event.alreadyAborted) {
          requestEpochs.set(event.ownerId, sourceEpoch)
        }
        break
      case `applyAuthoritativeRows`:
        if (requestEpochs.get(event.ownerId) === sourceEpoch) {
          reusableDemands.add(event.demandId)
        }
        break
      case `truncateSource`:
        sourceEpoch++
        reusableDemands.clear()
        break
      case `applyUnprovenRows`:
      case `rejectDemand`:
        break
      case `releaseDemand`:
        if (event.invalidatesAdapterEvidence) {
          reusableDemands.delete(event.demandId)
        }
        break
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
      case `applyUnprovenRows`:
      case `rejectDemand`:
      case `truncateSource`:
      case `releaseDemand`:
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
  const reusableDemands = new Set<FullFlowDemandId>()
  const requestEpochs = new Map<FullFlowOwnerId, number>()
  let sourceEpoch = 0

  for (const event of history) {
    switch (event.type) {
      case `requestDemand`:
        if (!event.alreadyAborted) {
          requestEpochs.set(event.ownerId, sourceEpoch)
        }
        break
      case `applyAuthoritativeRows`:
        if (requestEpochs.get(event.ownerId) === sourceEpoch) {
          reusableDemands.add(event.demandId)
        }
        break
      case `truncateSource`:
        sourceEpoch++
        reusableDemands.clear()
        break
      case `releaseDemand`:
        if (event.invalidatesAdapterEvidence) {
          reusableDemands.delete(event.demandId)
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

  return [...reusableDemands].sort()
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

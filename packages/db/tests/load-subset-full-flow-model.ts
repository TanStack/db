export type FullFlowOwnerId = string
export type FullFlowSessionId = string
export type FullFlowDemandId = string
export type FullFlowPublicationId = string

export type FullFlowPublishedOrderRow = {
  key: string
  orderValue: number
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

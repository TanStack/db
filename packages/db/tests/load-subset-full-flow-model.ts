export type FullFlowOwnerId = string
export type FullFlowSessionId = string
export type FullFlowDemandId = string

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
        break
    }
  }

  return loads
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
        break
    }
  }

  return [...reusableDemands].sort()
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

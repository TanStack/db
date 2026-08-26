export type FullFlowOwnerId = string
export type FullFlowSessionId = string
export type FullFlowDemandId = string
export type FullFlowSourceId = string
export type FullFlowTransactionId = string

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
  let loads = 0

  for (const event of history) {
    switch (event.type) {
      case `requestDemand`:
        if (!event.alreadyAborted && !reusableDemands.has(event.demandId)) {
          loads++
        }
        break
      case `applyAuthoritativeRows`:
        reusableDemands.add(event.demandId)
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
      case `stageSyncTransaction`:
      case `commitSyncTransaction`:
      case `enterSyncApplication`:
      case `abortSyncTransaction`:
      case `publishSyncTransaction`:
      case `settleSyncReceipt`:
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
      case `releaseDemand`:
      case `stageSyncTransaction`:
      case `commitSyncTransaction`:
      case `enterSyncApplication`:
      case `abortSyncTransaction`:
      case `publishSyncTransaction`:
      case `settleSyncReceipt`:
        break
    }
  }

  return starts
}

/** Derives visible row identity without consulting Collection implementation. */
export function projectRetainedRowKeys(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
): Array<string> {
  const retainedRows = new Set<string>()

  for (const event of history) {
    if (event.type === `applyAuthoritativeRows`) {
      event.rowKeys.forEach((key) => retainedRows.add(key))
    }
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
      case `releaseDemand`:
      case `restartSession`:
      case `cleanupSession`:
      case `advanceWindowRevision`:
      case `scheduleContinuation`:
      case `runContinuation`:
        break
    }
  }

  return {
    visibleRows: sortPublicRows(visibleRows.values()),
    publishedBatches,
    callbackReads,
    receipts: [...transactions]
      .flatMap(([transactionId, transaction]) => {
        const state =
          transaction.state === `resolved`
            ? `resolved`
            : transaction.state === `rejected`
              ? `rejected`
              : `pending`
        return [{ transactionId, state } as const]
      })
      .sort((left, right) =>
        left.transactionId.localeCompare(right.transactionId),
      ),
  }
}

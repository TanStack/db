export type FullFlowOwnerId = string
export type FullFlowSessionId = string
export type FullFlowDemandId = string
export type FullFlowSourceId = string
export type FullFlowTransactionId = string
export type FullFlowAcquisitionId = string
export type FullFlowVersionedRow = {
  sourceId: FullFlowSourceId
  rowKey: string
  version: number
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
      sessionId: FullFlowSessionId
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
          sessionId: event.sessionId,
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

  const currentDemands = [...demands.values()].filter(
    ({ sessionId }) => sessionId === currentSession,
  )
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

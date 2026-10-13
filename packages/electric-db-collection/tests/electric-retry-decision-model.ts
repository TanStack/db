/**
 * The independent model for the Electric retry-decision law. It is shared by
 * the retry-decision oracle in `electric-oracle.property.test.ts`, which
 * drives a controlled ShapeStream, and by the installed-client lane in
 * `electric-sdk-delivery-oracle.property.test.ts`. It reads no production
 * state. The law and its history grammar are documented beside the
 * retry-decision oracle.
 */
// `full-log` and `progressive` demands wait on the established snapshot.
// `eager` and `changes-only` sources have no such wait, so their histories
// observe only status, readiness, and row visibility.
export type RetryWait = `full-log` | `progressive` | `eager` | `changes-only`
export type RetryDecision =
  `sync-retry` | `sync-give-up` | `throw` | `async-retry` | `async-give-up`
export type RetryStep =
  | { kind: `demand` }
  | { kind: `error`; decision: RetryDecision }
  | { kind: `decide` }
  | { kind: `up-to-date` }
  | { kind: `client-give-up` }
  | { kind: `abort` }
  | { kind: `hold` }
  | { kind: `release` }
export type RetryHistory = {
  wait: RetryWait
  hasOnError: boolean
  // The stream's external signal is already aborted when sync starts.
  abortedAtStart?: boolean
  // A `status:change` listener cleans the Collection up when it enters
  // `error`, inside the failure's own notification.
  cleanupOnError?: boolean
  steps: Array<RetryStep>
}
export type RetrySettlement = `pending` | `fulfilled` | `rejected:${string}`
export type RetryObservation = {
  status: string
  demands: Array<RetrySettlement>
  rowVisible: boolean
  // A readiness wait started with the history. It rejects with the same
  // cause as every waiting demand. Not compared after cleanup.
  preload?: RetrySettlement
}

export type RetryModel = {
  truncates: boolean
  waits: boolean
  rows: boolean
  cleanupOnError: boolean
  cleanedUp: boolean
  ready: boolean
  visible: boolean
  held: boolean
  failed: string | undefined
  aborted: boolean
  deciding: { decision: RetryDecision; cause: string } | undefined
  demands: Array<RetrySettlement>
}

// Each error, throw, and abort has a tag, so a rejection's cause can be
// compared by identity without reading production state.
export function retryModelFail(model: RetryModel, cause: string): void {
  if (model.ready || model.failed !== undefined) return
  model.failed = cause
  model.demands = model.demands.map((settlement): RetrySettlement =>
    settlement === `pending` ? `rejected:${cause}` : settlement,
  )
  // The failure is decided before any cleanup it triggers, so a demand it
  // rejected stays rejected with its cause.
  if (model.cleanupOnError) model.cleanedUp = true
}

export function retryStepIsLegal(model: RetryModel, step: RetryStep): boolean {
  if (model.cleanedUp) return false
  if (step.kind === `decide`) return model.deciding !== undefined
  if (step.kind === `release`) return model.held
  // A failed or aborted Collection refuses new optimistic writes.
  if (model.failed !== undefined || model.aborted) return false
  if (step.kind === `hold`) return !model.held && !model.ready
  switch (step.kind) {
    case `demand`:
      return model.waits
    case `error`:
    case `client-give-up`:
      return model.deciding === undefined
    case `up-to-date`:
      return !model.ready && model.deciding === undefined
    case `abort`:
      return true
  }
}

// The ready snapshot's rows become visible; every waiting demand settles.
export function retryModelApply(model: RetryModel): void {
  model.visible = model.rows
  model.demands = model.demands.map((settlement): RetrySettlement =>
    settlement === `pending` ? `fulfilled` : settlement,
  )
}

// The model: what a source that still tries, or has given up, promises.
export function applyRetryModel(
  model: RetryModel,
  step: RetryStep,
  hasOnError: boolean,
  tag: string,
): void {
  switch (step.kind) {
    case `demand`:
      model.demands.push(
        model.visible
          ? `fulfilled`
          : model.failed !== undefined
            ? `rejected:${model.failed}`
            : `pending`,
      )
      return
    case `error`:
      if (!hasOnError || step.decision === `sync-give-up`) {
        retryModelFail(model, tag)
      } else if (step.decision === `throw`) {
        retryModelFail(model, `thrown-${tag}`)
      } else if (
        step.decision === `async-retry` ||
        step.decision === `async-give-up`
      ) {
        model.deciding = { decision: step.decision, cause: tag }
      }
      return
    case `decide`: {
      const deciding = model.deciding!
      model.deciding = undefined
      if (deciding.decision === `async-give-up` && !model.aborted) {
        retryModelFail(model, deciding.cause)
      }
      return
    }
    case `up-to-date`:
      model.ready = true
      if (!model.held || model.truncates) retryModelApply(model)
      return
    case `hold`:
      model.held = true
      return
    case `release`:
      model.held = false
      if (model.ready) retryModelApply(model)
      return
    case `client-give-up`:
      retryModelFail(model, tag)
      return
    case `abort`:
      // An external abort is a provider failure. Before the first ready it
      // fails the initial sync. After it, the snapshot has already arrived,
      // so a waiting demand still settles when its rows apply.
      if (!model.ready) retryModelFail(model, `StreamAbortedError`)
      model.aborted = true
      return
  }
}

export function expectedRetryObservation(
  model: RetryModel,
  cleanupRequested: boolean,
): RetryObservation {
  const cleanedUp = cleanupRequested || model.cleanedUp
  return {
    preload: cleanedUp
      ? undefined
      : model.failed !== undefined
        ? `rejected:${model.failed}`
        : model.ready
          ? `fulfilled`
          : `pending`,
    status: cleanedUp
      ? `cleaned-up`
      : model.failed !== undefined
        ? `error`
        : model.ready
          ? `ready`
          : `loading`,
    // Cleanup ends a waiting demand quietly, unless an earlier external
    // abort already failed the provider: then rows that never became
    // visible cannot fulfill it.
    demands: model.demands.map((settlement): RetrySettlement =>
      cleanedUp && settlement === `pending`
        ? model.aborted
          ? `rejected:AbortError`
          : `fulfilled`
        : settlement,
    ),
    rowVisible: !cleanedUp && model.visible,
  }
}

export function createRetryModel(
  wait: RetryWait | boolean,
  cleanupOnError = false,
): RetryModel {
  // The boolean form is the installed-client lane's full-log wait (`false`)
  // or a progressive wait (`true`).
  const resolved: RetryWait =
    typeof wait === `boolean` ? (wait ? `progressive` : `full-log`) : wait
  return {
    // A progressive history starts with a must-refetch, so its first
    // up-to-date commits a truncate, which core applies at once.
    truncates: resolved === `progressive`,
    waits: resolved === `full-log` || resolved === `progressive`,
    // A changes-only source delivers no snapshot rows.
    rows: resolved !== `changes-only`,
    cleanupOnError,
    cleanedUp: false,
    ready: false,
    visible: false,
    held: false,
    failed: undefined,
    aborted: false,
    deciding: undefined,
    demands: [],
  }
}

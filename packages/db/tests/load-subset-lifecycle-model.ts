/**
 * Component model for CoverageRegistry ownership and publication only.
 *
 * It deliberately does not model CollectionSubscription start/skip behavior,
 * session-owned continuations, adapter dedupe retention, transaction
 * visibility, or public query results. Full-flow histories exercise those
 * boundaries through real production objects.
 */
export type LoadSubsetLifecycleState =
  | `initial`
  | `provisional`
  | `active`
  | `applied`
  | `release-pending`
  | `failed`
  | `released`
  | `disposed`

export type LoadSubsetReleaseMode = `lease` | `dispose`

export type LoadSubsetLifecycleEvent =
  | { type: `startDemand` }
  | { type: `activateDemand` }
  | { type: `applyOutcome` }
  | { type: `failProvisional` }
  | { type: `publishStaleGeneration` }
  | { type: `requestRelease` }
  | { type: `retryPendingRelease` }
  | { type: `acceptPendingRelease` }
  | { type: `dispose` }
  | { type: `publishLateOutcome` }

export type LoadSubsetLifecycleModel = {
  state: LoadSubsetLifecycleState
  applied: boolean
  releaseAccepted: boolean
  releaseCalls: number
  releaseMode?: LoadSubsetReleaseMode
}

export function createLoadSubsetLifecycleModel(): LoadSubsetLifecycleModel {
  return {
    state: `initial`,
    applied: false,
    releaseAccepted: false,
    releaseCalls: 0,
  }
}

export function canApplyLoadSubsetLifecycleEvent(
  model: Readonly<LoadSubsetLifecycleModel>,
  event: LoadSubsetLifecycleEvent,
): boolean {
  switch (event.type) {
    case `startDemand`:
      return model.state === `initial`
    case `activateDemand`:
    case `failProvisional`:
      return model.state === `provisional`
    case `applyOutcome`:
    case `publishStaleGeneration`:
      return model.state === `active`
    case `requestRelease`:
      return model.state === `active` || model.state === `applied`
    case `retryPendingRelease`:
    case `acceptPendingRelease`:
      return model.state === `release-pending` && !model.releaseAccepted
    case `dispose`:
      return (
        model.state === `initial` ||
        model.state === `provisional` ||
        model.state === `active` ||
        model.state === `applied`
      )
    case `publishLateOutcome`:
      return model.state === `released` || model.state === `disposed`
  }
}

export function applyLoadSubsetLifecycleEvent(
  model: LoadSubsetLifecycleModel,
  event: LoadSubsetLifecycleEvent,
): void {
  if (!canApplyLoadSubsetLifecycleEvent(model, event)) {
    throw new Error(`Cannot apply ${event.type} while ${model.state}`)
  }

  switch (event.type) {
    case `startDemand`:
      model.state = `provisional`
      return
    case `activateDemand`:
      model.state = `active`
      return
    case `applyOutcome`:
      model.state = `applied`
      model.applied = true
      return
    case `failProvisional`:
      model.state = `failed`
      return
    case `publishStaleGeneration`:
    case `publishLateOutcome`:
      return
    case `requestRelease`:
      model.state = `release-pending`
      model.releaseMode = `lease`
      model.releaseCalls++
      return
    case `retryPendingRelease`:
      model.releaseCalls++
      return
    case `acceptPendingRelease`:
      model.releaseAccepted = true
      model.releaseCalls++
      model.state = model.releaseMode === `dispose` ? `disposed` : `released`
      return
    case `dispose`:
      if (model.state === `active` || model.state === `applied`) {
        model.state = `release-pending`
        model.releaseMode = `dispose`
        model.releaseCalls++
      } else {
        model.state = `disposed`
      }
  }
}

export function lifecycleOwnsAppliedRows(
  model: Readonly<LoadSubsetLifecycleModel>,
): boolean {
  return (
    model.applied &&
    model.state !== `released` &&
    model.state !== `disposed` &&
    model.state !== `failed`
  )
}

export function lifecyclePublishesCoverage(
  model: Readonly<LoadSubsetLifecycleModel>,
): boolean {
  return (
    lifecycleOwnsAppliedRows(model) &&
    (model.state === `applied` || model.state === `release-pending`)
  )
}

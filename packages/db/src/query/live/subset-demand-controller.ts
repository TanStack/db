import { inArray } from '../builder/functions.js'
import { PropRef } from '../ir.js'
import { createValueIdentity } from '../equality-value-identity.js'
import { codedMessage, devBuild } from '../../error-message.js'
import type { ValueIdentity } from '../equality-value-identity.js'
import type { CollectionSubscription } from '../../collection/subscription.js'
import type {
  LazyCollectionCallbacks,
  LazyDemandPlan,
} from '../compiler/joins.js'
import type { BasicExpression } from '../ir.js'
import type { LoadSubsetRequestResult } from '../../types.js'

type DemandSegment = {
  keys: Map<string, unknown>
  where: BasicExpression<boolean>
  abortController: AbortController
  ready: LoadSubsetRequestResult
  state: `starting` | `pending` | `settled` | `failed`
  // The load threw, so the subscription does not hold it, and a source
  // reload's replay does not load it again.
  thrown?: true
  replaces?: Array<DemandSegment>
}

type DemandState = {
  keys: Map<string, unknown>
  segments: Array<DemandSegment>
  // Needed keys whose latest load failed; the plan's request error clears
  // once none remains.
  failedKeys: Set<string>
}

export type DemandUpdate = {
  changed: boolean
  empty: boolean
  ready: Promise<Array<unknown>> | true
}

/**
 * Keeps lazy subset requests aligned with the current relation of demanded
 * keys. Growth loads only new keys. Churn replaces fragmented coverage after
 * the replacement applies, so prior coverage remains live in the meantime.
 */
export class SubsetDemandController {
  private readonly states = new Map<string, DemandState>()

  /** `onLoaded`: a load left the plan with no key whose latest load failed. */
  constructor(private readonly onLoaded?: (planId: string) => void) {}
  private readonly warnedPlans = new Set<string>()
  private valueIdentity = createValueIdentity()

  /**
   * A source reload's replay loaded every segment the subscription holds
   * again. Returns the plans that no longer miss a key.
   */
  settleReplay(): Array<string> {
    const loaded: Array<string> = []
    for (const [planId, state] of this.states) {
      for (const segment of state.segments)
        if (segment.state === `failed` && !segment.thrown)
          for (const key of segment.keys.keys()) state.failedKeys.delete(key)
      if (state.failedKeys.size === 0) loaded.push(planId)
    }
    return loaded
  }

  /** Whether the plan still needs a key whose latest load failed. */
  hasFailedKeys(planId: string): boolean {
    return (this.states.get(planId)?.failedKeys.size ?? 0) > 0
  }

  setDemand(
    subscription: CollectionSubscription,
    plan: LazyDemandPlan,
    keys: Set<unknown>,
  ): DemandUpdate {
    const nextKeys = canonicalizeKeys(keys, this.valueIdentity)
    const previous = this.states.get(plan.id)
    const hasFailedCoverage = previous?.segments.some(
      (segment) =>
        segment.state === `failed` && intersects(segment.keys, nextKeys),
    )
    if (
      previous &&
      equalKeySets(previous.keys, nextKeys) &&
      !hasFailedCoverage
    ) {
      return { changed: false, empty: nextKeys.size === 0, ready: true }
    }

    const segments = (previous?.segments ?? []).filter(
      (segment) =>
        segment.state !== `failed` &&
        intersects(segment.keys, nextKeys) &&
        (!segment.replaces || equalKeySets(segment.keys, nextKeys)),
    )
    const retired = (previous?.segments ?? []).filter(
      (segment) => !segments.includes(segment),
    )
    const retryReplacement = previous?.segments.some(
      (segment) =>
        segment.replaces &&
        segment.state === `failed` &&
        equalKeySets(segment.keys, nextKeys),
    )
    const state: DemandState = {
      keys: nextKeys,
      segments,
      failedKeys: new Set(
        [...(previous?.failedKeys ?? [])].filter((key) => nextKeys.has(key)),
      ),
    }
    this.states.set(plan.id, state)

    // A failed segment is released first, so a replay judged during this
    // change does not fail for the demand the change requests again.
    retired.sort(
      (a, b) => Number(b.state === `failed`) - Number(a.state === `failed`),
    )
    for (const segment of retired) releaseSegment(subscription, segment)
    if (this.states.get(plan.id) !== state) {
      return { changed: false, empty: false, ready: true }
    }

    if (nextKeys.size === 0) {
      this.states.delete(plan.id)
      return { changed: true, empty: true, ready: true }
    }

    const coveredKeys = new Set(
      segments.flatMap((segment) => [...segment.keys.keys()]),
    )
    const added = new Map(
      [...nextKeys].filter(([key]) => !coveredKeys.has(key)),
    )
    const removed = previous
      ? [...previous.keys.keys()].some((key) => !nextKeys.has(key))
      : false
    const replace =
      retryReplacement || (removed && (added.size > 0 || segments.length > 1))
    const requestedKeys = replace ? nextKeys : added
    // A replacement alone decides the demand: the segments it supersedes are
    // released, and aborted, once it settles.
    let replacement: DemandSegment | undefined
    if (requestedKeys.size > 0) {
      const segment = createSegment(plan, requestedKeys)
      if (replace) {
        segment.replaces = [...segments]
        replacement = segment
      }
      segments.push(segment)
      let started: boolean
      try {
        started = startSegment(
          subscription,
          segment,
          () => this.warnUnoptimized(plan),
          (succeeded) => this.recordOutcome(plan.id, segment, succeeded),
        )
      } catch (error) {
        // A load that throws failed its keys, as one that rejects does.
        segment.state = `failed`
        segment.thrown = true
        this.recordOutcome(plan.id, segment, false)
        throw error
      }
      if (this.states.get(plan.id) !== state) {
        return { changed: false, empty: false, ready: true }
      }
      if (!started)
        throw new Error(
          devBuild() && process.env.NODE_ENV !== `production`
            ? `Subset demand snapshot did not start`
            : codedMessage(159),
        )
      if (replace) {
        if (segment.ready instanceof Promise) {
          void segment.ready.then(
            () => this.finishReplacement(subscription, plan.id, segment),
            () => {},
          )
        } else {
          this.finishReplacement(subscription, plan.id, segment)
        }
      }
    }

    const pending = (replacement ? [replacement] : state.segments)
      .filter(
        (segment) =>
          segment.state === `pending` && intersects(segment.keys, nextKeys),
      )
      .map((segment) => segment.ready)
      .filter((ready): ready is Promise<void> => ready instanceof Promise)
    return {
      changed: true,
      empty: false,
      ready: pending.length > 0 ? Promise.all(pending) : true,
    }
  }

  // The outcome of a segment the plan still holds decides its keys: a
  // success loaded them, and a failure leaves the needed ones missing. A
  // released segment's late outcome decides nothing.
  private recordOutcome(
    planId: string,
    segment: DemandSegment,
    succeeded: boolean,
  ): void {
    const state = this.states.get(planId)
    if (!state?.segments.includes(segment)) return
    for (const key of segment.keys.keys()) {
      if (succeeded) state.failedKeys.delete(key)
      else if (state.keys.has(key)) state.failedKeys.add(key)
    }
    if (succeeded && state.failedKeys.size === 0) this.onLoaded?.(planId)
  }

  clear(): void {
    for (const state of this.states.values()) {
      for (const segment of state.segments) segment.abortController.abort()
    }
    this.states.clear()
    this.warnedPlans.clear()
    this.valueIdentity = createValueIdentity()
  }

  hasPendingDemand(planId: string): boolean {
    return (
      this.states
        .get(planId)
        ?.segments.some((segment) => segment.state === `pending`) ?? false
    )
  }

  private finishReplacement(
    subscription: CollectionSubscription,
    planId: string,
    replacement: DemandSegment,
  ): void {
    const state = this.states.get(planId)
    if (
      !state?.segments.includes(replacement) ||
      !equalKeySets(replacement.keys, state.keys)
    ) {
      releaseSegment(subscription, replacement)
      return
    }
    const replaced = replacement.replaces ?? []
    replacement.replaces = undefined
    state.segments = [replacement]
    for (const segment of replaced) releaseSegment(subscription, segment)
  }

  private warnUnoptimized(plan: LazyDemandPlan): void {
    if (!(devBuild() && process.env.NODE_ENV !== `production`)) return
    if (this.warnedPlans.has(plan.id)) return
    this.warnedPlans.add(plan.id)
    const path = plan.path.join(`.`)
    console.warn(
      `[TanStack DB]${plan.collectionId ? ` [${plan.collectionId}]` : ``} Join requires an index on "${path}" for efficient loading. ` +
        `Falling back to scanning local data. ` +
        `Consider creating an index on the collection with collection.createIndex((row) => row.${path}) ` +
        `or enable auto-indexing with autoIndex: 'eager' and a defaultIndexType.`,
    )
  }
}

/** An ordered filter waits only for demand on its joined source. */
export function hasPendingJoinedWork(
  joinedSourceId: string,
  lazySourcesCallbacks: Record<string, LazyCollectionCallbacks>,
  subscriptions: Record<string, CollectionSubscription>,
  isPendingPlan: (planId: string) => boolean,
): boolean {
  return (
    (lazySourcesCallbacks[joinedSourceId]?.plans?.some((plan) =>
      isPendingPlan(plan.id),
    ) ??
      false) ||
    subscriptions[joinedSourceId]?.status === `loadingSubset`
  )
}

function canonicalizeKeys(
  keys: Set<unknown>,
  valueIdentity: ValueIdentity,
): Map<string, unknown> {
  return new Map(
    [...keys].map((key) => [valueIdentity.serializeEquality(key), key]),
  )
}

function equalKeySets(
  left: Map<string, unknown>,
  right: Map<string, unknown>,
): boolean {
  return (
    left.size === right.size && [...left.keys()].every((key) => right.has(key))
  )
}

function intersects(
  left: Map<string, unknown>,
  right: Map<string, unknown>,
): boolean {
  return [...left.keys()].some((key) => right.has(key))
}

function createSegment(
  plan: LazyDemandPlan,
  keys: Map<string, unknown>,
): DemandSegment {
  const where = inArray(new PropRef(plan.path), [...keys.values()])
  return {
    keys,
    where,
    abortController: new AbortController(),
    ready: true,
    state: `starting`,
  }
}

function startSegment(
  subscription: CollectionSubscription,
  segment: DemandSegment,
  onUnoptimized: () => void,
  onOutcome: (succeeded: boolean) => void,
): boolean {
  let observed = false
  const requested = subscription.requestSnapshot({
    where: segment.where,
    signal: segment.abortController.signal,
    trackLoadSubsetPromise: false,
    onUnoptimized,
    onLoadSubsetResult: (result) => {
      observed = true
      segment.ready =
        result instanceof Promise ? followReplay(subscription, result) : result
      segment.state = result instanceof Promise ? `pending` : `settled`
    },
  })
  if (segment.ready instanceof Promise) {
    void segment.ready.then(
      () => {
        segment.state = `settled`
        onOutcome(true)
      },
      () => {
        segment.state = `failed`
        onOutcome(false)
      },
    )
  }
  return requested && observed
}

// A truncate's or a reload's replay replaces a load that it aborts: the replay
// decides it, and its own late failure decides nothing. A load that fails
// while the replay is in flight fails with its own error once the replay
// settles.
function followReplay(
  subscription: CollectionSubscription,
  ready: Promise<unknown>,
): Promise<void> {
  const replacements = subscription.replacementCount
  const decide = (error: unknown): Promise<void> | undefined => {
    const replay = subscription.pendingTruncateReplacement
    if (replacements !== subscription.replacementCount)
      return replay && followReplay(subscription, replay)
    if (!replay) throw error
    // The load joined the replay: its own failure stands once the replay
    // settles, unless a newer replay replaced it meanwhile.
    return replay.then(
      () => decide(error),
      () => decide(error),
    )
  }
  return ready.then(undefined, decide)
}

function releaseSegment(
  subscription: CollectionSubscription,
  segment: DemandSegment,
): void {
  segment.abortController.abort()
  try {
    subscription.releaseSnapshot(segment.where)
  } catch {
    // CollectionSubscription has already reported the one cleanup failure.
  }
}

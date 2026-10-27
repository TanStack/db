import { inArray } from '../builder/functions.js'
import { PropRef } from '../ir.js'
import { createValueIdentity } from '../equality-value-identity.js'
import { codedMessage, devBuild } from '../../error-message.js'
import { normalizeError } from '../../utils/error.js'
import type { ValueIdentity } from '../equality-value-identity.js'
import type { CollectionSubscription } from '../../collection/subscription.js'
import type {
  LazyCollectionCallbacks,
  LazyDemandPlan,
} from '../compiler/joins.js'
import type { BasicExpression } from '../ir.js'

type DemandSegment = {
  keys: Map<string, unknown>
  where: BasicExpression<boolean>
  abortController: AbortController
  // Resolves `true` when a failed replay decided the load (see followReplay).
  ready: true | Promise<boolean | undefined>
  state: `starting` | `pending` | `settled` | `failed`
  // The load threw, so the subscription does not hold it, and a source
  // reload's replay does not load it again. A replay that starts later drops
  // it (see startReplay).
  thrown?: true
  replaces?: Array<DemandSegment>
}

type DemandState = {
  keys: Map<string, unknown>
  segments: Array<DemandSegment>
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

  /**
   * `onKeyOutcome`: the latest load of a key the plan needs failed with
   * `error`; without one, a load of the key succeeded or the plan no longer
   * needs it. A request error belongs to the key's failed request.
   */
  constructor(
    private readonly onKeyOutcome?: (
      planId: string,
      key: string,
      error?: Error,
    ) => void,
  ) {}
  private readonly warnedPlans = new Set<string>()
  private valueIdentity = createValueIdentity()

  /**
   * A truncate's or a reload's replay starts. A load that threw before it
   * decides nothing more: the replay loads its keys again through the loads
   * the subscription still holds.
   */
  startReplay(): void {
    for (const state of this.states.values())
      state.segments = state.segments.filter((segment) => !segment.thrown)
  }

  /** A source reload's replay loaded every segment the subscription holds again. */
  settleReplay(): void {
    for (const [planId, state] of this.states) {
      // Every segment the subscription holds was loaded again, also one whose
      // own retry is still pending. A load that threw during the replay holds
      // no demand, and as the latest load of its keys it still decides them
      // (law 10).
      const thrown = new Set(
        state.segments.flatMap((segment) =>
          segment.thrown ? [...segment.keys.keys()] : [],
        ),
      )
      for (const segment of state.segments)
        for (const key of segment.keys.keys())
          if (!thrown.has(key)) this.onKeyOutcome?.(planId, key)
    }
  }

  /**
   * A replay failed. It decides every load it replaced (law 16): such a load
   * is still pending, also one that an adapter which ignores its abort still
   * serves, and its keys take the replay's failure, which the replay's own
   * request error shows, so their earlier failures go now. That load's own
   * late outcome then decides nothing (see followReplay). Every load that
   * joined the replay settled before its verdict.
   */
  failReplay(): void {
    for (const [planId, state] of this.states)
      for (const segment of state.segments)
        if (segment.state === `pending`)
          this.recordOutcome(planId, segment, undefined, true)
  }

  /** Whether any plan still holds demand. */
  holdsDemand(): boolean {
    return this.states.size > 0
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
    const state: DemandState = { keys: nextKeys, segments }
    this.states.set(plan.id, state)
    // A key the plan no longer needs shows no request error.
    for (const key of previous?.keys.keys() ?? [])
      if (!nextKeys.has(key)) this.onKeyOutcome?.(plan.id, key)

    // Law 9: a demand change is one step. Start its new demand before it
    // releases the retired segments, and release them together, so an open
    // replay keeps the new demand and is judged once, after the whole change.
    const release = () => releaseSegments(subscription, retired)

    if (nextKeys.size === 0) {
      this.states.delete(plan.id)
      release()
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
    try {
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
            (error) => this.recordOutcome(plan.id, segment, error),
          )
        } catch (error) {
          // A load that throws failed its keys, as one that rejects does.
          segment.state = `failed`
          segment.thrown = true
          this.recordOutcome(plan.id, segment, normalizeError(error))
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
          subscription.replaceSnapshots(
            segment.where,
            (segment.replaces ?? []).map((replaced) => replaced.where),
          )
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
    } finally {
      release()
    }
    if (this.states.get(plan.id) !== state) {
      return { changed: false, empty: false, ready: true }
    }

    const pending = (replacement ? [replacement] : state.segments)
      .filter(
        (segment) =>
          segment.state === `pending` && intersects(segment.keys, nextKeys),
      )
      .map((segment) => segment.ready)
      .filter((ready) => ready instanceof Promise)
    return {
      changed: true,
      empty: false,
      ready: pending.length > 0 ? Promise.all(pending) : true,
    }
  }

  // The outcome of a segment the plan still holds decides its needed keys: a
  // success (no `error`) loaded them, and a failure leaves them missing,
  // unless a later segment loads the key (law 10: a key's latest load
  // decides it). A released segment's late outcome decides nothing. A
  // failure that a failed replay shows (`failed` without `error`) leaves the
  // key no error of its own.
  private recordOutcome(
    planId: string,
    segment: DemandSegment,
    error?: Error,
    failed = error !== undefined,
  ): void {
    const state = this.states.get(planId)
    if (!state?.segments.includes(segment)) return
    const later = state.segments.slice(state.segments.indexOf(segment) + 1)
    for (const key of segment.keys.keys())
      if (
        state.keys.has(key) &&
        !(failed && later.some((loader) => loader.keys.has(key)))
      )
        this.onKeyOutcome?.(planId, key, error)
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
      releaseSegments(subscription, [replacement])
      return
    }
    const replaced = replacement.replaces ?? []
    replacement.replaces = undefined
    state.segments = [replacement]
    releaseSegments(subscription, replaced)
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
  onOutcome: (error?: Error) => void,
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
      (decidedByFailedReplay) => {
        segment.state = `settled`
        if (!decidedByFailedReplay) onOutcome()
      },
      (error: unknown) => {
        segment.state = `failed`
        onOutcome(normalizeError(error))
      },
    )
  }
  return requested && observed
}

// A truncate's or a reload's replay replaces a load that it aborts: the replay
// decides it, and the load's own late outcome decides nothing, also after the
// replay failed (resolves `true`). A load that joins a replay in flight and
// fails before it settles fails with its own error once the replay settles,
// in failure order.
function followReplay(
  subscription: CollectionSubscription,
  ready: Promise<unknown>,
): Promise<boolean | undefined> {
  const replacements = subscription.replacementCount
  // The replay this load joins, read when it starts: the load whose failure
  // settles the replay still waits for it, after the loads that failed first.
  const joined = subscription.pendingTruncateReplacement
  // The replay decides the load: its failure resolves `true`, as the
  // controller applied it at the verdict, unless a newer replay replaced it.
  const replaced = (): Promise<boolean | undefined> | boolean => {
    const replay = subscription.pendingTruncateReplacement
    if (!replay) return subscription.hasFailedTruncateReplacement
    const count = subscription.replacementCount
    return replay.then(
      () => undefined,
      () => count === subscription.replacementCount || replaced(),
    )
  }
  const decide = (
    error: unknown,
    waited?: boolean,
  ): Promise<boolean | undefined> | boolean => {
    if (replacements !== subscription.replacementCount) return replaced()
    if (waited || !joined) throw error
    // Its own failure stands once the replay settles, unless a newer replay
    // replaced it meanwhile.
    const again = () => decide(error, true)
    return joined.then(again, again)
  }
  return ready.then(
    () =>
      replacements === subscription.replacementCount ? undefined : replaced(),
    decide,
  )
}

// One demand change: the subscription releases every segment even if
// subscriber code that a release runs throws, then reports the first error.
function releaseSegments(
  subscription: CollectionSubscription,
  segments: Array<DemandSegment>,
): void {
  if (segments.length === 0) return
  for (const segment of segments) segment.abortController.abort()
  subscription.releaseSnapshot(...segments.map((segment) => segment.where))
}

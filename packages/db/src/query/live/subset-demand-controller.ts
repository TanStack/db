import { inArray } from '../builder/functions.js'
import { PropRef } from '../ir.js'
import { createValueIdentity } from '../equality-value-identity.js'
import type { ValueIdentity } from '../equality-value-identity.js'
import type { CollectionSubscription } from '../../collection/subscription.js'
import type { LazyDemandPlan } from '../compiler/joins.js'
import type { BasicExpression } from '../ir.js'
import type { LoadSubsetRequestResult } from '../../types.js'

type DemandSegment = {
  keys: Map<string, unknown>
  where: BasicExpression<boolean>
  abortController: AbortController
  ready: LoadSubsetRequestResult
  state: `starting` | `pending` | `settled` | `failed`
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
  private readonly warnedPlans = new Set<string>()
  private valueIdentity = createValueIdentity()

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
    if (requestedKeys.size > 0) {
      const segment = createSegment(plan, requestedKeys)
      if (replace) segment.replaces = [...segments]
      segments.push(segment)
      if (
        !startSegment(subscription, segment, () => this.warnUnoptimized(plan))
      ) {
        segment.state = `failed`
      } else if (replace) {
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

    if (this.states.get(plan.id) !== state) {
      return { changed: false, empty: false, ready: true }
    }
    const pending = state.segments
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

  clear(): void {
    for (const state of this.states.values()) {
      for (const segment of state.segments) segment.abortController.abort()
    }
    this.states.clear()
    this.warnedPlans.clear()
    this.valueIdentity = createValueIdentity()
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
): boolean {
  let observed = false
  const requested = subscription.requestSnapshot({
    where: segment.where,
    signal: segment.abortController.signal,
    trackLoadSubsetPromise: false,
    onUnoptimized,
    onLoadSubsetResult: (result) => {
      observed = true
      segment.ready = result
      segment.state = result instanceof Promise ? `pending` : `settled`
    },
  })
  if (!requested) segment.state = `failed`
  if (segment.ready instanceof Promise) {
    void segment.ready.then(
      () => {
        segment.state = `settled`
      },
      () => {
        segment.state = `failed`
      },
    )
  }
  return observed
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

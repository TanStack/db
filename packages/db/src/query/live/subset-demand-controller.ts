import { inArray } from '../builder/functions.js'
import { PropRef } from '../ir.js'
import { createValueIdentity } from '../equality-value-identity.js'
import { createDeferred } from '../../deferred.js'
import type { ValueIdentity } from '../equality-value-identity.js'
import type {
  CollectionSubscription,
  ReleaseLoadSubset,
} from '../../collection/subscription.js'
import type { Deferred } from '../../deferred.js'
import type { LazyDemandPlan } from '../compiler/joins.js'
import type { BasicExpression } from '../ir.js'
import type { LoadSubsetRequestResult } from '../../types.js'

type DemandAcquisition = {
  generation: number
  keys: Map<string, unknown>
  abortController: AbortController
  release: ReleaseLoadSubset
}

type DemandState = {
  subscription: CollectionSubscription
  plan: LazyDemandPlan
  keys: Map<string, unknown>
  established?: DemandAcquisition
  pendingReplacement?: DemandAcquisition
  generation: number
  waiter?: { deferred: Deferred<void>; generation: number }
}

export type DemandUpdate = {
  changed: boolean
  empty: boolean
  ready: Promise<void> | true
}

/**
 * Keeps lazy subset requests aligned with the current relation of demanded
 * keys. Expansion acquires one complete replacement in the background. The
 * established acquisitions remain live until that replacement has applied;
 * then they are released. A failed or obsolete replacement never retires the
 * established coverage.
 */
export class SubsetDemandController {
  private readonly states = new Map<string, DemandState>()
  private readonly warnedPlans = new Set<string>()
  private valueIdentity = createValueIdentity()
  private clearing = false

  setDemand(
    subscription: CollectionSubscription,
    plan: LazyDemandPlan,
    keys: Set<unknown>,
  ): DemandUpdate {
    if (this.clearing) {
      return { changed: false, empty: keys.size === 0, ready: true }
    }

    const nextKeys = canonicalizeKeys(keys, this.valueIdentity)
    let state = this.states.get(plan.id)
    if (
      state &&
      equalKeySets(state.keys, nextKeys) &&
      (acquisitionCovers(state.established, nextKeys) ||
        equalKeySets(state.pendingReplacement?.keys, nextKeys))
    ) {
      return { changed: false, empty: nextKeys.size === 0, ready: true }
    }

    if (!state) {
      state = {
        subscription,
        plan,
        keys: nextKeys,
        generation: 0,
      }
      this.states.set(plan.id, state)
    }

    settleWaiter(state)
    state.subscription = subscription
    state.plan = plan
    state.keys = nextKeys
    state.generation += 1
    const generation = state.generation
    if (
      state.pendingReplacement &&
      !equalKeySets(state.pendingReplacement.keys, nextKeys)
    ) {
      state.pendingReplacement.abortController.abort()
    }

    const retired =
      state.established && !intersects(state.established.keys, nextKeys)
        ? state.established
        : undefined
    if (retired) state.established = undefined
    if (retired) {
      releaseAcquisition(retired)
      if (
        this.states.get(plan.id) !== state ||
        state.generation !== generation
      ) {
        return { changed: false, empty: false, ready: true }
      }
    }

    if (nextKeys.size === 0) {
      const pendingReplacement = state.pendingReplacement
      const established = state.established
      state.pendingReplacement = undefined
      state.established = undefined
      this.states.delete(plan.id)
      if (pendingReplacement) releaseAcquisition(pendingReplacement)
      if (established) releaseAcquisition(established)
      // Release callbacks may synchronously install newer demand. Do not let
      // this obsolete empty turn retire it in CollectionSubscriber.
      if (this.states.has(plan.id)) {
        return { changed: false, empty: false, ready: true }
      }
      return { changed: true, empty: true, ready: true }
    }

    if (acquisitionCovers(state.established, nextKeys)) {
      return { changed: true, empty: false, ready: true }
    }

    const deferred = createDeferred<void>()
    state.waiter = { deferred, generation }
    this.advance(state)
    if (this.states.get(plan.id) !== state || state.generation !== generation) {
      return { changed: false, empty: false, ready: true }
    }
    return {
      changed: true,
      empty: false,
      ready: deferred.isPending() ? deferred.promise : true,
    }
  }

  clear(): void {
    this.clearing = true
    const states = [...this.states.values()]
    this.states.clear()
    try {
      for (const state of states) {
        const pendingReplacement = state.pendingReplacement
        const established = state.established
        state.pendingReplacement = undefined
        state.established = undefined
        settleWaiter(state)
        if (pendingReplacement) releaseAcquisition(pendingReplacement)
        if (established) releaseAcquisition(established)
      }
    } finally {
      this.clearing = false
    }
    this.warnedPlans.clear()
    this.valueIdentity = createValueIdentity()
  }

  private advance(state: DemandState): void {
    if (this.states.get(state.plan.id) !== state) return
    if (acquisitionCovers(state.established, state.keys)) {
      settleWaiter(state, state.generation)
      return
    }
    if (state.pendingReplacement) return

    const replacement = createAcquisition(state.keys, state.generation)
    state.pendingReplacement = replacement
    let result: LoadSubsetRequestResult
    try {
      result = startAcquisition(
        state.subscription,
        state.plan,
        replacement,
        () => this.warnUnoptimized(state.plan),
      )
    } catch (error) {
      if (state.pendingReplacement === replacement) {
        state.pendingReplacement = undefined
      }
      // The synchronous throw is the caller's error channel. Do not also leave
      // a rejected promise that nobody received.
      settleWaiter(state, replacement.generation)
      releaseAcquisition(replacement)
      throw error
    }

    if (result instanceof Promise) {
      void result.then(
        () => this.finishReplacement(state, replacement),
        (error: unknown) => this.failReplacement(state, replacement, error),
      )
      return
    }

    this.finishReplacement(state, replacement)
  }

  private finishReplacement(
    state: DemandState,
    replacement: DemandAcquisition,
  ): void {
    const active =
      this.states.get(state.plan.id) === state &&
      state.pendingReplacement === replacement
    if (!active) {
      releaseAcquisition(replacement)
      settleWaiter(state, replacement.generation)
      return
    }

    state.pendingReplacement = undefined
    const isCurrent =
      replacement.generation === state.generation &&
      equalKeySets(replacement.keys, state.keys)
    settleWaiter(state, replacement.generation)
    if (!isCurrent) {
      releaseAcquisition(replacement)
      this.advance(state)
      return
    }

    const replaced = state.established
    state.established = replacement
    if (replaced) releaseAcquisition(replaced)
  }

  private failReplacement(
    state: DemandState,
    replacement: DemandAcquisition,
    error: unknown,
  ): void {
    const active =
      this.states.get(state.plan.id) === state &&
      state.pendingReplacement === replacement
    const isCurrent =
      active &&
      replacement.generation === state.generation &&
      equalKeySets(replacement.keys, state.keys)
    if (active) state.pendingReplacement = undefined
    if (isCurrent) {
      rejectWaiter(state, replacement.generation, error)
    } else {
      settleWaiter(state, replacement.generation)
    }
    releaseAcquisition(replacement, isCurrent ? { error } : undefined)
    if (!active) {
      return
    }

    if (isCurrent) return

    // A superseded failure belongs only to its old generation. The newest
    // demand waits for a fresh union replacement.
    this.advance(state)
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
  left: Map<string, unknown> | undefined,
  right: Map<string, unknown>,
): boolean {
  if (!left) return false
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

function acquisitionCovers(
  acquisition: DemandAcquisition | undefined,
  keys: Map<string, unknown>,
): boolean {
  if (keys.size === 0) return true
  if (!acquisition) return false
  return [...keys.keys()].every((key) => acquisition.keys.has(key))
}

function settleWaiter(state: DemandState, generation?: number): void {
  const waiter = state.waiter
  if (
    !waiter ||
    (generation !== undefined && waiter.generation !== generation)
  ) {
    return
  }
  state.waiter = undefined
  waiter.deferred.resolve(undefined)
}

function rejectWaiter(
  state: DemandState,
  generation: number,
  error: unknown,
): void {
  const waiter = state.waiter
  if (!waiter || waiter.generation !== generation) return
  state.waiter = undefined
  waiter.deferred.reject(error)
}

function createAcquisition(
  keys: Map<string, unknown>,
  generation: number,
): DemandAcquisition {
  return {
    generation,
    keys: new Map(keys),
    abortController: new AbortController(),
    release: () => {},
  }
}

function startAcquisition(
  subscription: CollectionSubscription,
  plan: LazyDemandPlan,
  acquisition: DemandAcquisition,
  onUnoptimized: () => void,
): LoadSubsetRequestResult {
  const where: BasicExpression<boolean> = inArray(new PropRef(plan.path), [
    ...acquisition.keys.values(),
  ])
  let result: LoadSubsetRequestResult = true
  subscription.requestSnapshot({
    where,
    signal: acquisition.abortController.signal,
    trackLoadSubsetPromise: false,
    onUnoptimized,
    onLoadSubsetResult: (observedResult, _options, release) => {
      result = observedResult
      acquisition.release = release
    },
  })
  return result
}

function releaseAcquisition(
  acquisition: DemandAcquisition,
  primaryFailure?: { error: unknown },
): void {
  acquisition.abortController.abort()
  try {
    acquisition.release(primaryFailure)
  } catch {
    // CollectionSubscription reports adapter cleanup failures after its one
    // release attempt. Demand changes must still reach the graph; adapters own
    // any remote retry.
  }
}

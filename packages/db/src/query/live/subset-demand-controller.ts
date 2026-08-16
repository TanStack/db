import { serializeValue } from '@tanstack/db-ivm'
import { inArray } from '../builder/functions.js'
import { PropRef } from '../ir.js'
import type { CollectionSubscription } from '../../collection/subscription.js'
import type { LazyDemandPlan } from '../compiler/joins.js'
import type { BasicExpression } from '../ir.js'

type DemandSegment = {
  keys: Map<string, unknown>
  where: BasicExpression<boolean>
  abortController: AbortController
}

type DemandState = {
  keys: Map<string, unknown>
  segments: Array<DemandSegment>
}

export type DemandUpdate = {
  changed: boolean
  empty: boolean
  loadResults: Array<Promise<void> | true>
}

/**
 * Keeps lazy subset requests aligned with the current relation of demanded
 * keys. Additions load only new coverage. Removals release and rebuild only
 * request segments that covered a removed key.
 */
export class SubsetDemandController {
  private readonly states = new Map<string, DemandState>()

  setDemand(
    subscription: CollectionSubscription,
    plan: LazyDemandPlan,
    keys: Set<unknown>,
  ): DemandUpdate {
    const nextKeys = canonicalizeKeys(keys)
    const previous = this.states.get(plan.id)
    if (previous && equalKeySets(previous.keys, nextKeys)) {
      return { changed: false, empty: nextKeys.size === 0, loadResults: [] }
    }

    const loadResults: Array<Promise<void> | true> = []
    const segments: Array<DemandSegment> = []

    for (const segment of previous?.segments ?? []) {
      if ([...segment.keys.keys()].every((key) => nextKeys.has(key))) {
        segments.push(segment)
        continue
      }

      const retained = new Map(
        [...segment.keys].filter(([key]) => nextKeys.has(key)),
      )
      if (retained.size > 0) {
        segments.push(requestSegment(subscription, plan, retained, loadResults))
      }
      segment.abortController.abort()
      subscription.releaseSnapshot(segment.where)
    }

    const added = new Map(
      [...nextKeys].filter(([key]) => !previous?.keys.has(key)),
    )
    if (added.size > 0) {
      segments.push(requestSegment(subscription, plan, added, loadResults))
    }

    if (nextKeys.size === 0) {
      this.states.delete(plan.id)
    } else {
      this.states.set(plan.id, { keys: nextKeys, segments })
    }

    return { changed: true, empty: nextKeys.size === 0, loadResults }
  }

  clear(): void {
    for (const state of this.states.values()) {
      for (const segment of state.segments) segment.abortController.abort()
    }
    this.states.clear()
  }
}

function canonicalizeKeys(keys: Set<unknown>): Map<string, unknown> {
  return new Map([...keys].map((key) => [serializeValue(key), key]))
}

function equalKeySets(
  left: Map<string, unknown>,
  right: Map<string, unknown>,
): boolean {
  return (
    left.size === right.size && [...left.keys()].every((key) => right.has(key))
  )
}

function requestSegment(
  subscription: CollectionSubscription,
  plan: LazyDemandPlan,
  keys: Map<string, unknown>,
  loadResults: Array<Promise<void> | true>,
): DemandSegment {
  const where = inArray(new PropRef(plan.path), [...keys.values()])
  const abortController = new AbortController()
  subscription.requestSnapshot({
    where,
    signal: abortController.signal,
    trackLoadSubsetPromise: false,
    onLoadSubsetResult: (result) => loadResults.push(result),
  })
  return { keys, where, abortController }
}

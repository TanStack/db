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
  ready: Promise<void> | true
  state: `pending` | `settled` | `failed`
}

type DemandState = {
  keys: Map<string, unknown>
  segments: Array<DemandSegment>
}

export type DemandUpdate = {
  changed: boolean
  empty: boolean
  ready: Promise<void> | true
}

/**
 * Keeps lazy subset requests aligned with the current relation of demanded
 * keys. Additions load only new coverage. Removals release and rebuild only
 * request segments that covered a removed key.
 */
export class SubsetDemandController {
  private readonly states = new Map<string, DemandState>()
  private readonly warnedPlans = new Set<string>()

  setDemand(
    subscription: CollectionSubscription,
    plan: LazyDemandPlan,
    keys: Set<unknown>,
  ): DemandUpdate {
    const nextKeys = canonicalizeKeys(keys)
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

    const segments: Array<DemandSegment> = []

    for (const segment of previous?.segments ?? []) {
      if (segment.state !== `failed` && intersects(segment.keys, nextKeys)) {
        segments.push(segment)
        continue
      }

      segment.abortController.abort()
      subscription.releaseSnapshot(segment.where)
    }

    const coveredKeys = new Set(
      segments.flatMap((segment) => [...segment.keys.keys()]),
    )
    const added = new Map(
      [...nextKeys].filter(([key]) => !coveredKeys.has(key)),
    )
    if (added.size > 0) {
      segments.push(
        requestSegment(subscription, plan, added, () =>
          this.warnUnoptimized(plan),
        ),
      )
    }

    if (nextKeys.size === 0) {
      this.states.delete(plan.id)
    } else {
      this.states.set(plan.id, { keys: nextKeys, segments })
    }

    const activeSegments = segments.filter((segment) =>
      intersects(segment.keys, nextKeys),
    )
    const pending = activeSegments
      .map((segment) => segment.ready)
      .filter((ready): ready is Promise<void> => ready instanceof Promise)
    return {
      changed: true,
      empty: nextKeys.size === 0,
      ready:
        pending.length > 0 ? Promise.all(pending).then(() => undefined) : true,
    }
  }

  clear(): void {
    for (const state of this.states.values()) {
      for (const segment of state.segments) segment.abortController.abort()
    }
    this.states.clear()
    this.warnedPlans.clear()
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

function intersects(
  left: Map<string, unknown>,
  right: Map<string, unknown>,
): boolean {
  return [...left.keys()].some((key) => right.has(key))
}

function requestSegment(
  subscription: CollectionSubscription,
  plan: LazyDemandPlan,
  keys: Map<string, unknown>,
  onUnoptimized: () => void,
): DemandSegment {
  const where = inArray(new PropRef(plan.path), [...keys.values()])
  const abortController = new AbortController()
  const load = { ready: true as Promise<void> | true }
  subscription.requestSnapshot({
    where,
    signal: abortController.signal,
    trackLoadSubsetPromise: false,
    onUnoptimized,
    onLoadSubsetResult: (result) => {
      load.ready = result
    },
  })
  const ready = load.ready
  const segment: DemandSegment = {
    keys,
    where,
    abortController,
    ready,
    state: ready instanceof Promise ? `pending` : `settled`,
  }
  if (ready instanceof Promise) {
    void ready.then(
      () => {
        segment.state = `settled`
      },
      () => {
        segment.state = `failed`
      },
    )
  }
  return segment
}

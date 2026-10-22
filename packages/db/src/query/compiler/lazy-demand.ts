import type { Collection } from '../../collection/index.js'

export type LazyDemandPlan = {
  id: string
  path: Array<string>
  collectionId: string
  initialKeys: Set<unknown>
}

/** Callbacks for managing lazy-loaded collections in optimized joins */
export type LazyCollectionCallbacks = {
  plans?: Array<LazyDemandPlan>
  setDemand?: (plan: LazyDemandPlan, keys: Set<unknown>) => void
}

let nextLazyDemandPlanId = 0

export function registerLazyDemandPlan(
  callbacks: Record<string, LazyCollectionCallbacks>,
  target: { sourceId: string; path: Array<string>; collection: Collection },
  initialKeys: Set<unknown> = new Set(),
): LazyDemandPlan {
  const plan: LazyDemandPlan = {
    id: `lazy-demand-${++nextLazyDemandPlanId}`,
    path: target.path,
    collectionId: target.collection.id,
    initialKeys: new Set(initialKeys),
  }
  const state = (callbacks[target.sourceId] ??= {})
  ;(state.plans ??= []).push(plan)
  return plan
}

import type {
  AppliedLoadSubsetOutcome,
  LoadSubsetOptions,
  LoadSubsetResult,
} from '../types.js'

const loadSubsetPromiseDemandMatchers = new WeakMap<
  Promise<unknown>,
  (options: LoadSubsetOptions) => boolean
>()

export function recordLoadSubsetPromiseDemandMatcher(
  promise: Promise<unknown>,
  matches: (options: LoadSubsetOptions) => boolean,
): void {
  loadSubsetPromiseDemandMatchers.set(promise, matches)
}

export function isLoadSubsetPromiseForDemand(
  promise: Promise<unknown>,
  options: LoadSubsetOptions,
): boolean {
  return loadSubsetPromiseDemandMatchers.get(promise)?.(options) ?? true
}

export function createAppliedLoadSubsetOutcome(
  collectionId: string,
  demand: LoadSubsetOptions,
  generation: number,
  sourceResult: void | LoadSubsetResult,
): AppliedLoadSubsetOutcome {
  return {
    collectionId,
    demand,
    generation,
    extent:
      sourceResult?.hasMore === true
        ? `continues`
        : sourceResult?.hasMore === false
          ? `exhausted`
          : `unknown`,
  }
}

export function isAppliedLoadSubsetOutcome(
  value: unknown,
): value is AppliedLoadSubsetOutcome {
  if (typeof value !== `object` || value === null) return false
  const candidate = value as {
    generation?: unknown
    collectionId?: unknown
    demand?: unknown
    extent?: unknown
  }
  return (
    typeof candidate.generation === `number` &&
    typeof candidate.collectionId === `string` &&
    typeof candidate.demand === `object` &&
    candidate.demand !== null &&
    (candidate.extent === `unknown` ||
      candidate.extent === `continues` ||
      candidate.extent === `exhausted`)
  )
}

import type {
  AppliedLoadSubsetOutcome,
  LoadSubsetOptions,
  LoadSubsetResult,
} from '../types.js'

const loadSubsetPromiseDemandMatchers = new WeakMap<
  Promise<unknown>,
  (options: LoadSubsetOptions) => boolean
>()
const loadSubsetResultDemandMatchers = new WeakMap<
  object,
  (options: LoadSubsetOptions) => boolean
>()

export function recordLoadSubsetPromiseDemandMatcher(
  promise: Promise<unknown>,
  matches: (options: LoadSubsetOptions) => boolean,
): void {
  loadSubsetPromiseDemandMatchers.set(promise, matches)
}

export function recordLoadSubsetResultDemandMatcher(
  result: void | LoadSubsetResult,
  matches: (options: LoadSubsetOptions) => boolean,
): void | LoadSubsetResult {
  if (typeof result !== `object`) return result

  // Give each physical acquisition its own result identity. A source may reuse
  // one result object across calls with different demands. Snapshot nested
  // source evidence here too, before the caller publishes coverage from it.
  const appliedRowKeys = result.appliedRowKeys
  const retainedResult: LoadSubsetResult = {
    hasMore: result.hasMore,
    ...(appliedRowKeys === undefined
      ? {}
      : { appliedRowKeys: Object.freeze([...appliedRowKeys]) }),
  }
  loadSubsetResultDemandMatchers.set(retainedResult, matches)
  return retainedResult
}

export function isLoadSubsetResultForDemand(
  promise: Promise<unknown>,
  result: unknown,
  options: LoadSubsetOptions,
): boolean {
  const promiseMatcher = loadSubsetPromiseDemandMatchers.get(promise)
  if (promiseMatcher) return promiseMatcher(options)

  if (typeof result === `object` && result !== null) {
    return loadSubsetResultDemandMatchers.get(result)?.(options) ?? true
  }

  return true
}

export function createAppliedLoadSubsetOutcome(
  collectionId: string,
  demand: LoadSubsetOptions,
  generation: number,
  sourceResult: void | LoadSubsetResult,
): AppliedLoadSubsetOutcome {
  const appliedRowKeys = sourceResult?.appliedRowKeys
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
    ...(appliedRowKeys === undefined
      ? {}
      : { appliedRowKeys: Object.freeze([...appliedRowKeys]) }),
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

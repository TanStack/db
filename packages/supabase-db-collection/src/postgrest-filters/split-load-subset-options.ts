import { IR } from '@tanstack/db'
import { flattenAnd, mergeInFilters } from './common'
import type { LoadSubsetOptions } from '@tanstack/db'
import type { SerializedExpression as Expression } from '../serialize'

export interface SplitLoadSubsetOptionsConfig {
  /** The longest URL (in characters) a single chunk's request may produce. */
  maxUrlLength: number
  /**
   * Renders the longest URL a given subset would produce (main request, and
   * the `whereCurrent` tie request when the subset has a cursor). Injected so
   * the splitter stays a pure function of its inputs — the caller supplies the
   * real `supabase.from(table).url` + search rendering, tests supply a fake.
   */
  measure: (options: LoadSubsetOptions) => number
}

type SplittableConjunct = {
  index: number
  path: Array<string>
  values: Array<unknown>
}

// Mirrors `renderComparison`'s IN handling (common.ts): TanStack's membership
// test ignores null members, and duplicates contribute nothing extra to the
// rendered list, so both are stripped before we decide how big a conjunct is
// and before we hand out chunk values.
function dedupedValues(values: Array<unknown>): Array<unknown> {
  return Array.from(new Set(values.filter((value) => value != null)))
}

// Only a positive, top-level `in(ref, [...])` conjunct is safe to split: the
// union of its chunks is the same set of matching rows. `not(in(...))` and any
// IN nested in OR/NOT are left untouched by the caller (they never reach here
// as a candidate) because a chunked union is not equivalent to their meaning.
function splittableConjuncts(
  conjuncts: Array<Expression>,
): Array<SplittableConjunct> {
  const candidates: Array<SplittableConjunct> = []
  conjuncts.forEach((conjunct, index) => {
    if (conjunct.type !== 'func' || conjunct.name !== 'in') {
      return
    }
    const [left, right] = conjunct.args
    if (
      left?.type !== 'ref' ||
      right?.type !== 'val' ||
      !Array.isArray(right.value)
    ) {
      return
    }
    const values = dedupedValues(right.value)
    if (values.length === 0) {
      // Nothing to chunk (every member was null, or the list was empty); leave
      // the conjunct exactly as it was rendered before.
      return
    }
    candidates.push({ index, path: left.path, values })
  })
  // Largest first: the biggest IN list is the one worth splitting, and the
  // fallback in `splitConjuncts` halves the next-largest one.
  return candidates.sort((a, b) => b.values.length - a.values.length)
}

function replaceConjunct(
  conjuncts: Array<Expression>,
  candidate: SplittableConjunct,
  values: Array<unknown>,
): Array<Expression> {
  const copy = conjuncts.slice()
  copy[candidate.index] = new IR.Func('in', [
    new IR.PropRef(candidate.path),
    new IR.Value(values),
  ])
  return copy
}

function rebuildWhere(
  conjuncts: Array<Expression>,
): LoadSubsetOptions['where'] {
  if (conjuncts.length === 0) {
    return
  }
  const where =
    conjuncts.length === 1
      ? conjuncts[0]
      : new IR.Func('and', conjuncts as unknown as Array<IR.BasicExpression>)
  // `conjuncts` entries are either untouched pieces of the caller's own
  // `where` (already real IR instances) or `IR.Func`/`IR.Value`/`IR.PropRef`
  // instances built above, so this is a widen-then-narrow of the same runtime
  // shape `toPostgrestParams` already accepts elsewhere in this package.
  return where as unknown as LoadSubsetOptions['where']
}

// Applies the caller's `options` (limit/offset/cursor, orderBy, etc.) to one
// chunk's conjunct list, rewriting limit/offset per the plan: a cursor read
// keeps its limit unchanged (the cursor already pins the window start via a
// filter); a cursor-less read with an offset must ask each chunk for enough
// rows to cover the *whole* global window (`limit + offset`) starting at 0,
// because every row in that window ranks at most `offset + limit` inside its
// own chunk — the union of per-chunk windows then still contains the global
// window, with no cross-chunk merge needed since chunks are disjoint on the
// split column.
function buildChunkOptions(
  options: LoadSubsetOptions,
  conjuncts: Array<Expression>,
): LoadSubsetOptions {
  const chunk: LoadSubsetOptions = {
    ...options,
    where: rebuildWhere(conjuncts),
  }
  if (!options.cursor && options.offset) {
    if (options.limit !== undefined) {
      chunk.limit = options.limit + options.offset
    }
    chunk.offset = undefined
  }
  return chunk
}

// Binary-search the longest prefix of `values` whose chunk still fits the
// budget; `fits` is monotonically decreasing in prefix length, so this is
// O(log n) renders instead of O(n).
function longestFittingPrefix(
  fits: (length: number) => boolean,
  count: number,
): number {
  if (count === 0 || !fits(1)) {
    return 0
  }
  if (fits(count)) {
    return count
  }
  let low = 1
  let high = count
  while (low < high) {
    const mid = low + Math.ceil((high - low) / 2)
    if (fits(mid)) {
      low = mid
    } else {
      high = mid - 1
    }
  }
  return low
}

/**
 * Split one oversized subset's conjunct list into several whose rendered URL
 * fits `maxUrlLength`. The largest splittable IN is packed greedily; when not
 * even one of its values fits because another IN is also huge, that other IN
 * is halved and each half is split again from scratch. Halving (rather than
 * packing the other IN as tightly as possible) leaves room for more than one
 * value of the largest IN per chunk, so the chunk count stays close to the
 * minimum. The resulting conjunct lists are a cartesian product of the split
 * candidates and remain pairwise disjoint on the split column(s), so the union
 * of their result sets is exactly the original subset's — no dedupe needed.
 *
 * Returns `undefined` when no split fits: something other than the split
 * candidates (e.g. a huge `not(in(...))`) keeps even a single value over
 * budget, so fanning out would only send more oversized requests.
 */
function splitConjuncts(
  options: LoadSubsetOptions,
  conjuncts: Array<Expression>,
  config: SplitLoadSubsetOptionsConfig,
): Array<Array<Expression>> | undefined {
  const [current, ...rest] = splittableConjuncts(conjuncts)
  if (!current) {
    return [conjuncts]
  }

  const chunks: Array<Array<Expression>> = []
  let remaining = current.values
  while (remaining.length > 0) {
    const fits = (length: number) =>
      config.measure(
        buildChunkOptions(
          options,
          replaceConjunct(conjuncts, current, remaining.slice(0, length)),
        ),
      ) <= config.maxUrlLength
    const fitLength = longestFittingPrefix(fits, remaining.length)

    if (fitLength > 0) {
      chunks.push(
        replaceConjunct(conjuncts, current, remaining.slice(0, fitLength)),
      )
      remaining = remaining.slice(fitLength)
      continue
    }

    const other = rest.find((candidate) => candidate.values.length > 1)
    if (!other) {
      // Nothing left to shrink and even a single value does not fit.
      return
    }

    // Another IN is too big to leave room for even one of `current`'s values:
    // halve it, and split each half (with `current`'s remaining values) again.
    const withRemaining = replaceConjunct(conjuncts, current, remaining)
    const middle = Math.ceil(other.values.length / 2)
    for (const half of [
      other.values.slice(0, middle),
      other.values.slice(middle),
    ]) {
      const halfChunks = splitConjuncts(
        options,
        replaceConjunct(withRemaining, other, half),
        config,
      )
      if (!halfChunks) {
        return
      }
      chunks.push(...halfChunks)
    }
    remaining = []
  }
  return chunks
}

/**
 * Split an oversized `loadSubset` request into several whose rendered URL each
 * fit `maxUrlLength`, so a caller can run them as separate requests and
 * concatenate the results. Returns `[options]` unchanged — the same object,
 * not a copy — whenever it already fits, so the common path sends a
 * byte-identical URL and keeps today's behaviour.
 *
 * Only a positive, top-level `AND`ed `in(ref, [...])` conjunct is ever split:
 * splitting inside `OR`/`NOT`, or a top-level `not(in(...))`, would change
 * which rows the union of chunks matches. When no such conjunct exists,
 * `options.where` is absent, or no split brings every chunk within budget,
 * this returns `[options]` and the caller sends the request as-is, letting the server's own error (if any) surface exactly
 * as it does today.
 */
export function splitLoadSubsetOptions(
  options: LoadSubsetOptions,
  config: SplitLoadSubsetOptionsConfig,
): Array<LoadSubsetOptions> {
  if (config.measure(options) <= config.maxUrlLength) {
    return [options]
  }
  if (!options.where) {
    return [options]
  }

  const conjuncts = mergeInFilters(flattenAnd(options.where))
  if (splittableConjuncts(conjuncts).length === 0) {
    return [options]
  }

  const chunks = splitConjuncts(options, conjuncts, config)
  if (!chunks) {
    return [options]
  }
  return chunks.map((chunkConjuncts) =>
    buildChunkOptions(options, chunkConjuncts),
  )
}

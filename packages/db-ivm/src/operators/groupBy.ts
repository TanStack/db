import { binarySearch, compareKeys, serializeValue } from '../utils.js'
import { map } from './map.js'
import { reduce } from './reduce.js'
import type { IStreamBuilder, KeyValue } from '../types.js'

type GroupKey = Record<string, unknown>

type BasicAggregateFunction<T, R, V = unknown, Reduced = V> = {
  preMap: (data: T) => V
  reduce: (values: Array<[V, number]>, groupKey: string) => Reduced
  postMap?: (result: Reduced) => R
  cleanup?: (groupKey: string) => void
}

type PipedAggregateFunction<T, R> = {
  pipe: (stream: IStreamBuilder<T>) => IStreamBuilder<KeyValue<string, R>>
}

type AggregateFunction<T, R, V = unknown, Reduced = V> =
  | BasicAggregateFunction<T, R, V, Reduced>
  | PipedAggregateFunction<T, R>

type ExtractAggregateReturnType<T, A> =
  A extends AggregateFunction<T, infer R, unknown, unknown> ? R : never

type AggregatesReturnType<T, A> = {
  [K in keyof A]: ExtractAggregateReturnType<T, A[K]>
}

type StringAggOrderable =
  | string
  | number
  | bigint
  | boolean
  | Date
  | null
  | undefined

type StringAggValue<TOrderBy extends StringAggOrderable = StringAggOrderable> =
  {
    rowKey?: string | number
    value: string | null | undefined
    orderBy: TOrderBy
  }

type StringAggEntry<TOrderBy extends StringAggOrderable = StringAggOrderable> =
  {
    rowKey: string | number
    value: string
    orderBy: TOrderBy
  }

type StringAggState<TOrderBy extends StringAggOrderable = StringAggOrderable> =
  {
    entriesByKey: Map<string | number, StringAggEntry<TOrderBy>>
    orderedEntries: Array<StringAggEntry<TOrderBy>>
    text: string
  }

function isPipedAggregateFunction<T, R>(
  aggregate: AggregateFunction<T, R>,
): aggregate is PipedAggregateFunction<T, R> {
  return `pipe` in aggregate
}

/**
 * Groups data by key and applies multiple aggregate operations
 * @param keyExtractor Function to extract grouping key from data
 * @param aggregates Object mapping aggregate names to aggregate functions
 */
export function groupBy<
  T,
  K extends GroupKey,
  A extends Record<string, AggregateFunction<T, unknown, unknown, unknown>>,
>(keyExtractor: (data: T) => K, aggregates: A = {} as A) {
  type ResultType = K & AggregatesReturnType<T, A>

  const basicAggregates = Object.fromEntries(
    Object.entries(aggregates).filter(
      ([, aggregate]) => !isPipedAggregateFunction(aggregate),
    ),
  ) as Record<string, BasicAggregateFunction<T, unknown, unknown, unknown>>

  // @ts-expect-error - TODO: we don't use this yet, but we will
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const pipedAggregates = Object.fromEntries(
    Object.entries(aggregates).filter(([, aggregate]) =>
      isPipedAggregateFunction(aggregate),
    ),
  ) as Record<string, PipedAggregateFunction<T, unknown>>

  return (
    stream: IStreamBuilder<T>,
  ): IStreamBuilder<KeyValue<string, ResultType>> => {
    const keySentinel = `__original_key__`

    const withKeysAndValues = stream.pipe(
      map((data) => {
        const key = keyExtractor(data)
        const keyString = serializeValue(key)
        const values: Record<string, unknown> = {
          [keySentinel]: key,
        }

        for (const [name, aggregate] of Object.entries(basicAggregates)) {
          values[name] = aggregate.preMap(data)
        }

        return [keyString, values] as KeyValue<string, Record<string, unknown>>
      }),
    )

    const reduced = withKeysAndValues.pipe(
      reduce((values, keyString) => {
        let totalMultiplicity = 0
        for (const [, multiplicity] of values) {
          totalMultiplicity += multiplicity
        }

        if (totalMultiplicity <= 0) {
          for (const aggregate of Object.values(basicAggregates)) {
            aggregate.cleanup?.(keyString)
          }
          return []
        }

        const result: Record<string, unknown> = {}
        result[keySentinel] = values[0]?.[0]?.[keySentinel]

        for (const [name, aggregate] of Object.entries(basicAggregates)) {
          const preValues = values.map(
            ([value, multiplicity]) =>
              [value[name], multiplicity] as [unknown, number],
          )
          result[name] = aggregate.reduce(preValues, keyString)
        }

        return [[result, 1]]
      }),
    )

    return reduced.pipe(
      map(([keyString, values]) => {
        const key = values[keySentinel] as K
        const result: Record<string, unknown> = {}

        Object.assign(result, key)

        for (const [name, aggregate] of Object.entries(basicAggregates)) {
          result[name] = aggregate.postMap
            ? aggregate.postMap(values[name])
            : values[name]
        }

        return [keyString, result] as KeyValue<string, ResultType>
      }),
    )
  }
}

/**
 * Creates a sum aggregate function
 */
export function sum<T>(
  valueExtractor: (value: T) => number = (v) => v as unknown as number,
): AggregateFunction<T, number, number> {
  return {
    preMap: (data: T) => valueExtractor(data),
    reduce: (values: Array<[number, number]>) => {
      let total = 0
      for (const [value, multiplicity] of values) {
        total += value * multiplicity
      }
      return total
    },
  }
}

/**
 * Creates a count aggregate function
 */
export function count<T>(
  valueExtractor: (value: T) => unknown = (v) => v,
): AggregateFunction<T, number, number> {
  return {
    // Count only not-null values (the `== null` comparison gives true for both null and undefined)
    preMap: (data: T) => (valueExtractor(data) == null ? 0 : 1),
    reduce: (values: Array<[number, number]>) => {
      let totalCount = 0
      for (const [nullMultiplier, multiplicity] of values) {
        totalCount += nullMultiplier * multiplicity
      }
      return totalCount
    },
  }
}

/**
 * Creates an average aggregate function
 */
export function avg<T>(
  valueExtractor: (value: T) => number = (v) => v as unknown as number,
): AggregateFunction<T, number, { sum: number; count: number }> {
  return {
    preMap: (data: T) => ({
      sum: valueExtractor(data),
      count: 0,
    }),
    reduce: (values: Array<[{ sum: number; count: number }, number]>) => {
      let totalSum = 0
      let totalCount = 0
      for (const [value, multiplicity] of values) {
        totalSum += value.sum * multiplicity
        totalCount += multiplicity
      }
      return {
        sum: totalSum,
        count: totalCount,
      }
    },
    postMap: (result: { sum: number; count: number }) => {
      return result.sum / result.count
    },
  }
}

function compareStringAggOrderValues(
  a: StringAggOrderable,
  b: StringAggOrderable,
): number {
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1

  const normalizedA = a instanceof Date ? a.getTime() : a
  const normalizedB = b instanceof Date ? b.getTime() : b

  if (normalizedA < normalizedB) return -1
  if (normalizedA > normalizedB) return 1
  return 0
}

function compareStringAggEntries<TOrderBy extends StringAggOrderable>(
  left: StringAggEntry<TOrderBy>,
  right: StringAggEntry<TOrderBy>,
): number {
  const orderComparison = compareStringAggOrderValues(
    left.orderBy,
    right.orderBy,
  )
  if (orderComparison !== 0) {
    return orderComparison
  }
  return compareKeys(left.rowKey, right.rowKey)
}

function buildStringAggText<TOrderBy extends StringAggOrderable>(
  state: StringAggState<TOrderBy>,
  separator: string,
): void {
  state.text = state.orderedEntries.map((entry) => entry.value).join(separator)
}

function removeStringAggEntry<TOrderBy extends StringAggOrderable>(
  state: StringAggState<TOrderBy>,
  entry: StringAggEntry<TOrderBy>,
  separator: string,
): boolean {
  const index = binarySearch(
    state.orderedEntries,
    entry,
    compareStringAggEntries,
  )
  if (state.orderedEntries[index]?.rowKey !== entry.rowKey) {
    throw new Error(
      `stringAgg internal state desynchronized: entry missing from orderedEntries`,
    )
  }

  const entryCount = state.orderedEntries.length
  state.orderedEntries.splice(index, 1)

  if (entryCount === 1) {
    state.text = ``
    return false
  }

  if (index === entryCount - 1) {
    const suffixLength = separator.length + entry.value.length
    state.text = state.text.slice(0, state.text.length - suffixLength)
    return false
  }

  if (index === 0) {
    state.text = state.text.slice(entry.value.length + separator.length)
    return false
  }

  return true
}

function insertStringAggEntry<TOrderBy extends StringAggOrderable>(
  state: StringAggState<TOrderBy>,
  entry: StringAggEntry<TOrderBy>,
  separator: string,
): boolean {
  const index = binarySearch(
    state.orderedEntries,
    entry,
    compareStringAggEntries,
  )
  const entryCount = state.orderedEntries.length
  state.orderedEntries.splice(index, 0, entry)

  if (entryCount === 0) {
    state.text = entry.value
    return false
  }

  if (index === entryCount) {
    state.text = `${state.text}${separator}${entry.value}`
    return false
  }

  if (index === 0) {
    state.text = `${entry.value}${separator}${state.text}`
    return false
  }

  return true
}

function fallbackStringAggReduce<TOrderBy extends StringAggOrderable>(
  values: Array<[StringAggValue<TOrderBy>, number]>,
  separator: string,
): string {
  const orderedEntries: Array<StringAggEntry<TOrderBy>> = []

  for (const [entry, multiplicity] of values) {
    if (multiplicity <= 0 || entry.value == null) {
      continue
    }

    for (let i = 0; i < multiplicity; i++) {
      orderedEntries.push({
        // Fallback path has no stable row identity, so reuse the string value as
        // a deterministic tie-breaker when orderBy values collide.
        rowKey: entry.value,
        value: entry.value,
        orderBy: entry.orderBy,
      })
    }
  }

  orderedEntries.sort(compareStringAggEntries)

  return orderedEntries.map((entry) => entry.value).join(separator)
}

/**
 * Creates a string aggregation function that concatenates string values ordered
 * by orderByExtractor and then rowKeyExtractor.
 * When rowKeyExtractor is omitted, ties fall back to the string value itself.
 * @param valueExtractor Function to extract the string value from each data entry
 * @param separator Separator inserted between aggregated values
 * @param orderByExtractor Function to extract the ordering value for deterministic concatenation
 * @param rowKeyExtractor Optional stable row identity used to break orderBy ties deterministically
 */
export function stringAgg<T, TOrderBy extends StringAggOrderable>(
  valueExtractor: (value: T) => string | null | undefined = (v) =>
    v as unknown as string,
  separator: string = ``,
  orderByExtractor: (value: T) => TOrderBy = () =>
    undefined as unknown as TOrderBy,
  rowKeyExtractor?: (value: T) => string | number,
): AggregateFunction<T, string, StringAggValue<TOrderBy>, string> {
  const groupStates = new Map<string, StringAggState<TOrderBy>>()

  const preMap = (data: T): StringAggValue<TOrderBy> => ({
    rowKey: rowKeyExtractor?.(data),
    value: valueExtractor(data),
    orderBy: orderByExtractor(data),
  })

  if (!rowKeyExtractor) {
    return {
      preMap,
      reduce: (values) => fallbackStringAggReduce(values, separator),
    }
  }

  return {
    preMap,
    reduce: (values, groupKey) => {
      let state = groupStates.get(groupKey)
      if (!state) {
        state = {
          entriesByKey: new Map(),
          orderedEntries: [],
          text: ``,
        }
        groupStates.set(groupKey, state)
      }

      const nextEntriesByKey = new Map<
        string | number,
        StringAggEntry<TOrderBy>
      >()

      for (const [entry, multiplicity] of values) {
        if (entry.rowKey == null || multiplicity <= 0 || entry.value == null) {
          continue
        }

        nextEntriesByKey.set(entry.rowKey, {
          rowKey: entry.rowKey,
          value: entry.value,
          orderBy: entry.orderBy,
        })
      }

      const touchedRowKeys = new Set<string | number>([
        ...state.entriesByKey.keys(),
        ...nextEntriesByKey.keys(),
      ])

      let textDirty = false

      for (const rowKey of touchedRowKeys) {
        const previousEntry = state.entriesByKey.get(rowKey)
        const nextEntry = nextEntriesByKey.get(rowKey)

        if (
          previousEntry &&
          nextEntry &&
          previousEntry.value === nextEntry.value &&
          compareStringAggEntries(previousEntry, nextEntry) === 0
        ) {
          continue
        }

        if (previousEntry) {
          const removedNeedsRebuild = removeStringAggEntry(
            state,
            previousEntry,
            separator,
          )
          textDirty = textDirty || removedNeedsRebuild
          state.entriesByKey.delete(rowKey)
        }

        if (nextEntry) {
          const insertedNeedsRebuild = insertStringAggEntry(
            state,
            nextEntry,
            separator,
          )
          textDirty = textDirty || insertedNeedsRebuild
          state.entriesByKey.set(rowKey, nextEntry)
        }
      }

      if (textDirty) {
        buildStringAggText(state, separator)
      }

      return state.text
    },
    cleanup: (groupKey) => {
      groupStates.delete(groupKey)
    },
  }
}

type CanMinMax = number | Date | bigint | string

/**
 * Creates a min aggregate function that computes the minimum value in a group
 * @param valueExtractor Function to extract a comparable value from each data entry
 */
export function min<T extends CanMinMax>(): AggregateFunction<
  T,
  T | undefined,
  T | undefined
>
export function min<T, V extends CanMinMax>(
  valueExtractor: (value: T) => V,
): AggregateFunction<T, V | undefined, V | undefined>
export function min<T, V extends CanMinMax>(
  valueExtractor?: (value: T) => V,
): AggregateFunction<T, V | undefined, V | undefined> {
  const extractor = valueExtractor ?? ((v: T) => v as unknown as V)
  return {
    preMap: (data: T) => extractor(data),
    reduce: (values) => {
      let minValue: V | undefined
      for (const [value] of values) {
        if (!minValue || (value && value < minValue)) {
          minValue = value
        }
      }
      return minValue
    },
  }
}

/**
 * Creates a max aggregate function that computes the maximum value in a group
 * @param valueExtractor Function to extract a comparable value from each data entry
 */
export function max<T extends CanMinMax>(): AggregateFunction<
  T,
  T | undefined,
  T | undefined
>
export function max<T, V extends CanMinMax>(
  valueExtractor: (value: T) => V,
): AggregateFunction<T, V | undefined, V | undefined>
export function max<T, V extends CanMinMax>(
  valueExtractor?: (value: T) => V,
): AggregateFunction<T, V | undefined, V | undefined> {
  const extractor = valueExtractor ?? ((v: T) => v as unknown as V)
  return {
    preMap: (data: T) => extractor(data),
    reduce: (values) => {
      let maxValue: V | undefined
      for (const [value] of values) {
        if (!maxValue || (value && value > maxValue)) {
          maxValue = value
        }
      }
      return maxValue
    },
  }
}

/**
 * Creates a median aggregate function that computes the middle value in a sorted group
 * If there's an even number of values, returns the average of the two middle values
 * @param valueExtractor Function to extract a numeric value from each data entry
 */
export function median<T>(
  valueExtractor: (value: T) => number = (v) => v as unknown as number,
): AggregateFunction<T, number, Array<number>> {
  return {
    preMap: (data: T) => [valueExtractor(data)],
    reduce: (values: Array<[Array<number>, number]>) => {
      const allValues: Array<number> = []
      for (const [valueArray, multiplicity] of values) {
        for (const value of valueArray) {
          for (let i = 0; i < multiplicity; i++) {
            allValues.push(value)
          }
        }
      }

      if (allValues.length === 0) {
        return []
      }

      allValues.sort((a, b) => a - b)
      return allValues
    },
    postMap: (result: Array<number>) => {
      if (result.length === 0) return 0

      const mid = Math.floor(result.length / 2)
      if (result.length % 2 === 0) {
        return (result[mid - 1]! + result[mid]!) / 2
      }

      return result[mid]!
    },
  }
}

/**
 * Creates a mode aggregate function that computes the most frequent value in a group
 * If multiple values have the same highest frequency, returns the first one encountered
 * @param valueExtractor Function to extract a value from each data entry
 */
export function mode<T>(
  valueExtractor: (value: T) => number = (v) => v as unknown as number,
): AggregateFunction<T, number, Map<number, number>> {
  return {
    preMap: (data: T) => {
      const value = valueExtractor(data)
      const frequencyMap = new Map<number, number>()
      frequencyMap.set(value, 1)
      return frequencyMap
    },
    reduce: (values: Array<[Map<number, number>, number]>) => {
      const combinedMap = new Map<number, number>()

      for (const [frequencyMap, multiplicity] of values) {
        for (const [value, frequencyCount] of frequencyMap.entries()) {
          const currentCount = combinedMap.get(value) || 0
          combinedMap.set(value, currentCount + frequencyCount * multiplicity)
        }
      }

      return combinedMap
    },
    postMap: (result: Map<number, number>) => {
      if (result.size === 0) return 0

      let modeValue = 0
      let maxFrequency = 0

      for (const [value, frequency] of result.entries()) {
        if (frequency > maxFrequency) {
          maxFrequency = frequency
          modeValue = value
        }
      }

      return modeValue
    },
  }
}

export const groupByOperators = {
  sum,
  count,
  avg,
  stringAgg,
  min,
  max,
  median,
  mode,
}

import { getLoadSubsetDemandKey } from './ir-stable-identity.js'
import { Func, PropRef, Value } from './ir.js'
import type { BasicExpression } from './ir.js'
import type { LoadSubsetFn, LoadSubsetOptions } from '../types.js'

/** Deduplicates exact canonical demands without inferring broader coverage. */
export class DeduplicatedLoadSubset {
  private readonly completed = new Set<string | undefined>()
  private readonly inflight = new Map<string | undefined, Promise<void>>()
  private generation = 0

  constructor(
    private readonly options: {
      loadSubset: LoadSubsetFn
      onDeduplicate?: (options: LoadSubsetOptions) => void
    },
  ) {}

  loadSubset = (options: LoadSubsetOptions): true | Promise<void> => {
    const request = cloneOptions(options)
    const key = getLoadSubsetDemandKey(request)
    if (this.completed.has(key)) {
      this.options.onDeduplicate?.(options)
      return true
    }

    // Requests with independent cancellation own independent transports.
    // Unabortable requests can share without an ownership protocol.
    const existing = options.signal ? undefined : this.inflight.get(key)
    if (existing) {
      void existing.then(
        () => this.options.onDeduplicate?.(options),
        () => {},
      )
      return existing
    }

    const generation = this.generation
    const result = this.options.loadSubset(request)

    if (result === true) {
      if (generation === this.generation && !request.signal?.aborted) {
        this.completed.add(key)
      }
      return true
    }

    const promise = result
      .then((value) => {
        if (generation === this.generation && !request.signal?.aborted) {
          this.completed.add(key)
        }
        return value
      })
      .finally(() => {
        if (this.inflight.get(key) === promise) this.inflight.delete(key)
      })
    if (!options.signal && generation === this.generation) {
      this.inflight.set(key, promise)
    }
    return promise
  }

  reset(): void {
    this.completed.clear()
    this.inflight.clear()
    this.generation++
  }
}

/** Snapshot a demand before retaining it or crossing an async boundary. */
export function cloneOptions(options: LoadSubsetOptions): LoadSubsetOptions {
  return {
    ...options,
    where: options.where ? cloneExpression(options.where, true) : undefined,
    orderBy: options.orderBy?.map((clause) => ({
      ...clause,
      expression: cloneExpression(clause.expression),
      compareOptions:
        clause.compareOptions.stringSort === `locale`
          ? {
              ...clause.compareOptions,
              localeOptions: clause.compareOptions.localeOptions
                ? { ...clause.compareOptions.localeOptions }
                : undefined,
            }
          : { ...clause.compareOptions },
    })),
    cursor: options.cursor
      ? {
          ...options.cursor,
          whereFrom: cloneExpression(options.cursor.whereFrom, true),
          whereCurrent: cloneExpression(options.cursor.whereCurrent, true),
        }
      : undefined,
  }
}

function cloneExpression<T>(
  expression: BasicExpression<T>,
  predicate = false,
): BasicExpression<T> {
  switch (expression.type) {
    case `ref`:
      return new PropRef<T>([...expression.path])
    case `val`:
      return new Value<T>(
        predicate ? snapshotComparable(expression.value) : expression.value,
      )
    case `func`: {
      const compares = predicate && isComparison(expression.name)
      return new Func<T>(
        expression.name,
        expression.args.map((arg, index) => {
          if (
            predicate &&
            expression.name === `in` &&
            index === 1 &&
            arg.type === `val` &&
            Array.isArray(arg.value)
          ) {
            return new Value(arg.value.map(snapshotComparable))
          }
          return cloneExpression(arg, compares)
        }),
      )
    }
  }
}

function isComparison(name: string): boolean {
  return (
    name === `eq` ||
    name === `gt` ||
    name === `gte` ||
    name === `lt` ||
    name === `lte`
  )
}

function snapshotComparable<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T
  if (typeof Buffer !== `undefined` && value instanceof Buffer) {
    return Buffer.from(value) as T
  }
  if (value instanceof Uint8Array) return value.slice() as T
  // Opaque values compare by reference, so cloning them would change meaning.
  return value
}

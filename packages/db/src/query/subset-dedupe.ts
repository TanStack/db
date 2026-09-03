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
    where: options.where ? cloneExpression(options.where) : undefined,
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
          whereFrom: cloneExpression(options.cursor.whereFrom),
          whereCurrent: cloneExpression(options.cursor.whereCurrent),
        }
      : undefined,
  }
}

function cloneExpression<T>(
  expression: BasicExpression<T>,
  context: `exact` | `equality` | `ordering` | `membership` = `exact`,
): BasicExpression<T> {
  switch (expression.type) {
    case `ref`:
      return new PropRef<T>([...expression.path])
    case `val`:
      return new Value<T>(
        context === `membership`
          ? snapshotMembership(expression.value)
          : context === `ordering`
            ? snapshotOrdering(expression.value)
            : context === `equality`
              ? snapshotComparable(expression.value)
              : expression.value,
      )
    case `func`: {
      return new Func<T>(
        expression.name,
        expression.args.map((arg, index) =>
          cloneExpression(
            arg,
            expression.name === `in` && index === 1
              ? `membership`
              : isEquality(expression.name)
                ? `equality`
                : isOrdering(expression.name)
                  ? `ordering`
                  : context,
          ),
        ),
      )
    }
  }
}

function isEquality(name: string): boolean {
  return name === `eq`
}

function isOrdering(name: string): boolean {
  return name === `gt` || name === `gte` || name === `lt` || name === `lte`
}

function snapshotComparable<T>(value: T): T {
  if (typeof value === `object` && value !== null) {
    try {
      return new Date(Reflect.apply(Date.prototype.getTime, value, [])) as T
    } catch {
      // Not a Date; continue with the other comparison domains.
    }
  }
  if (isUint8Array(value)) {
    const bytes = new Uint8Array(value)
    return (
      typeof Buffer !== `undefined` && value instanceof Buffer
        ? Buffer.from(bytes)
        : bytes
    ) as T
  }
  // Opaque values compare by reference, so cloning them would change meaning.
  return value
}

function snapshotMembership<T>(value: T): T {
  if (!Array.isArray(value)) return value
  const result = new Array(value.length)
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index)
    if (!descriptor) continue
    if (!(`value` in descriptor)) {
      throw new TypeError(`Cannot snapshot membership candidate accessor`)
    }
    result[index] = snapshotComparable(descriptor.value)
  }
  return result as T
}

function snapshotOrdering<T>(value: T): T {
  if (!Array.isArray(value)) return snapshotComparable(value)
  const result = new Array(value.length)
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index)
    if (!descriptor) continue
    if (!(`value` in descriptor)) {
      throw new TypeError(`Cannot snapshot ordering operand accessor`)
    }
    result[index] = snapshotOrdering(descriptor.value)
  }
  return result as T
}

const typedArrayTag = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  Symbol.toStringTag,
)?.get

function isUint8Array(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    typedArrayTag !== undefined &&
    Reflect.apply(typedArrayTag, value, []) === `Uint8Array`
  )
}

import {
  readDateTimestamp,
  snapshotTemporalEqualityValue,
  snapshotUint8ArrayBytes,
} from '../utils/comparison.js'
import { isTemporal } from '../utils.js'
import { Func, PropRef, Value } from './ir.js'
import {
  assertSnapshotCapableStructuralValue,
  getExpressionArgumentValueContext,
  snapshotMembershipCandidateValues,
} from './expression-value-context.js'
import type { ExpressionValueContext } from './expression-value-context.js'
import type { BasicExpression } from './ir.js'
import type { LoadSubsetOptions } from '../types.js'

/** Clone request state before retaining it across an asynchronous boundary. */
export function cloneLoadSubsetOptions(
  options: LoadSubsetOptions,
): LoadSubsetOptions {
  return {
    ...options,
    where: options.where
      ? cloneBasicExpression(options.where, `exact-output`)
      : undefined,
    orderBy: options.orderBy?.map((clause) => ({
      ...clause,
      expression: cloneBasicExpression(clause.expression, `ordering-operand`),
      compareOptions: snapshotStructuralValue(clause.compareOptions),
    })),
    cursor: options.cursor
      ? {
          ...options.cursor,
          whereFrom: cloneBasicExpression(
            options.cursor.whereFrom,
            `exact-output`,
          ),
          whereCurrent: cloneBasicExpression(
            options.cursor.whereCurrent,
            `exact-output`,
          ),
        }
      : undefined,
  }
}

/** Snapshot data demand without retaining request ownership objects. */
export function snapshotLoadSubsetDemand(
  options: LoadSubsetOptions,
): LoadSubsetOptions {
  const {
    signal: _signal,
    subscription: _subscription,
    ...demand
  } = cloneLoadSubsetOptions(options)
  return demand
}

function cloneBasicExpression<T>(
  expression: BasicExpression<T>,
  context: ExpressionValueContext = `exact-output`,
): BasicExpression<T> {
  switch (expression.type) {
    case `ref`:
      return new PropRef<T>([...expression.path])
    case `val`:
      return new Value<T>(
        context === `equality-operand`
          ? snapshotEqualityValue(expression.value)
          : context === `membership-candidates`
            ? snapshotMembershipCandidates(expression.value)
            : context === `ordering-operand`
              ? snapshotStructuralOperand(expression.value)
              : context === `structural-operand`
                ? snapshotStructuralOperand(expression.value)
                : expression.value,
      )
    case `func`:
      return new Func<T>(
        expression.name,
        expression.args.map((arg, index) => {
          const argumentContext = getExpressionArgumentValueContext(
            expression.name,
            index,
            expression.args.length,
            context,
          )
          return cloneBasicExpression(arg, argumentContext)
        }),
      )
  }
}

function snapshotStructuralOperand<T>(value: T): T {
  assertSnapshotCapableStructuralValue(value)
  return snapshotStructuralValue(value)
}

function snapshotEqualityValue<T>(value: T): T {
  if (value instanceof Date) {
    return new Date(readDateTimestamp(value)) as T
  }

  if (typeof Buffer !== `undefined` && value instanceof Buffer) {
    return Buffer.from(snapshotUint8ArrayBytes(value)) as T
  }

  if (value instanceof Uint8Array) {
    return snapshotUint8ArrayBytes(value) as T
  }

  if (isTemporal(value)) {
    return snapshotTemporalEqualityValue(value) as T
  }

  // Other objects use reference equality in predicate identity and comparison.
  return value
}

function snapshotMembershipCandidates<T>(value: T): T {
  const candidates = snapshotMembershipCandidateValues(value)
  if (candidates === undefined) return value
  return candidates.map((candidate) => snapshotEqualityValue(candidate)) as T
}

function snapshotStructuralValue<T>(
  value: T,
  seen: WeakMap<object, unknown> = new WeakMap(),
): T {
  if (typeof value !== `object` || value === null) return value

  const existing = seen.get(value)
  if (existing !== undefined) return existing as T

  if (value instanceof Date) {
    return new Date(value.getTime()) as T
  }

  if (typeof Buffer !== `undefined` && value instanceof Buffer) {
    return Buffer.from(value) as T
  }

  if (value instanceof ArrayBuffer) {
    return value.slice(0) as T
  }

  if (value instanceof DataView) {
    const bytes = new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    ).slice()
    return new DataView(bytes.buffer) as T
  }

  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    ).slice()
    const Constructor = value.constructor as new (
      buffer: ArrayBuffer,
    ) => ArrayBufferView
    return new Constructor(bytes.buffer) as T
  }

  if (Array.isArray(value)) {
    const result: Array<unknown> = new Array(value.length)
    seen.set(value, result)
    for (const key of Object.keys(value)) {
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: snapshotStructuralValue(value[Number(key)], seen),
      })
    }
    return result as T
  }

  if (value instanceof Map) {
    const result = new Map<unknown, unknown>()
    seen.set(value, result)
    for (const [key, entryValue] of value) {
      result.set(
        snapshotStructuralValue(key, seen),
        snapshotStructuralValue(entryValue, seen),
      )
    }
    return result as T
  }

  if (value instanceof Set) {
    const result = new Set<unknown>()
    seen.set(value, result)
    for (const item of value) {
      result.add(snapshotStructuralValue(item, seen))
    }
    return result as T
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    // Non-plain objects use runtime reference identity when they cannot be
    // compared by value. Retain that identity instead of changing semantics.
    return value
  }

  const result = Object.create(prototype) as Record<string, unknown>
  seen.set(value, result)
  for (const key of Object.keys(value)) {
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: snapshotStructuralValue(
        (value as Record<string, unknown>)[key],
        seen,
      ),
    })
  }
  return result as T
}

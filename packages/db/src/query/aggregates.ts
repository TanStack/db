import { Aggregate } from './ir.js'
import { toExpression } from './builder/ref-proxy.js'
import type { ExpressionLike } from './builder/functions.js'
import type { NamespacedRow } from '../types.js'

/**
 * A single row as seen by an aggregate: `[rowKey, namespacedRow]`.
 */
export type AggregateEntry = [string, NamespacedRow]

/**
 * Accessors handed to a custom aggregate factory.
 */
export type AggregateContext = {
  /**
   * Raw value of the aggregate's first argument for this row.
   * No numeric coercion is applied.
   */
  value: (entry: AggregateEntry) => unknown
  /**
   * Stable per-row key. Use it to keep rows distinct (values emitted by
   * `preMap` are consolidated by hash) or to order deterministically.
   */
  key: (entry: AggregateEntry) => string
}

/**
 * Implementation of a custom aggregate, mirroring db-ivm's basic aggregate contract.
 *
 * `reduce` receives the complete consolidated multiset for the group on every
 * change, as `[value, multiplicity]` pairs — it is a full recompute, not a delta.
 * Ignoring `multiplicity` under-counts duplicate values.
 */
export type CustomAggregateImpl<TValue = unknown, TResult = unknown> = {
  preMap: (entry: AggregateEntry) => TValue
  reduce: (values: Array<[TValue, number]>) => TValue
  postMap?: (result: TValue) => TResult
}

/**
 * Factory that builds a custom aggregate implementation for one compiled query.
 *
 * `additionalArgs` holds the evaluated values of any arguments after the first
 * one in the aggregate expression; they must be constant expressions.
 */
export type CustomAggregateFactory<TValue = any, TResult = unknown> = (
  ctx: AggregateContext,
  additionalArgs: Array<unknown>,
) => CustomAggregateImpl<TValue, TResult>

// `any` for the value type: it is existential from the registry's point of view,
// and `unknown` would make user implementations non-assignable (contravariance).
type AnyCustomAggregateFactory = CustomAggregateFactory<any, unknown>

/** Aggregate names implemented natively by the group-by compiler. */
export const BUILTIN_AGGREGATE_NAMES: ReadonlySet<string> = new Set([
  `sum`,
  `count`,
  `avg`,
  `min`,
  `max`,
])

const customAggregates = new Map<string, AnyCustomAggregateFactory>()

const DEV =
  typeof process !== `undefined` && process.env.NODE_ENV !== `production`

/**
 * Registers a custom aggregate function under `name` (case-insensitive).
 *
 * Re-registering a name — including a built-in — replaces the previous
 * implementation for queries compiled afterwards and warns in development.
 * Already-compiled live queries keep the implementation they were compiled with.
 */
export function registerAggregate(
  name: string,
  factory: AnyCustomAggregateFactory,
): void {
  const normalized = name.toLowerCase()

  if (DEV) {
    if (BUILTIN_AGGREGATE_NAMES.has(normalized)) {
      console.warn(
        `[@tanstack/db] registerAggregate("${name}") overrides the built-in ` +
          `aggregate "${normalized}". This affects every query compiled afterwards, ` +
          `app-wide. Already-compiled queries keep the built-in behavior.`,
      )
    } else if (customAggregates.has(normalized)) {
      console.warn(
        `[@tanstack/db] registerAggregate("${name}") replaces an existing custom ` +
          `aggregate registration. Queries compiled before this call keep the ` +
          `previous implementation.`,
      )
    }
  }

  customAggregates.set(normalized, factory)
}

/**
 * Removes a custom aggregate registration.
 *
 * If the name shadowed a built-in, the built-in becomes active again because
 * the compiler falls back to it when no registration exists.
 *
 * @returns whether a registration existed for the name
 */
export function unregisterAggregate(name: string): boolean {
  return customAggregates.delete(name.toLowerCase())
}

/** Names of all currently registered custom aggregates. */
export function getRegisteredAggregates(): ReadonlySet<string> {
  return new Set(customAggregates.keys())
}

/** Looks up a registered custom aggregate factory. Used by the compiler. */
export function getCustomAggregate(
  name: string,
): AnyCustomAggregateFactory | undefined {
  return customAggregates.get(name.toLowerCase())
}

/**
 * Registers a custom aggregate and returns a typed builder function for use in
 * `select()` callbacks.
 *
 * @param name - Aggregate name (case-insensitive)
 * @param factory - Builds the aggregate implementation from the row accessors
 *   and the evaluated extra parameters
 * @returns a function taking the aggregated expression plus the extra parameters
 *
 * @example
 * ```ts
 * const groupConcat = createAggregate<string, [separator?: string]>(
 *   `group_concat`,
 *   (ctx, [separator = `,`]) => ({
 *     preMap: (entry) => [ctx.key(entry), String(ctx.value(entry) ?? ``)],
 *     reduce: (values) =>
 *       values
 *         .filter(([, multiplicity]) => multiplicity > 0)
 *         .sort(([a], [b]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
 *         .map(([[, text]]) => text)
 *         .join(separator),
 *   }),
 * )
 *
 * query.groupBy(({ todo }) => todo.listId).select(({ todo }) => ({
 *   listId: todo.listId,
 *   names: groupConcat(todo.text, ` | `),
 * }))
 * ```
 */
export function createAggregate<TResult, TParams extends Array<unknown> = []>(
  name: string,
  factory: (
    ctx: AggregateContext,
    params: TParams,
  ) => CustomAggregateImpl<any, TResult>,
): (arg: ExpressionLike, ...params: TParams) => Aggregate<TResult> {
  registerAggregate(name, (ctx, additionalArgs) =>
    factory(ctx, additionalArgs as TParams),
  )

  return (arg: ExpressionLike, ...params: TParams) =>
    new Aggregate<TResult>(name, [
      toExpression(arg),
      ...params.map((param) => toExpression(param)),
    ])
}

import { normalizeValue } from '../utils/comparison.js'
import { isVirtualPropName } from '../virtual-props.js'
import type { BasicExpression, PropRef } from './ir.js'

type Row = Record<string, unknown>

/** An `eq(field, literal)` conjunct on a row's own field. */
export type EqualityConjunct = { path: Array<string>; literalKey: string }

// Typed so that 1, '1', and true stay distinct.
export function equalityKey(value: unknown): string | undefined {
  const normalized = normalizeValue(value)
  const type = typeof normalized
  return type === `string` || type === `number` || type === `boolean`
    ? `${type}:${String(normalized)}`
    : undefined
}

export function readPath(row: Row, path: Array<string>): unknown {
  try {
    let value: unknown = row
    for (const segment of path) value = (value as Row | undefined)?.[segment]
    return value
  } catch {
    // The full predicate treats a throwing read as false.
    return undefined
  }
}

/**
 * The `eq(field, literal)` conjunct `expression` is, with the field's path in
 * the row as `rowPath` gives it, or undefined for any other expression.
 */
export function equalityConjunct(
  expression: BasicExpression,
  rowPath: (ref: PropRef) => Array<string> | undefined,
): EqualityConjunct | undefined {
  if (expression.type !== `func` || expression.name !== `eq`) return undefined
  const args = expression.args
  if (args.length !== 2) return undefined
  const left = args[0]!
  const right = args[1]!
  const ref = left.type === `ref` ? left : right
  const literal = left.type === `val` ? left : right
  if (ref.type !== `ref` || literal.type !== `val`) return undefined
  const path = rowPath(ref)
  if (!path?.length || isVirtualPropName(path[0]!)) return undefined
  const literalKey = equalityKey(literal.value)
  return literalKey === undefined ? undefined : { path, literalKey }
}

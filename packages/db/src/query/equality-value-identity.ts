import { serializeValue } from '@tanstack/db-ivm'
import { normalizeValue } from '../utils/comparison.js'
import { getRuntimeReferenceIdentity } from './runtime-reference-identity.js'

export const PARENT_CONTEXT_IDENTITY = `__parentContextIdentity`

/** Preserve the value relation used by equality predicates in keyed state. */
export function getEqualityValueIdentity(value: unknown): unknown {
  const normalized = normalizeValue(value)
  if (
    (typeof normalized === `object` && normalized !== null) ||
    typeof normalized === `function` ||
    typeof normalized === `symbol`
  ) {
    return getRuntimeReferenceIdentity(normalized as object | symbol)
  }
  return normalized
}

export function serializeEqualityValue(value: unknown): string {
  return serializeValue(getEqualityValueIdentity(value))
}

/** Record the evaluator-level identity of a compiler-created parent context. */
export function setParentContextIdentity(
  context: Record<string, unknown>,
  identity: unknown,
): void {
  // This field is enumerable on purpose: D2's multiset must distinguish two
  // compiler contexts whose user-visible shapes match but whose leaf values
  // compare by reference. Output cleanup removes it with the other route data.
  context[PARENT_CONTEXT_IDENTITY] = identity
}

/**
 * Parent contexts are structural compiler records whose leaf values still use
 * query equality. Their identity is recorded when the projection is built so
 * a later insert/retract can reconstruct the same route without treating the
 * wrapper object itself as a user value.
 */
export function getParentContextIdentity(context: unknown): unknown {
  if (typeof context !== `object` || context === null) return context
  return (
    (context as Record<string, unknown>)[PARENT_CONTEXT_IDENTITY] ?? context
  )
}

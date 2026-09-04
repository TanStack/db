import { serializeValue } from '@tanstack/db-ivm'
import { normalizeValue } from '../utils/comparison.js'
import {
  createRuntimeReferenceIdentityFactory,
  getRuntimeReferenceIdentity,
} from './runtime-reference-identity.js'

const PARENT_CONTEXT = Symbol(`tanstack_db_parent_context`)

type ParentContext = {
  [PARENT_CONTEXT]: true
  value: Record<string, unknown>
  identity: unknown
}

type ReferenceIdentity = typeof getRuntimeReferenceIdentity

export type ValueIdentity = {
  equality: (value: unknown) => unknown
  exact: (value: unknown) => unknown
  serializeEquality: (value: unknown) => string
}

function equalityIdentity(
  value: unknown,
  referenceIdentity: ReferenceIdentity,
): unknown {
  const normalized = normalizeValue(value)
  if (
    (typeof normalized === `object` && normalized !== null) ||
    typeof normalized === `function` ||
    typeof normalized === `symbol`
  ) {
    return referenceIdentity(normalized as object | symbol)
  }
  return normalized
}

function exactIdentity(
  value: unknown,
  referenceIdentity: ReferenceIdentity,
): unknown {
  if (
    (typeof value === `object` && value !== null) ||
    typeof value === `function` ||
    typeof value === `symbol`
  ) {
    return referenceIdentity(value as object | symbol)
  }
  if (typeof value === `number`) {
    if (Object.is(value, -0)) return [`number`, `-0`]
    if (Number.isNaN(value)) return [`number`, `NaN`]
  }
  return value
}

export function createValueIdentity(): ValueIdentity {
  const referenceIdentity = createRuntimeReferenceIdentityFactory()
  const equality = (value: unknown) =>
    equalityIdentity(value, referenceIdentity)
  return {
    equality,
    exact: (value) => exactIdentity(value, referenceIdentity),
    serializeEquality: (value) => serializeValue(equality(value)),
  }
}

/** Preserve the value relation used by equality predicates in keyed state. */
export function getEqualityValueIdentity(value: unknown): unknown {
  return equalityIdentity(value, getRuntimeReferenceIdentity)
}

export function serializeEqualityValue(value: unknown): string {
  return serializeValue(getEqualityValueIdentity(value))
}

/** Preserve exact output identity without traversing opaque runtime values. */
export function getExactValueIdentity(value: unknown): unknown {
  return exactIdentity(value, getRuntimeReferenceIdentity)
}

/** Keep compiler identity outside the namespace that holds user aliases. */
export function createParentContext(
  value: Record<string, unknown>,
  identity: unknown,
): ParentContext {
  return { [PARENT_CONTEXT]: true, value, identity }
}

function isParentContext(context: unknown): context is ParentContext {
  return (
    typeof context === `object` && context !== null && PARENT_CONTEXT in context
  )
}

export function getParentContextValue(
  context: unknown,
): Record<string, unknown> | undefined {
  if (isParentContext(context)) return context.value
  if (typeof context === `object` && context !== null) {
    return context as Record<string, unknown>
  }
  return undefined
}

/**
 * The envelope is structural D2 state, but its value keeps the user's alias
 * namespace separate from compiler identity. A later insert or retract can
 * therefore rebuild the same route without reserving a user-visible key.
 */
export function getParentContextIdentity(context: unknown): unknown {
  return isParentContext(context) ? context.identity : context
}

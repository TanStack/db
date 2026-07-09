import { hash } from './hash.js'

const objectProto = Object.prototype

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value)
  return proto === objectProto || proto === null
}

/**
 * Structural equality with early exit, used where the Index previously
 * compared `hash(a) === hash(b)` to decide whether two values are the same.
 * Hashing walks BOTH values completely (plus string building); this returns
 * on the first differing field — the common case for row updates.
 *
 * Must stay conservative relative to hash equality: plain data (primitives,
 * arrays, plain objects, Dates) is compared structurally; anything exotic
 * (Map/Set/Temporal/class instances) falls back to comparing hashes so the
 * equality relation never diverges from the hash-keyed storage below it.
 */
export function fastEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (typeof a !== `object` || a === null || b === null) {
    // Differing primitives (NaN !== NaN matches hash behavior of equal
    // hashes — NaN serializes identically, so treat NaN pairs as equal)
    return typeof a === `number` && Number.isNaN(a) && Number.isNaN(b as any)
  }

  const aIsArray = Array.isArray(a)
  const bIsArray = Array.isArray(b as object)
  if (aIsArray !== bIsArray) return false
  if (aIsArray) {
    const arrA = a as Array<unknown>
    const arrB = b as Array<unknown>
    if (arrA.length !== arrB.length) return false
    for (let i = 0; i < arrA.length; i++) {
      if (!fastEquals(arrA[i], arrB[i])) return false
    }
    return true
  }

  if (a instanceof Date || (b as object) instanceof Date) {
    return (
      a instanceof Date &&
      (b as object) instanceof Date &&
      a.getTime() === (b as Date).getTime()
    )
  }

  if (!isPlainObject(a) || !isPlainObject(b as object)) {
    return hash(a) === hash(b)
  }

  const objA = a as Record<string, unknown>
  const objB = b as Record<string, unknown>
  const keysA = Object.keys(objA)
  const keysB = Object.keys(objB)
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) return false
    if (!fastEquals(objA[key], objB[key])) return false
  }
  return true
}

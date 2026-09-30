import { MurmurHashStream, getSymbolIdentity, randomHash } from './murmur.js'
import { isTemporal } from './temporal.js'
import type { Hasher } from './murmur.js'

/*
 * Implementation of structural hashing based on the Composites polyfill implementation:
 * https://github.com/tc39/proposal-composites
 */

const TRUE = randomHash()
const FALSE = randomHash()
const NULL = randomHash()
const UNDEFINED = randomHash()
const KEY = randomHash()
const FUNCTIONS = randomHash()
const DATE_MARKER = randomHash()
const REGEXP_MARKER = randomHash()
const OBJECT_MARKER = randomHash()
const ARRAY_MARKER = randomHash()
const MAP_MARKER = randomHash()
const SET_MARKER = randomHash()
const UINT8ARRAY_MARKER = randomHash()
const TEMPORAL_MARKER = randomHash()
// Bound structural recursion and value visits. Shared acyclic subtrees are
// cached; cycles are rejected rather than given context-dependent hashes.
const MAX_STRUCTURAL_HASH_WORK = 1_000_000
const MAX_STRUCTURAL_HASH_DEPTH = 768

// Maximum byte length for Uint8Arrays to hash by content instead of reference
// Arrays smaller than this will be hashed by content, allowing proper equality comparisons
// for small arrays like ULIDs (16 bytes) while still avoiding performance costs for large arrays
const UINT8ARRAY_CONTENT_HASH_THRESHOLD = 128

const hashCache = new WeakMap<object, number>()
const referenceValues = new WeakSet<object>()

/** @internal Register a mutable handle before it enters a structural value. */
export function registerOpaqueHash(value: object): void {
  cachedReferenceHash(value)
}

type HashContext = {
  activeObjects: Set<object>
  work: number
  pendingHashes: Map<object, number>
}

export function hash(input: any): number {
  const hasher = new MurmurHashStream()
  updateHasher(hasher, input)
  return hasher.digest()
}

function hashObject(input: object, context: HashContext): number {
  if (context.activeObjects.size >= MAX_STRUCTURAL_HASH_DEPTH) {
    throw new RangeError(
      `Value is too complex to hash safely: structural depth`,
    )
  }

  context.activeObjects.add(input)

  let valueHash: number | undefined
  try {
    const [marker, header, body] = objectParts(input)
    const hasher = new MurmurHashStream()
    hasher.update(marker)
    // Header values of a type with a body (array length, RegExp fields)
    // count toward the work cap; Date, binary, and Temporal headers do not.
    for (const value of header)
      if (body) updateHasher(hasher, value, context)
      else hasher.update(value)
    if (body) {
      // Sorted string keys, then enumerable symbol keys by identity.
      const keys: Array<string | symbol> = Object.keys(body).sort(keySort)
      keys.push(
        ...Object.getOwnPropertySymbols(body)
          .filter((key) =>
            Object.prototype.propertyIsEnumerable.call(body, key),
          )
          .sort(
            (left, right) => getSymbolIdentity(left) - getSymbolIdentity(right),
          ),
      )
      for (const key of keys) {
        hasher.update(KEY)
        hasher.update(key)
        updateHasher(hasher, body[key as keyof typeof body], context)
      }
    }
    valueHash = hasher.digest()
  } finally {
    context.activeObjects.delete(input)
  }

  context.pendingHashes.set(input, valueHash)
  return valueHash
}

/**
 * The one type dispatch shared by structural hashing and equality: a type
 * marker, primitive header values, and an optional object whose enumerable
 * own properties are compared structurally.
 */
type ObjectParts = [
  marker: number,
  header: ReadonlyArray<string | number>,
  body?: object,
]

function objectParts(input: object): ObjectParts {
  if (input instanceof Date) return [DATE_MARKER, [input.getTime()]]
  if (isBinaryValue(input))
    return [
      UINT8ARRAY_MARKER,
      [String.fromCharCode.apply(null, input as unknown as Array<number>)],
    ]
  if (isTemporal(input))
    return [TEMPORAL_MARKER, [input[Symbol.toStringTag], input.toString()]]
  if (input instanceof RegExp)
    return [REGEXP_MARKER, [input.source, input.flags, input.lastIndex], input]
  if (input instanceof Map) return [MAP_MARKER, [], [...input.entries()]]
  if (input instanceof Set) return [SET_MARKER, [], [...input.values()]]
  return input instanceof Array
    ? [ARRAY_MARKER, [input.length], input]
    : [OBJECT_MARKER, [], input]
}

function updateHasher(
  hasher: Hasher,
  input: unknown,
  context?: HashContext,
): void {
  if (context && ++context.work > MAX_STRUCTURAL_HASH_WORK) {
    throw new RangeError(`Value is too complex to hash safely: structural work`)
  }
  if (input === null) {
    hasher.update(NULL)
    return
  }
  switch (typeof input) {
    case `undefined`:
      hasher.update(UNDEFINED)
      return
    case `boolean`:
      hasher.update(input ? TRUE : FALSE)
      return
    case `number`:
      // Normalize NaNs and -0
      hasher.update(isNaN(input) ? NaN : input === 0 ? 0 : input)
      return
    case `bigint`:
    case `string`:
    case `symbol`:
      hasher.update(input)
      return
    case `object`:
      hasher.update(getCachedHash(input, context))
      return
    case `function`:
      // Functions are assigned a globally unique ID
      // and that ID is cached in the weak map
      hasher.update(cachedReferenceHash(input))
  }
}

function getCachedHash(input: object, context?: HashContext): number {
  // Active objects are neither cached nor pending, so the cycle check below
  // still sees every back-reference.
  const cached = hashCache.get(input) ?? context?.pendingHashes.get(input)
  if (cached !== undefined) return cached

  // Opaque leaves cannot contain structural back-references. Resolve them
  // before entering structural recursion, even when they have user properties.
  if (isReferenceHashedObject(input)) return cachedReferenceHash(input)

  if (context) {
    if (context.activeObjects.has(input)) {
      throw new TypeError(`Cannot hash cyclic structural values`)
    }
    return hashObject(input, context)
  }

  // Only an uncached structural root needs graph traversal state. Commit its
  // cache entries after success so a failed traversal cannot poison retries.
  const root: HashContext = {
    activeObjects: new Set(),
    work: 0,
    pendingHashes: new Map(),
  }
  const result = hashObject(input, root)
  for (const [object, valueHash] of root.pendingHashes) {
    hashCache.set(object, valueHash)
  }
  return result
}

function isReferenceHashedObject(input: object): boolean {
  return (
    referenceValues.has(input) ||
    (typeof File !== `undefined` && input instanceof File) ||
    (isBinaryValue(input) &&
      input.byteLength > UINT8ARRAY_CONTENT_HASH_THRESHOLD)
  )
}

// Buffer can come from another realm than Uint8Array (for example under jsdom).
function isBinaryValue(input: object): input is Uint8Array {
  return (
    (typeof Buffer !== `undefined` && input instanceof Buffer) ||
    input instanceof Uint8Array
  )
}

/** @internal Compare immutable structural values without computing a digest.
 * Pair memoization also permits cyclic values that structural hashing rejects.
 * Reference-valued leaves remain opaque, including registered mutable handles.
 */
export function equalHashValues(left: unknown, right: unknown): boolean {
  const compared = new Map<object, Set<object>>()
  const keys = (value: object) =>
    Reflect.ownKeys(value).filter((key) =>
      Object.prototype.propertyIsEnumerable.call(value, key),
    )
  function equal(a: unknown, b: unknown): boolean {
    if (a === b || (Number.isNaN(a) && Number.isNaN(b))) return true
    if (
      a === null ||
      b === null ||
      typeof a !== `object` ||
      typeof b !== `object` ||
      isReferenceHashedObject(a) ||
      isReferenceHashedObject(b)
    )
      return false
    // Arrays from another realm take the object marker but keep this check.
    if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length)
      return false

    const [aMarker, aHeader, aBody] = objectParts(a)
    const [bMarker, bHeader, bBody] = objectParts(b)
    if (
      aMarker !== bMarker ||
      !aHeader.every((value, index) => equal(value, bHeader[index]))
    )
      return false
    if (!aBody || !bBody) return true

    // Revisited pairs close cycles and avoid expanding shared subtrees.
    const peers = compared.get(a)
    if (peers?.has(b)) return true
    if (peers) peers.add(b)
    else compared.set(a, new Set([b]))
    const aKeys = keys(aBody)
    return (
      aKeys.length === keys(bBody).length &&
      aKeys.every(
        (key) =>
          Object.prototype.propertyIsEnumerable.call(bBody, key) &&
          equal(aBody[key as keyof object], bBody[key as keyof object]),
      )
    )
  }
  return equal(left, right)
}

let nextRefId = 1
function cachedReferenceHash(fn: object): number {
  let valueHash = hashCache.get(fn)
  if (valueHash === undefined) {
    valueHash = nextRefId ^ FUNCTIONS
    nextRefId++
    hashCache.set(fn, valueHash)
    referenceValues.add(fn)
  }
  return valueHash
}

/**
 * Strings sorted lexicographically.
 */
function keySort(a: string, b: string): number {
  return a.localeCompare(b)
}

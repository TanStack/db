import { MurmurHashStream, getSymbolIdentity, randomHash } from './murmur.js'
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
const STRUCTURAL_MARKERS = {
  object: randomHash(),
  array: randomHash(),
  map: randomHash(),
  set: randomHash(),
}
const UINT8ARRAY_MARKER = randomHash()
const TEMPORAL_MARKER = randomHash()
// Bound structural recursion and value visits. Shared acyclic subtrees are
// cached; cycles are rejected rather than given context-dependent hashes.
const MAX_STRUCTURAL_HASH_WORK = 1_000_000
const MAX_STRUCTURAL_HASH_DEPTH = 768

const temporalTypes = new Set([
  `Temporal.Duration`,
  `Temporal.Instant`,
  `Temporal.PlainDate`,
  `Temporal.PlainDateTime`,
  `Temporal.PlainMonthDay`,
  `Temporal.PlainTime`,
  `Temporal.PlainYearMonth`,
  `Temporal.ZonedDateTime`,
])

interface TemporalLike {
  [Symbol.toStringTag]: string
  toString: () => string
}

function isTemporal(input: object): input is TemporalLike {
  const tag = (input as Record<symbol, unknown>)[Symbol.toStringTag]
  return typeof tag === `string` && temporalTypes.has(tag)
}

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
    if (input instanceof Date) {
      valueHash = hashDate(input)
    } else if (isBinaryValue(input)) {
      valueHash = hashUint8Array(input)
    } else if (isTemporal(input)) {
      valueHash = hashTemporal(input)
    } else {
      const [kind, plainObjectInput] = structuralShape(input)
      valueHash = hashPlainObject(
        plainObjectInput,
        STRUCTURAL_MARKERS[kind],
        context,
      )
    }
  } finally {
    context.activeObjects.delete(input)
  }

  context.pendingHashes.set(input, valueHash)
  return valueHash
}

function hashDate(input: Date): number {
  const hasher = new MurmurHashStream()
  hasher.update(DATE_MARKER)
  hasher.update(input.getTime())
  return hasher.digest()
}

function hashUint8Array(input: Uint8Array): number {
  const hasher = new MurmurHashStream()
  hasher.update(UINT8ARRAY_MARKER)
  // Hash the byte length first to differentiate arrays of different sizes
  hasher.update(input.byteLength)
  // Hash each byte in the array
  for (let i = 0; i < input.byteLength; i++) {
    hasher.writeByte(input[i]!)
  }
  return hasher.digest()
}

function hashTemporal(input: TemporalLike): number {
  const hasher = new MurmurHashStream()
  hasher.update(TEMPORAL_MARKER)
  hasher.update(input[Symbol.toStringTag])
  hasher.update(input.toString())
  return hasher.digest()
}

function hashPlainObject(
  input: object,
  marker: number,
  context: HashContext,
): number {
  const hasher = new MurmurHashStream()

  // Mark the type of the input
  hasher.update(marker)
  const keys = Object.keys(input)
  keys.sort(keySort)
  for (const key of keys) {
    hasher.update(KEY)
    hasher.update(key)
    updateHasher(hasher, input[key as keyof typeof input], context)
  }
  const symbolKeys = Object.getOwnPropertySymbols(input)
    .filter((key) => Object.prototype.propertyIsEnumerable.call(input, key))
    .sort((left, right) => getSymbolIdentity(left) - getSymbolIdentity(right))
  for (const key of symbolKeys) {
    hasher.update(KEY)
    hasher.update(key)
    updateHasher(hasher, input[key as keyof typeof input], context)
  }

  return hasher.digest()
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
      return
    default:
      console.warn(
        `Ignored input during hashing because it is of type ${typeof input} which is not supported`,
      )
  }
}

function getCachedHash(input: object, context?: HashContext): number {
  if (!context) {
    const cached = hashCache.get(input)
    if (cached !== undefined) return cached
    if (isReferenceHashedObject(input)) return cachedReferenceHash(input)

    // Only an uncached structural root needs graph traversal state. Commit its
    // cache entries after success so a failed traversal cannot poison retries.
    context = {
      activeObjects: new Set(),
      work: 0,
      pendingHashes: new Map(),
    }
    const result = hashObject(input, context)
    for (const [object, valueHash] of context.pendingHashes) {
      hashCache.set(object, valueHash)
    }
    return result
  }

  if (context.activeObjects.has(input)) {
    throw new TypeError(`Cannot hash cyclic structural values`)
  }

  // Opaque leaves cannot contain structural back-references. Resolve them
  // before entering structural recursion, even when they have user properties.
  if (isReferenceHashedObject(input)) return cachedReferenceHash(input)

  const valueHash = hashCache.get(input) ?? context.pendingHashes.get(input)
  if (valueHash !== undefined) return valueHash

  return hashObject(input, context)
}

function isReferenceHashedObject(input: object): boolean {
  return (
    input instanceof File ||
    (isBinaryValue(input) &&
      input.byteLength > UINT8ARRAY_CONTENT_HASH_THRESHOLD)
  )
}

function isBinaryValue(input: object): input is Uint8Array {
  return (
    (typeof Buffer !== `undefined` && input instanceof Buffer) ||
    input instanceof Uint8Array
  )
}

function structuralShape(
  input: object,
): [keyof typeof STRUCTURAL_MARKERS, object] {
  if (input instanceof Map) return [`map`, [...input.entries()]]
  if (input instanceof Set) return [`set`, [...input.values()]]
  return [input instanceof Array ? `array` : `object`, input]
}

/** @internal Resolve collisions using the structural hash domain, not the
 * digest. Call after hashing has validated the immutable structural inputs.
 * Reference-valued leaves remain opaque, including registered mutable handles.
 */
export function equalHashValues(left: unknown, right: unknown): boolean {
  const compared = new Map<object, Set<object>>()
  function equal(a: unknown, b: unknown): boolean {
    if (a === b || (Number.isNaN(a) && Number.isNaN(b))) return true
    if (
      a === null ||
      b === null ||
      typeof a !== `object` ||
      typeof b !== `object`
    )
      return false
    if (
      referenceValues.has(a) ||
      referenceValues.has(b) ||
      isReferenceHashedObject(a) ||
      isReferenceHashedObject(b)
    )
      return false
    if (a instanceof Date || b instanceof Date)
      return (
        a instanceof Date &&
        b instanceof Date &&
        equal(a.getTime(), b.getTime())
      )
    if (isBinaryValue(a) || isBinaryValue(b))
      return (
        isBinaryValue(a) &&
        isBinaryValue(b) &&
        a.byteLength === b.byteLength &&
        a.every((value, index) => value === b[index])
      )
    if (isTemporal(a) || isTemporal(b))
      return (
        isTemporal(a) &&
        isTemporal(b) &&
        a[Symbol.toStringTag] === b[Symbol.toStringTag] &&
        a.toString() === b.toString()
      )

    // Shared acyclic subtrees should not multiply comparison work.
    const peers = compared.get(a)
    if (peers?.has(b)) return true
    if (peers) peers.add(b)
    else compared.set(a, new Set([b]))
    const [aKind, aShape] = structuralShape(a)
    const [bKind, bShape] = structuralShape(b)
    if (aKind !== bKind) return false
    const keys = (value: object) =>
      Reflect.ownKeys(value).filter((key) =>
        Object.prototype.propertyIsEnumerable.call(value, key),
      )
    const aKeys = keys(aShape)
    if (aKeys.length !== keys(bShape).length) return false
    return aKeys.every(
      (key) =>
        Object.prototype.propertyIsEnumerable.call(bShape, key) &&
        equal(aShape[key as keyof object], bShape[key as keyof object]),
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

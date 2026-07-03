import { isPerfEnabled, recordPerfCount, startPerfSpan } from '../perf.js'
import { MurmurHashStream, randomHash } from './murmur.js'
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
const OBJECT_MARKER = randomHash()
const ARRAY_MARKER = randomHash()
const MAP_MARKER = randomHash()
const SET_MARKER = randomHash()
const UINT8ARRAY_MARKER = randomHash()
const TEMPORAL_MARKER = randomHash()

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

export function hash(input: unknown): number {
  if (!isPerfEnabled()) {
    const hasher = new MurmurHashStream()
    updateHasher(hasher, input)
    return hasher.digest()
  }

  const tags = { kind: getHashInputKind(input) }
  recordPerfCount(`hash.public.calls`, 1, tags)
  const span = startPerfSpan(`hash.public`, tags)
  try {
    const hasher = new MurmurHashStream()
    updateHasher(hasher, input)
    return hasher.digest()
  } finally {
    span.end()
  }
}

function hashObject(input: object): number {
  const cachedHash = hashCache.get(input)
  if (cachedHash !== undefined) {
    return cachedHash
  }

  const shouldTrace = isPerfEnabled()
  const tags = shouldTrace ? { kind: getHashInputKind(input) } : undefined
  const span = shouldTrace ? startPerfSpan(`hash.structural`, tags) : undefined
  let valueHash: number | undefined
  if (input instanceof Date) {
    valueHash = hashDate(input)
  } else if (
    // Check if input is a Uint8Array or Buffer
    (typeof Buffer !== `undefined` && input instanceof Buffer) ||
    input instanceof Uint8Array
  ) {
    // For small Uint8Arrays/Buffers (e.g., ULIDs, UUIDs), hash by content
    // to enable proper equality comparisons. For large arrays, hash by reference
    // to avoid performance costs.
    if (input.byteLength <= UINT8ARRAY_CONTENT_HASH_THRESHOLD) {
      valueHash = hashUint8Array(input)
    } else {
      // Deeply hashing large arrays would be too costly
      // so we track them by reference and cache them in a weak map
      valueHash = cachedReferenceHash(input)
    }
  } else if (typeof File !== `undefined` && input instanceof File) {
    // Files are always hashed by reference due to their potentially large size
    valueHash = cachedReferenceHash(input)
  } else if (isTemporal(input)) {
    valueHash = hashTemporal(input)
  } else {
    let plainObjectInput = input
    let marker = OBJECT_MARKER

    if (input instanceof Array) {
      valueHash = canHashDenseArrayByIndex(input)
        ? hashDenseArray(input)
        : hashPlainObject(input, ARRAY_MARKER)
    } else if (input instanceof Set) {
      marker = SET_MARKER
      plainObjectInput = [...input.entries()]

      valueHash = hashPlainObject(plainObjectInput, marker)
    } else {
      if (input instanceof Map) {
        marker = MAP_MARKER
        plainObjectInput = [...input.entries()]
      }

      valueHash = hashPlainObject(plainObjectInput, marker)
    }
  }

  hashCache.set(input, valueHash)
  span?.end()
  return valueHash
}

function hashDate(input: Date): number {
  const hasher = new MurmurHashStream()
  hasher.update(DATE_MARKER)
  hasher.update(input.getTime())
  return hasher.digest()
}

function hashUint8Array(input: Uint8Array): number {
  if (isPerfEnabled()) {
    recordPerfCount(`hash.uint8Array.calls`)
    recordPerfCount(`hash.uint8Array.bytes`, input.byteLength, {
      bucket: byteLengthBucket(input.byteLength),
    })
  }
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

function canHashDenseArrayByIndex(input: Array<unknown>): boolean {
  const keys = Object.keys(input)
  if (keys.length !== input.length) return false

  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== String(i)) return false
  }

  return true
}

function hashDenseArray(input: Array<unknown>): number {
  const hasher = new MurmurHashStream()
  hasher.update(ARRAY_MARKER)

  if (isPerfEnabled()) {
    recordPerfCount(`hash.denseArray.keys`, input.length)
  }

  for (let i = 0; i < input.length; i++) {
    hasher.update(KEY)
    hasher.update(String(i))
    if (isPerfEnabled()) {
      recordPerfCount(`hash.denseArray.nestedValues`)
    }
    updateHasher(hasher, input[i])
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

function hashPlainObject(input: object, marker: number): number {
  const hasher = new MurmurHashStream()

  // Mark the type of the input
  hasher.update(marker)
  const keys = Object.keys(input)
  const sortSpan = isPerfEnabled()
    ? startPerfSpan(`hash.plainObject.keySort`, {
        keyCount: keys.length,
      })
    : undefined
  keys.sort()
  sortSpan?.end()
  if (isPerfEnabled()) {
    recordPerfCount(`hash.plainObject.keys`, keys.length)
  }
  for (const key of keys) {
    hasher.update(KEY)
    hasher.update(key)
    if (isPerfEnabled()) {
      recordPerfCount(`hash.plainObject.nestedValues`)
    }
    updateHasher(hasher, input[key as keyof typeof input])
  }

  return hasher.digest()
}

function updateHasher(hasher: Hasher, input: unknown): void {
  const shouldTrace = isPerfEnabled()
  if (input === null) {
    if (shouldTrace) {
      recordPerfCount(`hash.primitive.calls`, 1, { kind: `null` })
    }
    hasher.update(NULL)
    return
  }
  switch (typeof input) {
    case `undefined`:
      if (shouldTrace) {
        recordPerfCount(`hash.primitive.calls`, 1, { kind: `undefined` })
      }
      hasher.update(UNDEFINED)
      return
    case `boolean`:
      if (shouldTrace) {
        recordPerfCount(`hash.primitive.calls`, 1, { kind: `boolean` })
      }
      hasher.update(input ? TRUE : FALSE)
      return
    case `number`:
      if (shouldTrace) {
        recordPerfCount(`hash.primitive.calls`, 1, { kind: `number` })
      }
      // Normalize NaNs and -0
      hasher.update(isNaN(input) ? NaN : input === 0 ? 0 : input)
      return
    case `bigint`:
    case `string`:
    case `symbol`:
      if (shouldTrace) {
        recordPerfCount(`hash.primitive.calls`, 1, { kind: typeof input })
      }
      hasher.update(input)
      return
    case `object`:
      hasher.update(getCachedHash(input))
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

function getCachedHash(input: object): number {
  let valueHash = hashCache.get(input)
  if (valueHash === undefined) {
    if (isPerfEnabled()) {
      recordPerfCount(`hash.objectCache.misses`, 1, {
        kind: getHashInputKind(input),
      })
    }
    valueHash = hashObject(input)
  } else if (isPerfEnabled()) {
    recordPerfCount(`hash.objectCache.hits`, 1, {
      kind: getHashInputKind(input),
    })
  }
  return valueHash
}

let nextRefId = 1
function cachedReferenceHash(fn: object): number {
  let valueHash = hashCache.get(fn)
  if (valueHash === undefined) {
    if (isPerfEnabled()) {
      recordPerfCount(`hash.reference.misses`, 1, {
        kind: getHashInputKind(fn),
      })
    }
    valueHash = nextRefId ^ FUNCTIONS
    nextRefId++
    hashCache.set(fn, valueHash)
  } else if (isPerfEnabled()) {
    recordPerfCount(`hash.reference.hits`, 1, {
      kind: getHashInputKind(fn),
    })
  }
  if (isPerfEnabled()) {
    recordPerfCount(`hash.reference.calls`, 1, {
      kind: getHashInputKind(fn),
    })
  }
  return valueHash
}

function getHashInputKind(input: unknown): string {
  if (input === null) return `null`
  if (typeof input !== `object`) return typeof input
  if (input instanceof Date) return `date`
  if (
    (typeof Buffer !== `undefined` && input instanceof Buffer) ||
    input instanceof Uint8Array
  ) {
    return `uint8Array`
  }
  if (typeof File !== `undefined` && input instanceof File) return `file`
  if (isTemporal(input)) return `temporal`
  if (Array.isArray(input)) return `array`
  if (input instanceof Map) return `map`
  if (input instanceof Set) return `set`
  return `plainObject`
}

function byteLengthBucket(byteLength: number): string {
  if (byteLength <= 16) return `0-16`
  if (byteLength <= 128) return `17-128`
  if (byteLength <= 1024) return `129-1024`
  return `1025+`
}

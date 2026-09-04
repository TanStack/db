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
const OBJECT_MARKER = randomHash()
const ARRAY_MARKER = randomHash()
const MAP_MARKER = randomHash()
const SET_MARKER = randomHash()
const UINT8ARRAY_MARKER = randomHash()
const TEMPORAL_MARKER = randomHash()
const CYCLE_MARKER = randomHash()

// A cyclic subgraph can be reached under exponentially many distinct active
// ancestor contexts. Reject that adversarial shape instead of letting one row
// monopolize the graph turn. Ordinary cyclic values use far fewer traversals.
const MAX_CYCLIC_TRAVERSALS = 512

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

type HashContext = {
  activeObjects: Map<object, number>
  activeOrder: Array<object>
  cyclicObjects: Set<object>
  frames: Array<HashFrame>
  traversalHashes: WeakMap<object, Array<TraversalHash>>
  cyclicTraversals: number
}

type HashDependency = {
  object: object
  offset: number
}

type HashFrame = {
  startIndex: number
  visitedObjects: Set<object>
  externalDependencies: Array<HashDependency>
}

type TraversalHash = Pick<
  HashFrame,
  `visitedObjects` | `externalDependencies`
> & {
  valueHash: number
}

export function hash(input: any): number {
  const hasher = new MurmurHashStream()
  updateHasher(hasher, input, {
    activeObjects: new Map(),
    activeOrder: [],
    cyclicObjects: new Set(),
    frames: [],
    traversalHashes: new WeakMap(),
    cyclicTraversals: 0,
  })
  return hasher.digest()
}

function hashObject(input: object, context: HashContext): number {
  const cachedHash = hashCache.get(input)
  if (cachedHash !== undefined) {
    return cachedHash
  }

  const startIndex = context.activeOrder.length
  for (const frame of context.frames) frame.visitedObjects.add(input)
  const frame: HashFrame = {
    startIndex,
    visitedObjects: new Set([input]),
    externalDependencies: [],
  }
  context.frames.push(frame)
  context.activeObjects.set(input, startIndex)
  context.activeOrder.push(input)

  let valueHash: number | undefined
  try {
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
        return cachedReferenceHash(input)
      }
    } else if (input instanceof File) {
      // Files are always hashed by reference due to their potentially large size
      return cachedReferenceHash(input)
    } else if (isTemporal(input)) {
      valueHash = hashTemporal(input)
    } else {
      let plainObjectInput = input
      let marker = OBJECT_MARKER

      if (input instanceof Array) {
        marker = ARRAY_MARKER
      }

      if (input instanceof Map) {
        marker = MAP_MARKER
        plainObjectInput = [...input.entries()]
      }

      if (input instanceof Set) {
        marker = SET_MARKER
        plainObjectInput = [...input.entries()]
      }

      valueHash = hashPlainObject(plainObjectInput, marker, context)
    }
  } finally {
    context.activeObjects.delete(input)
    context.activeOrder.pop()
    context.frames.pop()
  }

  if (context.cyclicObjects.has(input)) {
    context.cyclicTraversals++
    if (context.cyclicTraversals > MAX_CYCLIC_TRAVERSALS) {
      throw new RangeError(`Cyclic value is too complex to hash safely`)
    }
    const traversalHashes = context.traversalHashes.get(input) ?? []
    traversalHashes.push({ valueHash, ...frame })
    context.traversalHashes.set(input, traversalHashes)
  } else {
    hashCache.set(input, valueHash)
  }
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
  context: HashContext,
): void {
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

function getCachedHash(input: object, context: HashContext): number {
  const activeIndex = context.activeObjects.get(input)
  if (activeIndex !== undefined) {
    for (let index = activeIndex; index < context.activeOrder.length; index++) {
      context.cyclicObjects.add(context.activeOrder[index]!)
    }
    for (const frame of context.frames) {
      if (activeIndex < frame.startIndex) {
        addDependency(frame, input, activeIndex - frame.startIndex)
      }
    }
    const hasher = new MurmurHashStream()
    hasher.update(CYCLE_MARKER)
    hasher.update(context.activeOrder.length - activeIndex - 1)
    return hasher.digest()
  }

  const valueHash = hashCache.get(input)
  if (valueHash !== undefined) return valueHash

  const startIndex = context.activeOrder.length
  const traversalHash = context.traversalHashes
    .get(input)
    ?.find(
      (candidate) =>
        [...candidate.visitedObjects].every(
          (object) => !context.activeObjects.has(object),
        ) &&
        candidate.externalDependencies.every(
          (dependency) =>
            context.activeObjects.get(dependency.object) ===
            startIndex + dependency.offset,
        ),
    )
  if (traversalHash) {
    adoptTraversalHash(traversalHash, context)
    return traversalHash.valueHash
  }

  return hashObject(input, context)
}

function addDependency(frame: HashFrame, object: object, offset: number): void {
  if (
    !frame.externalDependencies.some(
      (dependency) =>
        dependency.object === object && dependency.offset === offset,
    )
  ) {
    frame.externalDependencies.push({ object, offset })
  }
}

/** Merge a reused subtree's graph footprint into every active parent frame. */
function adoptTraversalHash(
  traversalHash: TraversalHash,
  context: HashContext,
): void {
  for (const frame of context.frames) {
    for (const object of traversalHash.visitedObjects) {
      frame.visitedObjects.add(object)
    }
    for (const dependency of traversalHash.externalDependencies) {
      const activeIndex = context.activeObjects.get(dependency.object)!
      if (activeIndex < frame.startIndex) {
        addDependency(frame, dependency.object, activeIndex - frame.startIndex)
      }
      for (
        let index = activeIndex;
        index < context.activeOrder.length;
        index++
      ) {
        context.cyclicObjects.add(context.activeOrder[index]!)
      }
    }
  }
}

let nextRefId = 1
function cachedReferenceHash(fn: object): number {
  let valueHash = hashCache.get(fn)
  if (valueHash === undefined) {
    valueHash = nextRefId ^ FUNCTIONS
    nextRefId++
    hashCache.set(fn, valueHash)
  }
  return valueHash
}

/**
 * Strings sorted lexicographically.
 */
function keySort(a: string, b: string): number {
  return a.localeCompare(b)
}

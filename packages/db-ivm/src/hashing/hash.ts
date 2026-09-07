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
// ancestor contexts, and checking or adopting cached traversals can itself do
// too much work. Bound those graph-specific costs: cache matching and adoption,
// graph-context bookkeeping, and structural recursion depth.
const MAX_CYCLIC_CACHE_WORK = 65_536
const MAX_GRAPH_CONTEXT_WORK = 1_000_000
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

type HashContext = {
  activeObjects: Map<object, number>
  activeOrder: Array<object>
  cyclicObjects: Set<object>
  frames: Array<HashFrame>
  traversalHashes: WeakMap<object, Array<TraversalHash>>
  cyclicCacheWork: number
  graphContextWork: number
  pendingHashes: Map<object, number>
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
  const context: HashContext = {
    activeObjects: new Map(),
    activeOrder: [],
    cyclicObjects: new Set(),
    frames: [],
    traversalHashes: new WeakMap(),
    cyclicCacheWork: 0,
    graphContextWork: 0,
    pendingHashes: new Map(),
  }
  updateHasher(hasher, input, context)
  for (const [object, valueHash] of context.pendingHashes) {
    hashCache.set(object, valueHash)
  }
  return hasher.digest()
}

function hashObject(input: object, context: HashContext): number {
  if (context.activeOrder.length >= MAX_STRUCTURAL_HASH_DEPTH) {
    throw new RangeError(
      `Value is too complex to hash safely: structural depth`,
    )
  }

  const startIndex = context.activeOrder.length
  for (const frame of context.frames) {
    consumeGraphContextWork(context)
    frame.visitedObjects.add(input)
  }
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
    } else if (isBinaryValue(input)) {
      valueHash = hashUint8Array(input)
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
    const traversalHashes = context.traversalHashes.get(input) ?? []
    traversalHashes.push({ valueHash, ...frame })
    context.traversalHashes.set(input, traversalHashes)
  } else {
    context.pendingHashes.set(input, valueHash)
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
      consumeGraphContextWork(context)
      context.cyclicObjects.add(context.activeOrder[index]!)
    }
    for (const frame of context.frames) {
      consumeGraphContextWork(context)
      if (activeIndex < frame.startIndex) {
        addDependency(frame, input, activeIndex - frame.startIndex, context)
      }
    }
    const hasher = new MurmurHashStream()
    hasher.update(CYCLE_MARKER)
    hasher.update(context.activeOrder.length - activeIndex - 1)
    return hasher.digest()
  }

  // Opaque leaves cannot contain structural back-references. Resolve them
  // before entering a traversal frame so their reference cache cannot alter a
  // failed structural retry's work budget.
  if (isReferenceHashedObject(input)) return cachedReferenceHash(input)

  const valueHash = hashCache.get(input) ?? context.pendingHashes.get(input)
  if (valueHash !== undefined) return valueHash

  const startIndex = context.activeOrder.length
  const traversalHash = findReusableTraversalHash(input, startIndex, context)
  if (traversalHash) {
    adoptTraversalHash(traversalHash, context)
    return traversalHash.valueHash
  }

  return hashObject(input, context)
}

function findReusableTraversalHash(
  input: object,
  startIndex: number,
  context: HashContext,
): TraversalHash | undefined {
  for (const candidate of context.traversalHashes.get(input) ?? []) {
    let reusable = true
    for (const object of candidate.visitedObjects) {
      consumeCyclicCacheWork(context)
      if (context.activeObjects.has(object)) {
        reusable = false
        break
      }
    }
    if (!reusable) continue

    for (const dependency of candidate.externalDependencies) {
      consumeCyclicCacheWork(context)
      if (
        context.activeObjects.get(dependency.object) !==
        startIndex + dependency.offset
      ) {
        reusable = false
        break
      }
    }
    if (reusable) return candidate
  }
  return undefined
}

function addDependency(
  frame: HashFrame,
  object: object,
  offset: number,
  context: HashContext,
): void {
  for (const dependency of frame.externalDependencies) {
    consumeGraphContextWork(context)
    if (dependency.object === object && dependency.offset === offset) return
  }
  frame.externalDependencies.push({ object, offset })
}

/** Merge a reused subtree's graph footprint into every active parent frame. */
function adoptTraversalHash(
  traversalHash: TraversalHash,
  context: HashContext,
): void {
  for (const frame of context.frames) {
    for (const object of traversalHash.visitedObjects) {
      consumeCyclicCacheWork(context)
      frame.visitedObjects.add(object)
    }
    for (const dependency of traversalHash.externalDependencies) {
      consumeCyclicCacheWork(context)
      const activeIndex = context.activeObjects.get(dependency.object)!
      if (activeIndex < frame.startIndex) {
        addDependency(
          frame,
          dependency.object,
          activeIndex - frame.startIndex,
          context,
        )
      }
      for (
        let index = activeIndex;
        index < context.activeOrder.length;
        index++
      ) {
        consumeCyclicCacheWork(context)
        context.cyclicObjects.add(context.activeOrder[index]!)
      }
    }
  }
}

function consumeCyclicCacheWork(context: HashContext): void {
  context.cyclicCacheWork++
  if (context.cyclicCacheWork > MAX_CYCLIC_CACHE_WORK) {
    throw new RangeError(
      `Value is too complex to hash safely: cyclic cache work`,
    )
  }
}

function consumeGraphContextWork(context: HashContext): void {
  context.graphContextWork++
  if (context.graphContextWork > MAX_GRAPH_CONTEXT_WORK) {
    throw new RangeError(
      `Value is too complex to hash safely: graph context work`,
    )
  }
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

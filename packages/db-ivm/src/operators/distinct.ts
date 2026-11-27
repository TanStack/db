import { UnaryOperator } from '../graph.js'
import { unaryOperator } from '../unary-operator.js'
import { hash } from '../hashing/index.js'
import { equalHashValues } from '../hashing/hash.js'
import { MultiSet } from '../multiset.js'
import type { Hash } from '../hashing/index.js'
import type {
  DifferenceStreamReader,
  DifferenceStreamWriter,
} from '../graph.js'
import type { KeyValue } from '../types.js'

type GetValue<T> = T extends KeyValue<unknown, infer V> ? V : never

// Inputs supporting one selection, bucketed by their key's digest so that a
// payload outside the selection need not be hashable. Equal inputs share a
// count, so a fresh copy retracts its original, while a deep-equal row
// replacement compares apart.
type Support<T> = Map<Hash, Array<[input: T, multiplicity: number]>>

// Digests are unsigned, so keys outside the hashing domain, such as cyclic
// ones, share this bucket and are told apart by equality alone.
const UNHASHABLE_KEY = -1

function keyDigest(key: unknown): Hash {
  try {
    return hash(key)
  } catch {
    return UNHASHABLE_KEY
  }
}

type DistinctEntry<T> = {
  identity: unknown
  key: number
  // The input whose row was emitted, kept for its eventual retraction. Inputs
  // can differ even when the selected identity is equal.
  shown: T
  multiplicity: number
  visible: boolean
  support: Support<T>
}

function addSupport<T extends KeyValue<unknown, unknown>>(
  support: Support<T>,
  input: T,
  diff: number,
): void {
  // An input of weight zero supports nothing.
  if (diff === 0) return
  const digest = keyDigest(input[0])
  let inputs = support.get(digest)
  if (!inputs) support.set(digest, (inputs = []))
  const index = inputs.findIndex(([held]) => equalHashValues(held, input))
  if (index < 0) {
    inputs.push([input, diff])
    return
  }
  const held = inputs[index]!
  held[1] += diff
  if (held[1] !== 0) return
  inputs.splice(index, 1)
  if (inputs.length === 0) support.delete(digest)
}

function isSupported<T extends KeyValue<unknown, unknown>>(
  support: Support<T>,
  input: T,
): boolean {
  return (support.get(keyDigest(input[0])) ?? []).some(([held]) =>
    equalHashValues(held, input),
  )
}

// A visible selection has a positive total, so at least one input remains.
function firstSupported<T>(support: Support<T>): T {
  return support.values().next().value![0]![0]
}

/**
 * Operator that removes duplicates
 */
export class DistinctOperator<
  T extends KeyValue<unknown, unknown>,
> extends UnaryOperator<T, KeyValue<number, GetValue<T>>> {
  #by: (value: T) => unknown
  #values = new Map<Hash, Array<DistinctEntry<T>>>()
  // Hash digests are unsigned. Negative keys give collisions a separate identity.
  #nextCollisionKey = 0

  constructor(
    id: number,
    input: DifferenceStreamReader<T>,
    output: DifferenceStreamWriter<KeyValue<number, GetValue<T>>>,
    by: (value: T) => unknown = (value: T) => value,
  ) {
    super(id, input, output)
    this.#by = by
  }

  run(): void {
    const updatedBuckets = new Set<Hash>()

    // Compute the new multiplicity for each value
    for (const message of this.inputMessages()) {
      for (const [value, diff] of message.getInner()) {
        const identity = this.#by(value)
        const hashedValue = hash(identity)
        let bucket = this.#values.get(hashedValue)
        if (!bucket) this.#values.set(hashedValue, (bucket = []))
        let entry = bucket.find((candidate) =>
          equalHashValues(candidate.identity, identity),
        )
        if (!entry) {
          entry = {
            identity,
            key: bucket.length ? --this.#nextCollisionKey : hashedValue,
            shown: value,
            multiplicity: 0,
            visible: false,
            support: new Map(),
          }
          bucket.push(entry)
        }
        updatedBuckets.add(hashedValue)
        entry.multiplicity += diff
        addSupport(entry.support, value, diff)
      }
    }

    const result: Array<[KeyValue<number, GetValue<T>>, number]> = []

    // Decide visibility and remove zero support only after the whole batch.
    // Cancelling changes must retain the same entry and output key.
    for (const hashedValue of updatedBuckets) {
      const bucket = this.#values.get(hashedValue)!
      let retained = 0
      for (const entry of bucket) {
        const { key, shown: previous, support, visible: wasVisible } = entry
        const visible = entry.multiplicity > 0
        // A selection that stays visible must not outlive the row it shows.
        if (visible && !isSupported(support, previous))
          entry.shown = firstSupported(support)
        const replaced = entry.shown !== previous
        if (wasVisible && (!visible || replaced))
          result.push([[key, previous[1] as GetValue<T>], -1])
        if (visible && (!wasVisible || replaced))
          result.push([[key, entry.shown[1] as GetValue<T>], 1])
        entry.visible = visible
        if (entry.multiplicity !== 0) bucket[retained++] = entry
      }
      bucket.length = retained
      if (retained === 0) this.#values.delete(hashedValue)
    }

    if (result.length > 0) {
      this.output.sendData(new MultiSet(result))
    }
  }
}

/**
 * Removes duplicate values
 */
export function distinct<T extends KeyValue<unknown, unknown>>(
  by?: (value: T) => unknown,
) {
  return unaryOperator(DistinctOperator<T>, by)
}

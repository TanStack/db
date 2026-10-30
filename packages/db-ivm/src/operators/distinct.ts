import { DifferenceStreamWriter, UnaryOperator } from '../graph.js'
import { StreamBuilder } from '../d2.js'
import { hash } from '../hashing/index.js'
import { equalHashValues } from '../hashing/hash.js'
import { MultiSet } from '../multiset.js'
import type { Hash } from '../hashing/index.js'
import type { DifferenceStreamReader } from '../graph.js'
import type { IStreamBuilder, KeyValue } from '../types.js'

type GetValue<T> = T extends KeyValue<unknown, infer V> ? V : never

// Keep the emitted row for its eventual retraction. Input representatives can
// differ even when the selected identity is equal.
type DistinctEntry<V> = [
  identity: unknown,
  row: KeyValue<number, V>,
  multiplicity: number,
  visible: boolean,
]

/**
 * Operator that removes duplicates
 */
export class DistinctOperator<
  T extends KeyValue<unknown, unknown>,
> extends UnaryOperator<T, KeyValue<number, GetValue<T>>> {
  #by: (value: T) => unknown
  #values = new Map<Hash, Array<DistinctEntry<GetValue<T>>>>()
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
        let entry = bucket.find(
          ([candidate]) =>
            candidate === identity || equalHashValues(candidate, identity),
        )
        if (!entry) {
          entry = [
            identity,
            [
              bucket.length ? --this.#nextCollisionKey : hashedValue,
              value[1] as GetValue<T>,
            ],
            0,
            false,
          ]
          bucket.push(entry)
        }
        updatedBuckets.add(hashedValue)
        entry[2] += diff
      }
    }

    const result: Array<[KeyValue<number, GetValue<T>>, number]> = []

    // Decide visibility and remove zero support only after the whole batch.
    // Cancelling changes must retain the same entry and output key.
    for (const hashedValue of updatedBuckets) {
      const bucket = this.#values.get(hashedValue)!
      let retained = 0
      for (const entry of bucket) {
        const [, row, multiplicity, wasVisible] = entry
        const visible = multiplicity > 0
        if (visible !== wasVisible) result.push([row, visible ? 1 : -1])
        entry[3] = visible
        if (multiplicity !== 0) bucket[retained++] = entry
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
  return (
    stream: IStreamBuilder<T>,
  ): IStreamBuilder<KeyValue<number, GetValue<T>>> => {
    const output = new StreamBuilder<KeyValue<number, GetValue<T>>>(
      stream.graph,
      new DifferenceStreamWriter<KeyValue<number, GetValue<T>>>(),
    )
    const operator = new DistinctOperator<T>(
      stream.graph.getNextOperatorId(),
      stream.connectReader(),
      output.writer,
      by,
    )
    stream.graph.addOperator(operator)
    return output
  }
}

import { DifferenceStreamWriter, UnaryOperator } from '../graph.js'
import { StreamBuilder } from '../d2.js'
import { MultiSet } from '../multiset.js'
import { Index } from '../indexes.js'
import type { DifferenceStreamReader } from '../graph.js'
import type { IStreamBuilder, KeyValue } from '../types.js'

/** The key identity of a Map: SameValueZero, so NaN equals NaN. */
function sameOutput(left: unknown, right: unknown): boolean {
  return left === right || (left !== left && right !== right)
}

/** The value a Map stores as a key: -0 becomes 0. */
function asMapKey<T>(value: T): T {
  return (value === 0 ? 0 : value) as T
}

/**
 * Base operator for reduction operations (version-free)
 */
export class ReduceOperator<K, V1, V2> extends UnaryOperator<[K, V1], [K, V2]> {
  // Reduce never reads presence, so its indexes skip that bookkeeping.
  #index: Index<K, V1>
  #indexOut = new Index<K, V2>({ trackPresence: false })
  #f: (values: Array<[V1, number]>) => Array<[V2, number]>

  constructor(
    id: number,
    inputA: DifferenceStreamReader<[K, V1]>,
    output: DifferenceStreamWriter<[K, V2]>,
    f: (values: Array<[V1, number]>) => Array<[V2, number]>,
    options?: ReduceOptions,
  ) {
    super(id, inputA, output)
    this.#index = new Index<K, V1>({ ...options, trackPresence: false })
    this.#f = f
  }

  run(): void {
    // Collect all input messages and update the index
    const keysTodo = new Set<K>()
    for (const message of this.inputMessages()) {
      for (const [item, multiplicity] of message.getInner()) {
        const [key, value] = item
        this.#index.addValue(key, [value, multiplicity])
        keysTodo.add(key)
      }
    }

    // For each key, compute the reduction and delta
    const result: Array<[[K, V2], number]> = []
    for (const key of keysTodo) {
      const curr = this.#index.get(key)
      const currOut = this.#indexOut.get(key)
      const out = this.#f(curr)

      // Most keys have at most one output before and after. Compare the two
      // directly, by the SameValueZero identity the maps below use.
      if (out.length <= 1 && currOut.length <= 1) {
        // Earlier outputs were stored as Map keys, so only the new one needs it.
        const before = currOut[0]
        const after = out[0]
        const value = after === undefined ? undefined : asMapKey(after[0])
        if (
          before !== undefined &&
          after !== undefined &&
          sameOutput(before[0], value)
        ) {
          const delta = after[1] - before[1]
          if (delta !== 0) {
            result.push([[key, before[0]], delta])
            this.#indexOut.addValue(key, [before[0], delta])
          }
          continue
        }
        if (before !== undefined) {
          result.push([[key, before[0]], -before[1]])
          this.#indexOut.addValue(key, [before[0], -before[1]])
        }
        if (after !== undefined && after[1] !== 0) {
          result.push([[key, value as V2], after[1]])
          this.#indexOut.addValue(key, [value as V2, after[1]])
        }
        continue
      }

      // Create maps for current and previous outputs using values directly as keys
      const newOutputMap = new Map<V2, number>()
      const oldOutputMap = new Map<V2, number>()

      // Process new output
      for (const [value, multiplicity] of out) {
        const existing = newOutputMap.get(value) ?? 0
        newOutputMap.set(value, existing + multiplicity)
      }

      // Process previous output
      for (const [value, multiplicity] of currOut) {
        const existing = oldOutputMap.get(value) ?? 0
        oldOutputMap.set(value, existing + multiplicity)
      }

      // First, emit removals for old values that are no longer present
      for (const [value, multiplicity] of oldOutputMap) {
        if (!newOutputMap.has(value)) {
          // Remove the old value entirely
          result.push([[key, value], -multiplicity])
          this.#indexOut.addValue(key, [value, -multiplicity])
        }
      }

      // Then, emit additions for new values that are not present in old
      for (const [value, multiplicity] of newOutputMap) {
        if (!oldOutputMap.has(value)) {
          // Add the new value only if it has non-zero multiplicity
          if (multiplicity !== 0) {
            result.push([[key, value], multiplicity])
            this.#indexOut.addValue(key, [value, multiplicity])
          }
        }
      }

      // Finally, emit multiplicity changes for values that were present and are still present
      for (const [value, newMultiplicity] of newOutputMap) {
        const oldMultiplicity = oldOutputMap.get(value)
        if (oldMultiplicity !== undefined) {
          const delta = newMultiplicity - oldMultiplicity
          // Only emit actual changes, i.e. non-zero deltas
          if (delta !== 0) {
            result.push([[key, value], delta])
            this.#indexOut.addValue(key, [value, delta])
          }
        }
      }
    }

    if (result.length > 0) {
      this.output.sendData(new MultiSet(result))
    }
  }
}

/** @internal groupBy's option; its producer must keep the identity exact. */
export type ReduceOptions = {
  /**
   * Input values are `[identity, value]` with a string or number identity
   * that determines the value: two inputs under one key with an equal
   * identity are equal. They merge without a structural hash.
   */
  prefixIdentity?: boolean
}

/**
 * Reduces the elements in the stream by key (version-free)
 */
export function reduce<
  KType extends (T extends KeyValue<infer K, infer _V> ? K : never),
  V1Type extends (T extends KeyValue<KType, infer V> ? V : never),
  R,
  T,
>(
  f: (values: Array<[V1Type, number]>) => Array<[R, number]>,
  options?: ReduceOptions,
) {
  return (stream: IStreamBuilder<T>): IStreamBuilder<KeyValue<KType, R>> => {
    const output = new StreamBuilder<KeyValue<KType, R>>(
      stream.graph,
      new DifferenceStreamWriter<KeyValue<KType, R>>(),
    )
    const operator = new ReduceOperator<KType, V1Type, R>(
      stream.graph.getNextOperatorId(),
      stream.connectReader() as DifferenceStreamReader<KeyValue<KType, V1Type>>,
      output.writer,
      f,
      options,
    )
    stream.graph.addOperator(operator)
    return output
  }
}

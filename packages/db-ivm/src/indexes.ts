import { withSpan } from "@tanstack/db-tracing"
import { MultiSet } from "./multiset.js"
import { HashIndex } from "./hashIndex.js"
import { ValueIndex } from "./valueIndex.js"
import { concatIterable, mapIterable } from "./utils.js"

/**
 * A map from a difference collection trace's keys -> (value, multiplicities) that changed.
 * Used in operations like join and reduce where the operation needs to
 * exploit the key-value structure of the data to run efficiently.
 */
export class Index<K, V> {
  /*
   * This is a hybrid Index that composes a ValueIndex and a HashIndex.
   * Keys that have only one value are stored in the ValueIndex.
   * Keys that have multiple values are stored in the HashIndex, the hash distinguishes between the values.
   * This reduces the amount of hashes we need to compute since often times only a small portion of the keys are updated
   * so we don't have to hash the keys that are never updated.
   *
   * Note: The `valueIndex` and `hashIndex` have disjoint keys.
   *       When a key that has only one value gets a new distinct value,
   *       it is added to the `hashIndex` and removed from the `valueIndex` and vice versa.
   */
  #valueIndex: ValueIndex<K, V>
  #hashIndex: HashIndex<K, V>

  constructor() {
    this.#valueIndex = new ValueIndex<K, V>()
    this.#hashIndex = new HashIndex<K, V>()
  }

  toString(indent = false): string {
    return `Index(\n  ${this.#valueIndex.toString(indent)},\n  ${this.#hashIndex.toString(indent)}\n)`
  }

  get(key: K): Array<[V, number]> {
    if (this.#valueIndex.has(key)) {
      return [this.#valueIndex.get(key)!]
    }
    return this.#hashIndex.get(key)
  }

  getMultiplicity(key: K, value: V): number {
    if (this.#valueIndex.has(key)) {
      return this.#valueIndex.getMultiplicity(key)
    }
    return this.#hashIndex.getMultiplicity(key, value)
  }

  /**
   * This returns an iterator that iterates over all key-value pairs.
   * @returns An iterable of all key-value pairs (and their multiplicities) in the index.
   */
  #entries(): Iterable<[K, [V, number]]> {
    return concatIterable(
      this.#valueIndex.entries(),
      this.#hashIndex.entriesIterator()
    )
  }

  /**
   * This method only iterates over the keys and not over the values.
   * Hence, it is more efficient than the `#entries` method.
   * It returns an iterator that you can use if you need to iterate over the values for a given key.
   * @returns An iterator of all *keys* in the index and their corresponding value iterator.
   */
  *#entriesIterators(): Iterable<[K, Iterable<[V, number]>]> {
    for (const [key, [value, multiplicity]] of this.#valueIndex.entries()) {
      yield [key, new Map<V, number>([[value, multiplicity]])]
    }
    for (const [key, valueMap] of this.#hashIndex.entries()) {
      yield [
        key,
        mapIterable(valueMap, ([_hash, [value, multiplicity]]) => [
          value,
          multiplicity,
        ]),
      ]
    }
  }

  has(key: K): boolean {
    return this.#valueIndex.has(key) || this.#hashIndex.has(key)
  }

  get size(): number {
    return this.#valueIndex.size + this.#hashIndex.size
  }

  addValue(key: K, value: [V, number]): void {
    return withSpan(
      `indexes.addValue`,
      () => {
        const containedInValueIndex = this.#valueIndex.has(key)
        const containedInHashIndex = this.#hashIndex.has(key)

        if (containedInHashIndex && containedInValueIndex) {
          throw new Error(
            `Key ${key} is contained in both the value index and the hash index. This should never happen because they should have disjoint keysets.`
          )
        }

        if (!containedInValueIndex && !containedInHashIndex) {
          // This is the first time we see the key
          // Add it to the value index
          this.#valueIndex.addValue(key, value)
          return
        }

        if (containedInValueIndex) {
          // This key is already in the value index
          // It could be that it's the same value or a different one
          // If it's a different value we will need to remove the key from the value index
          // and add the key and its two values to the hash index
          try {
            this.#valueIndex.addValue(key, value)
          } catch {
            // This is a different value, need to move the key to the hash index
            const existingValue = this.#valueIndex.get(key)!
            this.#valueIndex.delete(key)
            this.#hashIndex.addValue(key, existingValue)
            this.#hashIndex.addValue(key, value)
          }
          return
        }

        if (containedInHashIndex) {
          // This key is already in the hash index so it already has two or more values.
          // However, this new value and multiplicity could cause an existing value to be removed
          // and lead to the key having only a single value in which case we need to move it back to the value index
          const singleRemainingValue = this.#hashIndex.addValue(key, value)
          if (singleRemainingValue) {
            // The key only has a single remaining value so we need to move it back to the value index
            this.#hashIndex.delete(key)
            this.#valueIndex.addValue(key, singleRemainingValue)
          }
          return
        }
      },
      { operation: `addValue` }
    )
  }

  append(other: Index<K, V>): void {
    return withSpan(
      `indexes.append`,
      () => {
        for (const [key, value] of other.#entries()) {
          this.addValue(key, value)
        }
      },
      { operation: `append` }
    )
  }

  join<V2>(other: Index<K, V2>): MultiSet<[K, [V, V2]]> {
    return withSpan(
      `indexes.join`,
      () => {
        const result: Array<[[K, [V, V2]], number]> = []

        // We want to iterate over the smaller of the two indexes to reduce the
        // number of operations we need to do.
        if (this.size <= other.size) {
          for (const [key, valueIt] of this.#entriesIterators()) {
            if (!other.has(key)) continue
            const otherValues = other.get(key)
            for (const [val1, mul1] of valueIt) {
              for (const [val2, mul2] of otherValues) {
                if (mul1 !== 0 && mul2 !== 0) {
                  result.push([[key, [val1, val2]], mul1 * mul2])
                }
              }
            }
          }
        } else {
          for (const [key, otherValueIt] of other.#entriesIterators()) {
            if (!this.has(key)) continue
            const values = this.get(key)
            for (const [val2, mul2] of otherValueIt) {
              for (const [val1, mul1] of values) {
                if (mul1 !== 0 && mul2 !== 0) {
                  result.push([[key, [val1, val2]], mul1 * mul2])
                }
              }
            }
          }
        }

        return new MultiSet(result)
      },
      { operation: `join` }
    )
  }
}

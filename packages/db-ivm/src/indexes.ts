import { MultiSet } from "./multiset.js"
import { hash } from "./hashing/index.js"
import type { Hash } from "./hashing/index.js"

// We use a symbol to represent the absence of a prefix, unprefixed values a stored
// against this key.
const NO_PREFIX = Symbol(`NO_PREFIX`)
type NO_PREFIX = typeof NO_PREFIX

// A single value is a tuple of the value and the multiplicity.
type SingleValue<TValue> = [TValue, number]

// Base map type for the index. Stores single values, prefix maps, or value maps against a key.
type IndexMap<TKey, TValue, TPrefix> = Map<
  TKey,
  SingleValue<TValue> | PrefixMap<TValue, TPrefix> | ValueMap<TValue>
>

// Second level map type for the index, stores single values or value maps against a prefix.
class PrefixMap<TValue, TPrefix> extends Map<
  TPrefix | NO_PREFIX,
  SingleValue<TValue> | ValueMap<TValue>
> {}

// Third level map type for the index, stores single values or value maps against a hash.
class ValueMap<TValue> extends Map<Hash, [TValue, number]> {}

/**
 * A map from a difference collection trace's keys -> (value, multiplicities) that changed.
 * Used in operations like join and reduce where the operation needs to
 * exploit the key-value structure of the data to run efficiently.
 */
export class Index<TKey, TValue, TPrefix = any> {
  /*
   * This index maintains a nested map of keys -> (value, multiplicities), where:
   * - initially the values are stored against the key as a single value tuple
   * - when a key gets additional values, the values are stored against the key in a
   *   prefix map
   * - the prefix is extract where possible from values that are structured as
   *   [rowPrimaryKey, rowValue], as they are in the Tanstack DB query pipeline.
   * - only when there are multiple values for a given prefix do we fall back to a
   *   hash to identify identical values, storing them in a third level value map.
   */
  #inner: IndexMap<TKey, TValue, TPrefix>

  constructor() {
    this.#inner = new Map()
  }

  /**
   * This method returns a string representation of the index.
   * @param indent - Whether to indent the string representation.
   * @returns A string representation of the index.
   */
  toString(indent = false): string {
    return `Index(${JSON.stringify(
      [...this.entries()],
      undefined,
      indent ? 2 : undefined
    )})`
  }

  /**
   * The size of the index.
   */
  get size(): number {
    return this.#inner.size
  }

  /**
   * This method checks if the index has a given key.
   * @param key - The key to check.
   * @returns True if the index has the key, false otherwise.
   */
  has(key: TKey): boolean {
    return this.#inner.has(key)
  }

  /**
   * This method returns all values for a given key.
   * @param key - The key to get the values for.
   * @returns An array of value tuples [value, multiplicity].
   */
  get(key: TKey): Array<[TValue, number]> {
    return [...this.getIterator(key)]
  }

  /**
   * This method returns an iterator over all values for a given key.
   * @param key - The key to get the values for.
   * @returns An iterator of value tuples [value, multiplicity].
   */
  *getIterator(key: TKey): Iterable<[TValue, number]> {
    const mapOrSingleValue = this.#inner.get(key)
    if (isSingleValue(mapOrSingleValue)) {
      yield mapOrSingleValue
    } else if (mapOrSingleValue === undefined) {
      return
    } else if (mapOrSingleValue instanceof ValueMap) {
      // Direct ValueMap - all values have NO_PREFIX
      for (const valueTuple of mapOrSingleValue.values()) {
        yield valueTuple
      }
    } else {
      // PrefixMap - iterate through all prefixes
      for (const singleValueOrValueMap of mapOrSingleValue.values()) {
        if (isSingleValue(singleValueOrValueMap)) {
          yield singleValueOrValueMap
        } else {
          for (const valueTuple of singleValueOrValueMap.values()) {
            yield valueTuple
          }
        }
      }
    }
  }

  /**
   * This returns an iterator that iterates over all key-value pairs.
   * @returns An iterable of all key-value pairs (and their multiplicities) in the index.
   */
  *entries(): Iterable<[TKey, [TValue, number]]> {
    for (const key of this.#inner.keys()) {
      for (const valueTuple of this.getIterator(key)) {
        yield [key, valueTuple]
      }
    }
  }

  /**
   * This method only iterates over the keys and not over the values.
   * Hence, it is more efficient than the `#entries` method.
   * It returns an iterator that you can use if you need to iterate over the values for a given key.
   * @returns An iterator of all *keys* in the index and their corresponding value iterator.
   */
  *entriesIterators(): Iterable<[TKey, Iterable<[TValue, number]>]> {
    for (const key of this.#inner.keys()) {
      yield [key, this.getIterator(key)]
    }
  }

  /**
   * This method adds a value to the index.
   * @param key - The key to add the value to.
   * @param valueTuple - The value tuple [value, multiplicity] to add to the index.
   */
  addValue(key: TKey, valueTuple: SingleValue<TValue>) {
    const [value, multiplicity] = valueTuple
    // If the multiplicity is 0, do nothing
    if (multiplicity === 0) return

    const mapOrSingleValue = this.#inner.get(key)

    if (mapOrSingleValue === undefined) {
      // This is the first time we see a value for this key we just insert it
      // into the index as a single value tuple
      this.#inner.set(key, valueTuple)
      return
    }

    if (isSingleValue(mapOrSingleValue)) {
      const [currentValue, currentMultiplicity] = mapOrSingleValue
      // We have a single value for this key, lets check if this is the same value
      // and if so we just update the multiplicity. This is a check if its the same
      // literal value or object reference.
      if (currentValue === value) {
        const newMultiplicity = currentMultiplicity + multiplicity
        if (newMultiplicity === 0) {
          this.#inner.delete(key)
        } else {
          this.#inner.set(key, [value, newMultiplicity])
        }
        return
      }

      // Get the prefix of both values
      const [prefix, suffix] = getPrefix<TValue, TPrefix>(value)
      const [currentPrefix, currentSuffix] = getPrefix<TValue, TPrefix>(
        currentValue
      )

      if (
        currentPrefix === prefix &&
        (currentSuffix === suffix || hash(currentSuffix) === hash(suffix))
      ) {
        // They are the same value, so we just update the multiplicity
        const newMultiplicity = currentMultiplicity + multiplicity
        if (newMultiplicity === 0) {
          this.#inner.delete(key)
        } else {
          this.#inner.set(key, [value, newMultiplicity])
        }
        return
      }

      // They are different values - decide between ValueMap or PrefixMap
      if (currentPrefix === NO_PREFIX && prefix === NO_PREFIX) {
        // Both values have NO_PREFIX, use ValueMap directly
        const valueMap = new ValueMap<TValue>()
        valueMap.set(hash(currentSuffix), mapOrSingleValue)
        valueMap.set(hash(suffix), valueTuple)
        this.#inner.set(key, valueMap)
        return
      } else {
        // At least one has a prefix, use PrefixMap
        const newPrefixMap = new PrefixMap<TValue, TPrefix>()
        this.#inner.set(key, newPrefixMap)

        if (currentPrefix === prefix) {
          // They have the same prefix but different suffixes, so we need to add a
          // value map for this suffix to the prefix map
          const valueMap = new ValueMap<TValue>()
          valueMap.set(hash(currentSuffix), mapOrSingleValue)
          valueMap.set(hash(suffix), valueTuple)
          newPrefixMap.set(currentPrefix, valueMap)
        } else {
          // They have different prefixes, so we can add then as single values to the
          // prefix map
          newPrefixMap.set(currentPrefix, mapOrSingleValue)
          newPrefixMap.set(prefix, valueTuple)
        }
        return
      }
    }

    // At this point we have either a ValueMap or PrefixMap
    const [prefix, suffix] = getPrefix<TValue, TPrefix>(value)

    if (mapOrSingleValue instanceof ValueMap) {
      // Direct ValueMap - all values have NO_PREFIX
      if (prefix !== NO_PREFIX) {
        // This value has a prefix but existing values don't - need to convert to PrefixMap
        const newPrefixMap = new PrefixMap<TValue, TPrefix>()
        newPrefixMap.set(NO_PREFIX, mapOrSingleValue)
        newPrefixMap.set(prefix, valueTuple)
        this.#inner.set(key, newPrefixMap)
        return
      }

      // Both existing and new values have NO_PREFIX, add to ValueMap
      const suffixHash = hash(suffix)
      const currentValueForSuffix = mapOrSingleValue.get(suffixHash)
      if (currentValueForSuffix) {
        const [, currentMultiplicity] = currentValueForSuffix
        const newMultiplicity = currentMultiplicity + multiplicity
        if (newMultiplicity === 0) {
          mapOrSingleValue.delete(suffixHash)
          if (mapOrSingleValue.size === 0) {
            this.#inner.delete(key)
          }
        } else {
          mapOrSingleValue.set(suffixHash, [value, newMultiplicity])
        }
      } else {
        mapOrSingleValue.set(suffixHash, valueTuple)
      }
      return
    }

    // PrefixMap case
    const prefixMap = mapOrSingleValue
    const valueMapOrSingleValue = prefixMap.get(prefix)

    const [valueMap, currentSingleValueForPrefix] = isSingleValue(
      valueMapOrSingleValue
    )
      ? [undefined, valueMapOrSingleValue]
      : [valueMapOrSingleValue, undefined]

    if (currentSingleValueForPrefix) {
      const [currentValue, currentMultiplicity] = currentSingleValueForPrefix
      const [currentPrefix, currentSuffix] = getPrefix<TValue, TPrefix>(
        currentValue
      )
      if (currentPrefix !== prefix) {
        throw new Error(`Mismatching prefixes, this should never happen`)
      }
      if (currentSuffix === suffix || hash(currentSuffix) === hash(suffix)) {
        // They are the same value, so we just update the multiplicity
        const newMultiplicity = currentMultiplicity + multiplicity
        if (newMultiplicity === 0) {
          prefixMap.delete(prefix)
          if (prefixMap.size === 0) {
            this.#inner.delete(key)
          }
        } else {
          prefixMap.set(prefix, [value, newMultiplicity])
        }
        return
      } else {
        // They have different suffixes, so we need to add a value map for this suffix
        // to the prefix map
        const valueMap = new ValueMap<TValue>()
        valueMap.set(hash(currentSuffix), currentSingleValueForPrefix)
        valueMap.set(hash(suffix), valueTuple)
        prefixMap.set(prefix, valueMap)
        return
      }
    }

    // At this point there was no single value for the prefix, there *may* be
    // a value map for this prefix. If there is not, we can just add the new value
    // as a single value to the prefix map
    if (!valueMap) {
      prefixMap.set(prefix, valueTuple)
      return
    }

    // We now know there is a value map for this prefix, we need see if there is a
    // current value for the suffix. If there is, we update the multiplicity, otherwise
    // we add the new value as a single value to the value map
    const suffixHash = hash(suffix)
    const currentValueForSuffix = valueMap.get(suffixHash)
    if (currentValueForSuffix) {
      const [, currentMultiplicity] = currentValueForSuffix
      const newMultiplicity = currentMultiplicity + multiplicity
      if (newMultiplicity === 0) {
        valueMap.delete(suffixHash)
        if (valueMap.size === 0) {
          prefixMap.delete(prefix)
          if (prefixMap.size === 0) {
            this.#inner.delete(key)
          }
        }
      } else {
        valueMap.set(suffixHash, [value, newMultiplicity])
      }
    } else {
      valueMap.set(suffixHash, valueTuple)
    }
  }

  /**
   * This method appends another index to the current index.
   * @param other - The index to append to the current index.
   */
  append(other: Index<TKey, TValue>): void {
    for (const [key, value] of other.entries()) {
      this.addValue(key, value)
    }
  }

  /**
   * This method joins two indexes.
   * @param other - The index to join with the current index.
   * @returns A multiset of the joined values.
   */
  join<TValue2>(
    other: Index<TKey, TValue2>
  ): MultiSet<[TKey, [TValue, TValue2]]> {
    const result: Array<[[TKey, [TValue, TValue2]], number]> = []
    // We want to iterate over the smaller of the two indexes to reduce the
    // number of operations we need to do.
    if (this.size <= other.size) {
      for (const [key, valueIt] of this.entriesIterators()) {
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
      for (const [key, otherValueIt] of other.entriesIterators()) {
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
  }
}

/**
 * This function extracts the prefix from a value.
 * @param value - The value to extract the prefix from.
 * @returns The prefix and the suffix.
 */
function getPrefix<TValue, TPrefix>(
  value: TValue
): [TPrefix | NO_PREFIX, TValue] {
  // If the value is an array of two elements and the first element is a string
  // or number, then the first element is the prefix. This is used to distinguish
  // between values without the need for hashing unless there are multiple values
  // for the same prefix.
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    (typeof value[0] === `string` || typeof value[0] === `number`)
  ) {
    return [value[0] as TPrefix, value[1] as TValue]
  }
  return [NO_PREFIX, value]
}

/**
 * This function checks if a value is a single value.
 * @param value - The value to check.
 * @returns True if the value is a single value, false otherwise.
 */
function isSingleValue<TValue>(
  value: SingleValue<TValue> | unknown
): value is SingleValue<TValue> {
  return Array.isArray(value)
}

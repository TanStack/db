import { MultiSet } from "./multiset.js"
import { hash } from "./hashing/index.js"

const NO_PREFIX = Symbol(`NO_PREFIX`)
type NO_PREFIX = typeof NO_PREFIX

type Hash = number
type SingleValue<TValue> = [TValue, number]
type IndexMap<TKey, TValue, TPrefix> = Map<
  TKey,
  SingleValue<TValue> | PrefixMap<TValue, TPrefix>
>
type PrefixMap<TValue, TPrefix> = Map<
  TPrefix | NO_PREFIX,
  SingleValue<TValue> | ValueMap<TValue>
>
type ValueMap<TValue> = Map<Hash, [TValue, number]>

export class Index<TKey, TValue, TPrefix = any> {
  #inner: IndexMap<TKey, TValue, TPrefix>

  constructor() {
    this.#inner = new Map()
  }

  toString(indent = false): string {
    return `Index(${JSON.stringify(
      [...this.entries()],
      undefined,
      indent ? 2 : undefined
    )})`
  }

  get size(): number {
    return this.#inner.size
  }

  has(key: TKey): boolean {
    return this.#inner.has(key)
  }

  get(key: TKey): Array<[TValue, number]> {
    return [...this.getIterator(key)]
  }

  *getIterator(key: TKey): Iterable<[TValue, number]> {
    const prefixMapOrSingleValue = this.#inner.get(key)
    if (isSingleValue(prefixMapOrSingleValue)) {
      yield prefixMapOrSingleValue
    } else if (prefixMapOrSingleValue === undefined) {
      return
    } else {
      for (const singleValueOrValueMap of prefixMapOrSingleValue.values()) {
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
  *#entriesIterators(): Iterable<[TKey, Iterable<[TValue, number]>]> {
    for (const key of this.#inner.keys()) {
      yield [key, this.getIterator(key)]
    }
  }

  addValue(key: TKey, valueTuple: SingleValue<TValue>) {
    const [value, multiplicity] = valueTuple
    // If the multiplicity is 0, do nothing
    if (multiplicity === 0) return

    const prefixMapOrSingleValue = this.#inner.get(key)

    if (prefixMapOrSingleValue === undefined) {
      // This is the first time we see a value for this key we just insert it
      // into the index as a single value tuple
      this.#inner.set(key, valueTuple)
      return
    }

    const [currentSingleValueForKey, prefixMap] = isSingleValue(
      prefixMapOrSingleValue
    )
      ? [prefixMapOrSingleValue, undefined]
      : [undefined, prefixMapOrSingleValue]

    if (currentSingleValueForKey) {
      const [currentValue, currentMultiplicity] = currentSingleValueForKey
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
    }

    // Get the prefix of the new value
    const [prefix, suffix] = getPrefix<TValue, TPrefix>(value)

    if (currentSingleValueForKey) {
      const [currentValue, currentMultiplicity] = currentSingleValueForKey
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
      } else {
        // They are different values, so we need to move the current value to a
        // new prefix map
        const newPrefixMap = new Map<
          TPrefix | NO_PREFIX,
          SingleValue<TValue> | ValueMap<TValue>
        >()
        this.#inner.set(key, newPrefixMap)

        if (currentPrefix === prefix) {
          // They have the same prefix but different suffixes, so we need to add a
          // value map for this suffix to the prefix map
          const valueMap = new Map<Hash, [TValue, number]>()
          valueMap.set(hash(currentSuffix), currentSingleValueForKey)
          valueMap.set(hash(suffix), valueTuple)
          newPrefixMap.set(currentPrefix, valueMap)
        } else {
          // They have different prefixes, so we can add then as singe values to the
          // prefix map
          newPrefixMap.set(currentPrefix, currentSingleValueForKey)
          newPrefixMap.set(prefix, valueTuple)
        }
        return
      }
    }

    // At this point there is a prefix map for this key, we need the value map or
    // single value for this prefix
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
        } else {
          prefixMap.set(prefix, [value, newMultiplicity])
        }
        return
      } else {
        // They have different suffixes, so we need to add a value map for this suffix
        // to the prefix map
        const valueMap = new Map<Hash, [TValue, number]>()
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
      } else {
        valueMap.set(suffixHash, [value, newMultiplicity])
      }
    } else {
      valueMap.set(suffixHash, valueTuple)
    }
  }

  append(other: Index<TKey, TValue>): void {
    for (const [key, value] of other.entries()) {
      this.addValue(key, value)
    }
  }

  join<TValue2>(
    other: Index<TKey, TValue2>
  ): MultiSet<[TKey, [TValue, TValue2]]> {
    const result: Array<[[TKey, [TValue, TValue2]], number]> = []
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
  }
}

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

function isSingleValue<TValue>(
  value: SingleValue<TValue> | unknown
): value is SingleValue<TValue> {
  return Array.isArray(value)
}

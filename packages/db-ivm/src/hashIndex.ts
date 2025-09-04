import { DefaultMap, hash } from "./utils.js"

/**
 * A map from a difference collection trace's keys -> (value, multiplicities) that changed.
 * Used in operations like join and reduce where the operation needs to
 * exploit the key-value structure of the data to run efficiently.
 */
export class HashIndex<K, V> {
  #inner: DefaultMap<K, DefaultMap<string, [V, number]>>

  constructor() {
    this.#inner = new DefaultMap<K, DefaultMap<string, [V, number]>>(
      () =>
        new DefaultMap<string, [V, number]>(() => [undefined as any as V, 0])
    )
    // #inner is as map of:
    // {
    //   [key]: {
    //     [hash(value)]: [value, multiplicity]
    //   }
    // }
  }

  toString(indent = false): string {
    return `HashIndex(${JSON.stringify(
      [...this.#inner].map(([k, valueMap]) => [k, [...valueMap]]),
      undefined,
      indent ? 2 : undefined
    )})`
  }

  get(key: K): Array<[V, number]> {
    const valueMap = this.#inner.get(key)
    return [...valueMap.values()]
  }

  getMultiplicity(key: K, value: V): number {
    const valueMap = this.#inner.get(key)
    const valueHash = hash(value)
    const [, multiplicity] = valueMap.get(valueHash)
    return multiplicity
  }

  entries() {
    return this.#inner.entries()
  }

  *entriesIterator(): Generator<[K, [V, number]]> {
    for (const [key, valueMap] of this.#inner.entries()) {
      for (const [_valueHash, [value, multiplicity]] of valueMap.entries()) {
        yield [key, [value, multiplicity]]
      }
    }
  }

  has(key: K): boolean {
    return this.#inner.has(key)
  }

  delete(key: K): void {
    this.#inner.delete(key)
  }

  get size(): number {
    return this.#inner.size
  }

  /**
   * Adds a value to the index and does not return anything
   * except if the addition caused the value to be removed
   * and the key to be left with only a single value.
   * In that case, we return the single remaining value.
   */
  addValue(key: K, value: [V, number]): [V, number] | void {
    const [val, multiplicity] = value
    const valueMap = this.#inner.get(key)
    const valueHash = hash(val)
    const [, existingMultiplicity] = valueMap.get(valueHash)
    const newMultiplicity = existingMultiplicity + multiplicity
    if (multiplicity !== 0) {
      if (newMultiplicity === 0) {
        valueMap.delete(valueHash)
        if (valueMap.size === 1) {
          // Signal that the key only has a single remaining value
          return valueMap.entries().next().value![1]
        }
      } else {
        valueMap.set(valueHash, [val, newMultiplicity])
      }
    }
    this.#inner.set(key, valueMap)
  }
}

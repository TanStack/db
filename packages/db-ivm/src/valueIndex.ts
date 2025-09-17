import { hash } from "./hashing/index.js"

/**
 * A map from a difference collection trace's keys -> (value, multiplicities) that changed.
 * Used in operations like join and reduce where the operation needs to
 * exploit the key-value structure of the data to run efficiently.
 */
export class ValueIndex<K, V> {
  #inner: Map<K, [V, number]> // Maps key to the value and its multiplicity

  constructor() {
    this.#inner = new Map()
  }

  toString(indent = false): string {
    return `ValueIndex(${JSON.stringify(
      [...this.#inner.entries()],
      undefined,
      indent ? 2 : undefined
    )})`
  }

  get(key: K): [V, number] | undefined {
    return this.#inner.get(key)
  }

  getMultiplicity(key: K): number {
    return this.get(key)?.[1] ?? 0
  }

  entries() {
    return this.#inner.entries()
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

  addValue(key: K, v: [V, number]): void {
    const [value, multiplicity] = v

    if (multiplicity === 0) {
      return
    }

    if (this.has(key)) {
      const [currValue, currMultiplicity] = this.get(key)!
      if (hash(value) === hash(currValue)) {
        // Update the multiplicity
        this.#setMultiplicity(key, value, currMultiplicity + multiplicity)
        return
      }
      // Different value, not allowed.
      // ValueIndex only supports one value per key.
      throw new Error(
        `Cannot add value for key ${key} because it already exists in ValueIndex with a different value`
      )
    }

    this.#inner.set(key, [value, multiplicity])
  }

  #setMultiplicity(key: K, value: V, multiplicity: number): void {
    if (multiplicity === 0) {
      this.#inner.delete(key)
    } else {
      this.#inner.set(key, [value, multiplicity])
    }
  }
}

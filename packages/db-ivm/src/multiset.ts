import { DefaultMap, chunkedArrayPush } from './utils.js'
import { hash } from './hashing/index.js'

export type MultiSetArray<T> = Array<[T, number]>
export type KeyedData<T> = [key: string, value: T]

/**
 * A multiset of data.
 */
export class MultiSet<T> {
  #inner: MultiSetArray<T>

  /**
   * Set by the dataflow edge when this instance was delivered to exactly one
   * consumer: that consumer may transform it in place (map/filter reuse the
   * inner array and tuples) instead of cloning. Producers never retain the
   * delivered instance or its tuples, only the row values inside them —
   * which in-place transforms never mutate.
   */
  public exclusive = false

  constructor(data: MultiSetArray<T> = []) {
    this.#inner = data
  }

  toString(indent = false): string {
    return `MultiSet(${JSON.stringify(this.#inner, null, indent ? 2 : undefined)})`
  }

  toJSON(): string {
    return JSON.stringify(Array.from(this.getInner()))
  }

  static fromJSON<U>(json: string): MultiSet<U> {
    return new MultiSet(JSON.parse(json))
  }

  /**
   * Apply a function to all records in the collection.
   * Exclusively-owned instances are transformed in place (tuples and inner
   * array reused); row values themselves are never mutated.
   */
  map<U>(f: (data: T) => U): MultiSet<U> {
    if (this.exclusive) {
      const inner = this.#inner as unknown as MultiSetArray<U>
      for (let i = 0; i < inner.length; i++) {
        inner[i]![0] = f(this.#inner[i]![0])
      }
      return this as unknown as MultiSet<U>
    }
    return new MultiSet(
      this.#inner.map(([data, multiplicity]) => [f(data), multiplicity]),
    )
  }

  /**
   * Filter out records for which a function f(record) evaluates to False.
   * Exclusively-owned instances are compacted in place.
   */
  filter(f: (data: T) => boolean): MultiSet<T> {
    if (this.exclusive) {
      const inner = this.#inner
      let writeIndex = 0
      for (let i = 0; i < inner.length; i++) {
        const entry = inner[i]!
        if (f(entry[0])) {
          inner[writeIndex++] = entry
        }
      }
      inner.length = writeIndex
      return this
    }
    return new MultiSet(this.#inner.filter(([data, _]) => f(data)))
  }

  /**
   * Negate all multiplicities in the collection.
   */
  negate(): MultiSet<T> {
    return new MultiSet(
      this.#inner.map(([data, multiplicity]) => [data, -multiplicity]),
    )
  }

  /**
   * Concatenate two collections together.
   */
  concat(other: MultiSet<T>): MultiSet<T> {
    const out: MultiSetArray<T> = []
    chunkedArrayPush(out, this.#inner)
    chunkedArrayPush(out, other.getInner())
    return new MultiSet(out)
  }

  /**
   * Produce as output a collection that is logically equivalent to the input
   * but which combines identical instances of the same record into one
   * (record, multiplicity) pair.
   */
  consolidate(): MultiSet<T> {
    // Check if this looks like a keyed multiset (first item is a tuple of length 2)
    if (this.#inner.length > 0) {
      const firstItem = this.#inner[0]?.[0]
      if (Array.isArray(firstItem) && firstItem.length === 2) {
        return this.#consolidateKeyed()
      }
    }

    // Fall back to original method for unkeyed data
    return this.#consolidateUnkeyed()
  }

  /**
   * Private method for consolidating keyed multisets where keys are strings/numbers
   * and values are compared by reference equality (SameValueZero for primitives).
   *
   * Identity is tracked with nested Maps instead of composite string keys, so
   * no per-row ID strings are allocated.
   *
   * Special handling for join operations: When values are tuples of length 2 (common in joins),
   * we unpack them and track each element individually to maintain proper equality semantics
   * (e.g. ['A', null] and [null, 'X'] consolidate separately).
   */
  #consolidateKeyed(): MultiSet<T> {
    type Entry = [T, number]
    type PerKey = {
      // Non-tuple values: value identity → entry
      plain: Map<unknown, Entry> | null
      // Tuple values: first element → second element → entry
      tuples: Map<unknown, Map<unknown, Entry>> | null
    }
    const byKey = new Map<string | number, PerKey>()
    const entries: Array<Entry> = []

    // Process each item in the multiset
    for (const [data, multiplicity] of this.#inner) {
      // Verify this is still a keyed item (should be [key, value] pair)
      if (!Array.isArray(data) || data.length !== 2) {
        // Found non-keyed item, fall back to unkeyed consolidation
        return this.#consolidateUnkeyed()
      }

      const [key, value] = data

      // Verify key is string or number as expected for keyed multisets
      if (typeof key !== `string` && typeof key !== `number`) {
        // Found non-string/number key, fall back to unkeyed consolidation
        return this.#consolidateUnkeyed()
      }

      let perKey = byKey.get(key)
      if (!perKey) {
        perKey = { plain: null, tuples: null }
        byKey.set(key, perKey)
      }

      let entry: Entry | undefined
      if (Array.isArray(value) && value.length === 2) {
        // Special case: value is a tuple from join operations
        let bySecond = perKey.tuples?.get(value[0])
        if (!bySecond) {
          perKey.tuples ??= new Map()
          bySecond = new Map()
          perKey.tuples.set(value[0], bySecond)
        }
        entry = bySecond.get(value[1])
        if (!entry) {
          entry = [data as T, 0]
          entries.push(entry)
          bySecond.set(value[1], entry)
        }
      } else {
        // Regular case: use reference/value equality
        perKey.plain ??= new Map()
        entry = perKey.plain.get(value)
        if (!entry) {
          entry = [data as T, 0]
          entries.push(entry)
          perKey.plain.set(value, entry)
        }
      }
      entry[1] += multiplicity
    }

    // Build result array, filtering out zero multiplicities
    const result: MultiSetArray<T> = []
    for (const entry of entries) {
      if (entry[1] !== 0) {
        result.push(entry)
      }
    }

    return new MultiSet(result)
  }

  /**
   * Private method for consolidating unkeyed multisets using the original approach.
   */
  #consolidateUnkeyed(): MultiSet<T> {
    const consolidated = new DefaultMap<string | number, number>(() => 0)
    const values = new Map<string, any>()

    let hasString = false
    let hasNumber = false
    let hasOther = false
    for (const [data, _] of this.#inner) {
      if (typeof data === `string`) {
        hasString = true
      } else if (typeof data === `number`) {
        hasNumber = true
      } else {
        hasOther = true
        break
      }
    }

    const requireJson = hasOther || (hasString && hasNumber)

    for (const [data, multiplicity] of this.#inner) {
      const key = requireJson ? hash(data) : (data as string | number)
      if (requireJson && !values.has(key as string)) {
        values.set(key as string, data)
      }
      consolidated.update(key, (count) => count + multiplicity)
    }

    const result: MultiSetArray<T> = []
    for (const [key, multiplicity] of consolidated.entries()) {
      if (multiplicity !== 0) {
        const parsedKey = requireJson ? values.get(key as string) : key
        result.push([parsedKey as T, multiplicity])
      }
    }

    return new MultiSet(result)
  }

  extend(other: MultiSet<T> | MultiSetArray<T>): void {
    const otherArray = other instanceof MultiSet ? other.getInner() : other
    chunkedArrayPush(this.#inner, otherArray)
  }

  add(item: T, multiplicity: number): void {
    if (multiplicity !== 0) {
      this.#inner.push([item, multiplicity])
    }
  }

  getInner(): MultiSetArray<T> {
    return this.#inner
  }
}

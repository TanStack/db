import { chunkedArrayPush, getStringId } from './utils.js'
import { hash } from './hashing/index.js'

export type MultiSetArray<T> = Array<[T, number]>
export type KeyedData<T> = [key: string, value: T]

/**
 * A multiset of data.
 */
export class MultiSet<T> {
  #inner: MultiSetArray<T>

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
   */
  map<U>(f: (data: T) => U): MultiSet<U> {
    return new MultiSet(
      this.#inner.map(([data, multiplicity]) => [f(data), multiplicity]),
    )
  }

  /**
   * Filter out records for which a function f(record) evaluates to False.
   */
  filter(f: (data: T) => boolean): MultiSet<T> {
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
   *
   * Record identity depends on the shape of the whole multiset:
   *
   * - Keyed: every record is a `[key, value]` pair with a string or number
   *   key. Keys and primitive values compare by value, and object values by
   *   reference. A value that is an array of length 2 is a join tuple, and
   *   its two elements compare by the same rule.
   * - Unkeyed, one primitive type: every record is a string, or every record
   *   is a number. Records compare as `Map` keys do, and a `-0` record is
   *   returned as `0`.
   * - Otherwise, records compare by structure (`hash`).
   *
   * Each identity keeps its first record in input order with the summed
   * multiplicity. Identities whose sum is zero are dropped. The input is not
   * changed.
   */
  consolidate(): MultiSet<T> {
    const inner = this.#inner
    // Keyed multisets hold [string | number key, value] pairs. Their values are
    // compared by reference, which avoids hashing. Join tuples (values of
    // length 2) are unpacked so ['A', null] and [null, 'X'] stay distinct.
    if (
      inner.every(
        ([data]) =>
          Array.isArray(data) &&
          data.length === 2 &&
          (typeof data[0] === `string` || typeof data[0] === `number`),
      )
    ) {
      const referenceIds = new Map<object | symbol, number>()
      return consolidateBy(inner, (data) => {
        const [key, value] = data as [string | number, unknown]
        // Length prefixes keep user text from crossing component boundaries.
        let valueId: string
        if (Array.isArray(value) && value.length === 2) {
          const firstId = getStringId(value[0], referenceIds)
          const secondId = getStringId(value[1], referenceIds)
          valueId = `tuple_${firstId.length}:${firstId}${secondId}`
        } else {
          valueId = `leaf_${getStringId(value, referenceIds)}`
        }
        const keyId = getStringId(key, referenceIds)
        return `${keyId.length}:${keyId}${valueId}`
      })
    }

    // Unkeyed data of a single primitive type is its own identity, and the
    // result holds the Map key, so -0 becomes 0. Anything else is compared
    // structurally by hash.
    let primitiveType: string | undefined
    const requireHash = inner.some(([data]) => {
      const type = typeof data
      if (type !== `string` && type !== `number`) return true
      primitiveType ??= type
      return type !== primitiveType
    })
    return requireHash
      ? consolidateBy(inner, hash)
      : consolidateBy(inner, (data) => data, true)
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

/**
 * Sums multiplicities of records with the same identity, keeping the first
 * record seen for each identity (or its Map key, which writes -0 as 0, when
 * `keepIdentity` is set) and dropping records whose sum is zero.
 */
function consolidateBy<T>(
  inner: MultiSetArray<T>,
  identityOf: (data: T) => unknown,
  keepIdentity = false,
): MultiSet<T> {
  const consolidated = new Map<unknown, [T, number]>()
  for (const [data, multiplicity] of inner) {
    const identity = identityOf(data)
    const entry = consolidated.get(identity)
    if (entry) entry[1] += multiplicity
    else consolidated.set(identity, [data, multiplicity])
  }
  const result: MultiSetArray<T> = []
  for (const [identity, [data, multiplicity]] of consolidated) {
    if (multiplicity !== 0)
      result.push([keepIdentity ? (identity as T) : data, multiplicity])
  }
  return new MultiSet(result)
}

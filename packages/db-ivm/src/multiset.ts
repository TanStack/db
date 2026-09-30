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
   */
  consolidate(): MultiSet<T> {
    const inner = this.#inner
    // Keyed multisets hold [string | number key, value] pairs. Their values are
    // compared by reference, which avoids hashing. Join tuples (values of
    // length 2) are unpacked so ['A', null] and [null, 'X'] stay distinct.
    if (
      inner.length > 0 &&
      inner.every(
        ([data]) =>
          Array.isArray(data) &&
          data.length === 2 &&
          (typeof data[0] === `string` || typeof data[0] === `number`),
      )
    ) {
      return consolidateBy(inner, (data) => {
        const [key, value] = data as [string | number, unknown]
        const valueId =
          Array.isArray(value) && value.length === 2
            ? `${getStringId(value[0])}|${getStringId(value[1])}`
            : getStringId(value)
        return key + `|` + valueId
      })
    }

    // Unkeyed data of a single primitive type is its own identity; anything
    // else is compared structurally by hash.
    let primitiveType: string | undefined
    const requireHash = inner.some(([data]) => {
      const type = typeof data
      if (type !== `string` && type !== `number`) return true
      primitiveType ??= type
      return type !== primitiveType
    })
    return consolidateBy(inner, requireHash ? hash : (data) => data)
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
 * record seen for each identity and dropping records whose sum is zero.
 */
function consolidateBy<T>(
  inner: MultiSetArray<T>,
  identityOf: (data: T) => unknown,
): MultiSet<T> {
  const consolidated = new Map<unknown, [T, number]>()
  for (const [data, multiplicity] of inner) {
    const identity = identityOf(data)
    const entry = consolidated.get(identity)
    if (entry) entry[1] += multiplicity
    else consolidated.set(identity, [data, multiplicity])
  }
  return new MultiSet(
    [...consolidated.values()].filter(([, multiplicity]) => multiplicity !== 0),
  )
}

export class SortedMap<K, V> {
  private map: Map<K, V>
  private sortedKeys: K[]
  private comparator: (a: V, b: V) => number

  constructor(comparator?: (a: V, b: V) => number) {
    this.map = new Map<K, V>()
    this.sortedKeys = []
    this.comparator = comparator || this.defaultComparator
  }

  private defaultComparator(a: V, b: V): number {
    if (a < b) return -1
    if (a > b) return 1
    return 0
  }

  set(key: K, value: V): this {
    this.map.set(key, value)

    if (!this.sortedKeys.includes(key)) {
      this.sortedKeys.push(key)
    }

    // Re-sort keys based on values
    this.sortedKeys.sort((a, b) => {
      const valueA = this.map.get(a)!
      const valueB = this.map.get(b)!
      return this.comparator(valueA, valueB)
    })

    return this
  }

  get(key: K): V | undefined {
    return this.map.get(key)
  }

  delete(key: K): boolean {
    if (this.map.delete(key)) {
      const index = this.sortedKeys.indexOf(key)
      this.sortedKeys.splice(index, 1)
      return true
    }
    return false
  }

  has(key: K): boolean {
    return this.map.has(key)
  }

  clear(): void {
    this.map.clear()
    this.sortedKeys = []
  }

  get size(): number {
    return this.map.size
  }

  *[Symbol.iterator](): Iterator<[K, V]> {
    for (const key of this.sortedKeys) {
      yield [key, this.map.get(key)!]
    }
  }

  entries(): IterableIterator<[K, V]> {
    return this[Symbol.iterator]()
  }

  keys(): IterableIterator<K> {
    return this.sortedKeys[Symbol.iterator]()
  }

  values(): IterableIterator<V> {
    return function* (this: SortedMap<K, V>) {
      for (const key of this.sortedKeys) {
        yield this.map.get(key)!
      }
    }.call(this)
  }

  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void): void {
    for (const key of this.sortedKeys) {
      callbackfn(this.map.get(key)!, key, this.map)
    }
  }
}

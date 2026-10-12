const TOMBSTONE = Symbol(`tombstone`)

// Compact only after this many deletions, so a small map never pays for it.
const MIN_TOMBSTONES_BEFORE_COMPACTION = 1024

/**
 * A Map whose `delete` keeps the key's entry and marks it deleted.
 *
 * V8's ordered hash tables rehash when a key is deleted and later added
 * again, at a cost that grows with the table: about 5µs per delete and
 * re-add on a 10,000-entry Map, against 0.05µs on a small one. Per-row state
 * sees exactly that pattern when a row is deleted and inserted again. Here
 * re-adding a deleted key writes its value in place.
 *
 * Deleted entries are compacted once they outnumber live ones, so memory stays
 * proportional to the live entries. Reads and iteration skip deleted entries.
 * Unlike a plain Map, a key added again keeps the iteration position of its
 * first insertion.
 */
export class TombstoneMap<K, V> extends Map<K, V> {
  private tombstones = 0

  override get(key: K): V | undefined {
    const value = super.get(key)
    return value === TOMBSTONE ? undefined : value
  }

  override has(key: K): boolean {
    return super.has(key) && super.get(key) !== TOMBSTONE
  }

  override set(key: K, value: V): this {
    // The Map constructor calls set before field initializers run.
    if (this.tombstones > 0 && super.get(key) === TOMBSTONE) this.tombstones--
    return super.set(key, value)
  }

  override delete(key: K): boolean {
    if (!this.has(key)) return false
    super.set(key, TOMBSTONE as V)
    this.tombstones++
    if (
      this.tombstones >= MIN_TOMBSTONES_BEFORE_COMPACTION &&
      this.tombstones > this.size
    ) {
      this.compact()
    }
    return true
  }

  override clear(): void {
    super.clear()
    this.tombstones = 0
  }

  override get size(): number {
    return super.size - this.tombstones
  }

  override *entries(): MapIterator<[K, V]> {
    for (const entry of super.entries()) {
      if (entry[1] !== TOMBSTONE) yield entry
    }
  }

  override *keys(): MapIterator<K> {
    for (const [key, value] of super.entries()) {
      if (value !== TOMBSTONE) yield key
    }
  }

  override *values(): MapIterator<V> {
    for (const value of super.values()) {
      if (value !== TOMBSTONE) yield value
    }
  }

  override [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries()
  }

  override forEach(
    callbackfn: (value: V, key: K, map: Map<K, V>) => void,
    thisArg?: unknown,
  ): void {
    for (const [key, value] of this.entries()) {
      callbackfn.call(thisArg, value, key, this)
    }
  }

  private compact(): void {
    const live = [...this.entries()]
    super.clear()
    this.tombstones = 0
    for (const [key, value] of live) super.set(key, value)
  }
}

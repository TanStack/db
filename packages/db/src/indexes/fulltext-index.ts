import { BaseIndex, IndexOperation } from "./base-index.js"

/**
 * Placeholder FullText index for text search (not yet implemented)
 */
export class FullTextIndex<TKey extends string | number = string | number> extends BaseIndex<TKey> {
  public readonly supportedOperations = new Set([
    IndexOperation.EQ,
  ])

  protected initialize(): void {
    // Placeholder implementation
  }

  add(key: TKey, item: any): void {
    // TODO: Implement full text indexing
  }

  remove(key: TKey, item: any): void {
    // TODO: Implement full text removal
  }

  update(key: TKey, oldItem: any, newItem: any): void {
    this.remove(key, oldItem)
    this.add(key, newItem)
  }

  build(entries: Iterable<[TKey, any]>): void {
    this.clear()
    for (const [key, item] of entries) {
      this.add(key, item)
    }
  }

  clear(): void {
    this.updateTimestamp()
  }

  lookup(operation: IndexOperation, value: any): Set<TKey> {
    // TODO: Implement full text search
    return new Set()
  }

  get keyCount(): number {
    return 0
  }

  protected estimateMemoryUsage(): number {
    return 0
  }
}
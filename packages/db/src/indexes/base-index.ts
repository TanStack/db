import { compileSingleRowExpression } from "../query/compiler/evaluators.js"
import { comparisonFunctions } from "../query/builder/functions.js"
import type { BasicExpression } from "../query/ir.js"

/**
 * Operations that indexes can support, imported from available comparison functions
 */
export const IndexOperation = comparisonFunctions

/**
 * Type for index operation values
 */
export type IndexOperation = (typeof comparisonFunctions)[number]

/**
 * Statistics about index usage and performance
 */
export interface IndexStats {
  readonly entryCount: number
  readonly lookupCount: number
  readonly averageLookupTime: number
  readonly lastUpdated: Date
}

/**
 * Base abstract class that all index types extend
 */
export abstract class BaseIndex<
  TKey extends string | number = string | number,
> {
  public readonly id: number
  public readonly name?: string
  public readonly expression: BasicExpression
  public abstract readonly supportedOperations: Set<IndexOperation>

  protected lookupCount = 0
  protected totalLookupTime = 0
  protected lastUpdated = new Date()

  constructor(
    id: number,
    expression: BasicExpression,
    name?: string,
    options?: any
  ) {
    this.id = id
    this.expression = expression
    this.name = name
    this.initialize(options)
  }

  // Abstract methods that each index type must implement
  abstract add(key: TKey, item: any): void
  abstract remove(key: TKey, item: any): void
  abstract update(key: TKey, oldItem: any, newItem: any): void
  abstract build(entries: Iterable<[TKey, any]>): void
  abstract clear(): void
  abstract lookup(operation: IndexOperation, value: any): Set<TKey>
  abstract get keyCount(): number

  // Common methods
  supports(operation: IndexOperation): boolean {
    return this.supportedOperations.has(operation)
  }

  matchesField(fieldPath: Array<string>): boolean {
    return (
      this.expression.type === `ref` &&
      this.expression.path.length === fieldPath.length &&
      this.expression.path.every((part, i) => part === fieldPath[i])
    )
  }

  getStats(): IndexStats {
    return {
      entryCount: this.keyCount,
      lookupCount: this.lookupCount,
      averageLookupTime:
        this.lookupCount > 0 ? this.totalLookupTime / this.lookupCount : 0,
      lastUpdated: this.lastUpdated,
    }
  }

  // Protected methods for subclasses
  protected abstract initialize(options?: any): void

  protected evaluateIndexExpression(item: any): any {
    const evaluator = compileSingleRowExpression(this.expression)
    return evaluator(item as Record<string, unknown>)
  }

  protected trackLookup(startTime: number): void {
    const duration = performance.now() - startTime
    this.lookupCount++
    this.totalLookupTime += duration
  }

  protected updateTimestamp(): void {
    this.lastUpdated = new Date()
  }
}

/**
 * Type for index constructor
 */
export type IndexConstructor<TKey extends string | number = string | number> =
  new (
    id: number,
    expression: BasicExpression,
    name?: string,
    options?: any
  ) => BaseIndex<TKey>

/**
 * Index resolver can be either a class constructor or async loader
 */
export type IndexResolver<TKey extends string | number = string | number> =
  | IndexConstructor<TKey>
  | (() => Promise<IndexConstructor<TKey>>)

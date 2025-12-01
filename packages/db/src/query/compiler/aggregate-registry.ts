import { UnsupportedAggregateFunctionError } from "../../errors.js"
import type { NamespacedRow } from "../../types.js"

/**
 * Value extractor type - extracts a value from a namespaced row
 */
export type ValueExtractor = (entry: [string, NamespacedRow]) => any

/**
 * Aggregate function factory - creates an IVM aggregate from a value extractor
 */
export type AggregateFactory = (valueExtractor: ValueExtractor) => any

/**
 * Configuration for how to create a value extractor for this aggregate
 */
export interface AggregateConfig {
  /** The IVM aggregate function factory */
  factory: AggregateFactory
  /** How to transform the compiled expression value */
  valueTransform: `numeric` | `numericOrDate` | `raw`
}

/**
 * Registry mapping aggregate names to their configurations
 */
const aggregateRegistry = new Map<string, AggregateConfig>()

/**
 * Register an aggregate function.
 * Called automatically when an aggregate module is imported.
 */
export function registerAggregate(name: string, config: AggregateConfig): void {
  aggregateRegistry.set(name.toLowerCase(), config)
}

/**
 * Get an aggregate's configuration.
 * Throws if the aggregate hasn't been registered.
 */
export function getAggregateConfig(name: string): AggregateConfig {
  const config = aggregateRegistry.get(name.toLowerCase())
  if (!config) {
    throw new UnsupportedAggregateFunctionError(name)
  }
  return config
}

/**
 * Try to get an aggregate's configuration.
 * Returns undefined if the aggregate hasn't been registered.
 */
export function tryGetAggregateConfig(
  name: string
): AggregateConfig | undefined {
  return aggregateRegistry.get(name.toLowerCase())
}

import { UnknownFunctionError } from "../../errors.js"

/**
 * Type for a compiled expression evaluator
 */
export type CompiledExpression = (data: any) => any

/**
 * Factory function that creates an evaluator from compiled arguments
 */
export type EvaluatorFactory = (
  compiledArgs: Array<CompiledExpression>,
  isSingleRow: boolean
) => CompiledExpression

/**
 * Registry mapping operator names to their evaluator factories
 */
const operatorRegistry = new Map<string, EvaluatorFactory>()

/**
 * Register an operator's evaluator factory.
 * Called automatically when an operator module is imported.
 */
export function registerOperator(
  name: string,
  factory: EvaluatorFactory
): void {
  operatorRegistry.set(name, factory)
}

/**
 * Get an operator's evaluator factory.
 * Throws if the operator hasn't been registered.
 */
export function getOperatorEvaluator(name: string): EvaluatorFactory {
  const factory = operatorRegistry.get(name)
  if (!factory) {
    throw new UnknownFunctionError(name)
  }
  return factory
}

/**
 * Try to get an operator's evaluator factory.
 * Returns undefined if the operator hasn't been registered.
 */
export function tryGetOperatorEvaluator(
  name: string
): EvaluatorFactory | undefined {
  return operatorRegistry.get(name)
}

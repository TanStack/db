/**
 * Contract utilities for runtime verification of preconditions, postconditions, and invariants.
 *
 * Inspired by Design by Contract (DbC) principles and Cheng Huang's approach to AI-assisted
 * code verification. Contracts serve as executable specifications that:
 * - Document expected behavior
 * - Catch violations early during development/testing
 * - Can be disabled in production for performance
 *
 * @example
 * ```typescript
 * function divide(a: number, b: number): number {
 *   precondition(b !== 0, 'divisor must be non-zero')
 *   const result = a / b
 *   postcondition(Number.isFinite(result), 'result must be finite')
 *   return result
 * }
 * ```
 */

// Contract checking is enabled by default, can be disabled via environment variable
// In production builds, bundlers can tree-shake contract checks when this is false
const CONTRACTS_ENABLED =
  typeof process !== `undefined`
    ? process.env.NODE_ENV !== `production` &&
      process.env.DISABLE_CONTRACTS !== `1`
    : true

/**
 * Base class for all contract violation errors.
 * Extends TanStackDBError for consistent error handling.
 */
export class ContractViolationError extends Error {
  constructor(
    public readonly violationType: `precondition` | `postcondition` | `invariant`,
    message: string,
  ) {
    super(`${violationType.charAt(0).toUpperCase() + violationType.slice(1)} violation: ${message}`)
    this.name = `ContractViolationError`
  }
}

/**
 * Thrown when a precondition check fails.
 * Preconditions define what must be true before a function executes.
 */
export class PreconditionViolationError extends ContractViolationError {
  constructor(message: string) {
    super(`precondition`, message)
    this.name = `PreconditionViolationError`
  }
}

/**
 * Thrown when a postcondition check fails.
 * Postconditions define what must be true after a function executes.
 */
export class PostconditionViolationError extends ContractViolationError {
  constructor(message: string) {
    super(`postcondition`, message)
    this.name = `PostconditionViolationError`
  }
}

/**
 * Thrown when an invariant check fails.
 * Invariants define what must always be true for an object/system.
 */
export class InvariantViolationError extends ContractViolationError {
  constructor(message: string) {
    super(`invariant`, message)
    this.name = `InvariantViolationError`
  }
}

/**
 * Asserts a precondition that must be true before function execution.
 * Use at the beginning of functions to validate inputs and state.
 *
 * @param condition - Boolean or function returning boolean to check
 * @param message - Error message if condition is false
 * @throws {PreconditionViolationError} if condition is false
 *
 * @example
 * ```typescript
 * function withdraw(amount: number) {
 *   precondition(amount > 0, 'amount must be positive')
 *   precondition(this.balance >= amount, 'insufficient balance')
 *   // ...
 * }
 * ```
 */
export function precondition(
  condition: boolean | (() => boolean),
  message: string,
): asserts condition {
  if (!CONTRACTS_ENABLED) return

  const result = typeof condition === `function` ? condition() : condition
  if (!result) {
    throw new PreconditionViolationError(message)
  }
}

/**
 * Asserts a postcondition that must be true after function execution.
 * Use at the end of functions to validate outputs and final state.
 *
 * @param condition - Boolean or function returning boolean to check
 * @param message - Error message if condition is false
 * @throws {PostconditionViolationError} if condition is false
 *
 * @example
 * ```typescript
 * function sort(arr: number[]): number[] {
 *   const result = [...arr].sort((a, b) => a - b)
 *   postcondition(result.length === arr.length, 'length preserved')
 *   postcondition(isSorted(result), 'result is sorted')
 *   return result
 * }
 * ```
 */
export function postcondition(
  condition: boolean | (() => boolean),
  message: string,
): asserts condition {
  if (!CONTRACTS_ENABLED) return

  const result = typeof condition === `function` ? condition() : condition
  if (!result) {
    throw new PostconditionViolationError(message)
  }
}

/**
 * Asserts an invariant that must always be true.
 * Use to verify system-wide or object-wide consistency.
 *
 * @param condition - Boolean or function returning boolean to check
 * @param message - Error message if condition is false
 * @throws {InvariantViolationError} if condition is false
 *
 * @example
 * ```typescript
 * class BinaryTree {
 *   insert(value: number) {
 *     // ... insertion logic ...
 *     invariant(this.isBalanced(), 'tree must remain balanced')
 *   }
 * }
 * ```
 */
export function invariant(
  condition: boolean | (() => boolean),
  message: string,
): asserts condition {
  if (!CONTRACTS_ENABLED) return

  const result = typeof condition === `function` ? condition() : condition
  if (!result) {
    throw new InvariantViolationError(message)
  }
}

/**
 * Helper to check if contracts are currently enabled.
 * Useful for conditional contract logic or testing.
 */
export function areContractsEnabled(): boolean {
  return CONTRACTS_ENABLED
}

/**
 * Captures a value before an operation for use in postcondition checks.
 * Returns undefined when contracts are disabled to avoid computation overhead.
 *
 * @param getValue - Function that computes the value to capture
 * @returns The captured value, or undefined if contracts are disabled
 *
 * @example
 * ```typescript
 * function increment(counter: Counter) {
 *   const oldValue = captureForPostcondition(() => counter.value)
 *   counter.value++
 *   postcondition(
 *     oldValue === undefined || counter.value === oldValue + 1,
 *     'value incremented by exactly 1'
 *   )
 * }
 * ```
 */
export function captureForPostcondition<T>(getValue: () => T): T | undefined {
  if (!CONTRACTS_ENABLED) return undefined
  return getValue()
}

# Auto-Registering Operators: Implementation Guide

This guide walks through implementing the auto-registration pattern for TanStack DB operators. Follow these steps in order.

---

## Overview

**Goal:** Enable tree-shaking by having each operator register its own evaluator when imported.

**Current state:**
- Builder functions in `src/query/builder/functions.ts` create IR nodes like `new Func('eq', args)`
- Evaluator in `src/query/compiler/evaluators.ts` has a switch statement that handles ALL operators

**Target state:**
- Each operator file contains both builder AND evaluator
- Importing an operator auto-registers its evaluator
- The switch statement becomes a simple registry lookup

---

## Step 1: Create the Registry

Create a new file `packages/db/src/query/compiler/registry.ts`:

```typescript
import { UnknownFunctionError } from "../../errors.js"

/**
 * Type for a compiled expression evaluator
 */
export type CompiledExpression = (data: any) => any

/**
 * Factory function that creates an evaluator from compiled arguments
 */
export type EvaluatorFactory = (
  compiledArgs: CompiledExpression[],
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
```

**Test it:** Make sure the file compiles without errors.

---

## Step 2: Create a Helper for Evaluator Compilation

The evaluators need access to `compileExpressionInternal` to compile their arguments. We need to expose this.

In `packages/db/src/query/compiler/evaluators.ts`, export the internal compiler:

```typescript
// Add this export (around line 68)
export function compileExpressionInternal(
  expr: BasicExpression,
  isSingleRow: boolean
): (data: any) => any {
  // ... existing implementation
}
```

Change from `function` to `export function`.

---

## Step 3: Create the First Operator File

Create `packages/db/src/query/builder/operators/eq.ts`:

```typescript
import { Func } from "../../ir.js"
import { toExpression } from "../ref-proxy.js"
import { registerOperator } from "../../compiler/registry.js"
import { normalizeValue, areValuesEqual } from "../../../utils/comparison.js"
import type { BasicExpression } from "../../ir.js"
import type { RefProxy } from "../ref-proxy.js"
import type { RefLeaf } from "../types.js"
import type { CompiledExpression } from "../../compiler/registry.js"

// ============================================================
// TYPES (copied from functions.ts - will be shared later)
// ============================================================

type ComparisonOperand<T> =
  | RefProxy<T>
  | RefLeaf<T>
  | T
  | BasicExpression<T>
  | undefined
  | null

type ComparisonOperandPrimitive<T extends string | number | boolean> =
  | T
  | BasicExpression<T>
  | undefined
  | null

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function eq<T>(
  left: ComparisonOperand<T>,
  right: ComparisonOperand<T>
): BasicExpression<boolean>
export function eq<T extends string | number | boolean>(
  left: ComparisonOperandPrimitive<T>,
  right: ComparisonOperandPrimitive<T>
): BasicExpression<boolean>
export function eq(left: any, right: any): BasicExpression<boolean> {
  return new Func(`eq`, [toExpression(left), toExpression(right)])
}

// ============================================================
// EVALUATOR
// ============================================================

function isUnknown(value: any): boolean {
  return value === null || value === undefined
}

function eqEvaluatorFactory(
  compiledArgs: CompiledExpression[],
  _isSingleRow: boolean
): CompiledExpression {
  const argA = compiledArgs[0]!
  const argB = compiledArgs[1]!

  return (data: any) => {
    const a = normalizeValue(argA(data))
    const b = normalizeValue(argB(data))

    // 3-valued logic: comparison with null/undefined returns UNKNOWN
    if (isUnknown(a) || isUnknown(b)) {
      return null
    }

    return areValuesEqual(a, b)
  }
}

// ============================================================
// AUTO-REGISTRATION
// ============================================================

registerOperator('eq', eqEvaluatorFactory)
```

---

## Step 4: Update the Barrel Export

Create `packages/db/src/query/builder/operators/index.ts`:

```typescript
// Re-export all operators
// Importing from here will auto-register all evaluators

export { eq } from './eq.js'
// Add more operators here as they're migrated
```

---

## Step 5: Update the Main Evaluator to Use Registry

In `packages/db/src/query/compiler/evaluators.ts`, modify `compileFunction`:

**Before (the switch statement):**
```typescript
function compileFunction(func: Func, isSingleRow: boolean): (data: any) => any {
  const compiledArgs = func.args.map((arg) =>
    compileExpressionInternal(arg, isSingleRow)
  )

  switch (func.name) {
    case `eq`: {
      // ... implementation
    }
    // ... 20+ more cases
    default:
      throw new UnknownFunctionError(func.name)
  }
}
```

**After (registry lookup):**
```typescript
import { getOperatorEvaluator } from './registry.js'

function compileFunction(func: Func, isSingleRow: boolean): (data: any) => any {
  const compiledArgs = func.args.map((arg) =>
    compileExpressionInternal(arg, isSingleRow)
  )

  const evaluatorFactory = getOperatorEvaluator(func.name)
  return evaluatorFactory(compiledArgs, isSingleRow)
}
```

---

## Step 6: Ensure Operators Are Imported

**Important:** The registry lookup will fail if the operator hasn't been imported yet!

For now, import all operators at the top of `evaluators.ts` to ensure they're registered:

```typescript
// At the top of evaluators.ts
// This ensures all operators are registered before any compilation happens
import '../builder/operators/eq.js'
// Add more as operators are migrated
```

Later, when ALL operators are migrated, you can remove these imports. Users importing operators from `@tanstack/db` will trigger registration automatically.

---

## Step 7: Keep the Switch Statement (Temporarily)

During migration, keep the switch statement as a fallback:

```typescript
function compileFunction(func: Func, isSingleRow: boolean): (data: any) => any {
  const compiledArgs = func.args.map((arg) =>
    compileExpressionInternal(arg, isSingleRow)
  )

  // Try registry first (for migrated operators)
  const evaluatorFactory = tryGetOperatorEvaluator(func.name)
  if (evaluatorFactory) {
    return evaluatorFactory(compiledArgs, isSingleRow)
  }

  // Fall back to switch for non-migrated operators
  switch (func.name) {
    case `gt`: {
      // ... still here until migrated
    }
    // ... other non-migrated operators
    default:
      throw new UnknownFunctionError(func.name)
  }
}
```

Add a `tryGetOperatorEvaluator` to `registry.ts`:

```typescript
export function tryGetOperatorEvaluator(name: string): EvaluatorFactory | undefined {
  return operatorRegistry.get(name)
}
```

---

## Step 8: Test It Works

Run the existing tests to make sure `eq` still works:

```bash
pnpm test
```

Write a quick test that confirms registration works:

```typescript
// In a test file
import { eq } from '@tanstack/db'
import { getOperatorEvaluator } from '../src/query/compiler/registry'

test('eq operator is auto-registered', () => {
  // Just importing eq should register it
  const factory = getOperatorEvaluator('eq')
  expect(factory).toBeDefined()
})
```

---

## Step 9: Migrate Remaining Operators

Once `eq` works, migrate the other operators one by one:

1. Create `packages/db/src/query/builder/operators/{name}.ts`
2. Copy the builder function from `functions.ts`
3. Copy the evaluator logic from the switch statement in `evaluators.ts`
4. Add `registerOperator('{name}', factory)` at the bottom
5. Export from `operators/index.ts`
6. Remove the case from the switch statement
7. Run tests

**Order of migration (suggested):**
1. `eq` (done in this guide)
2. `gt`, `gte`, `lt`, `lte` (simple comparisons)
3. `and`, `or`, `not` (boolean operators)
4. `inArray`, `like`, `ilike` (more complex)
5. `upper`, `lower`, `length`, `concat`, `coalesce` (string/utility)
6. `add`, `subtract`, `multiply`, `divide` (math)
7. `isNull`, `isUndefined` (null checks)
8. `count`, `avg`, `sum`, `min`, `max` (aggregates - may need special handling)

---

## Step 10: Clean Up

After ALL operators are migrated:

1. Remove the fallback switch statement from `evaluators.ts`
2. Remove the explicit imports from `evaluators.ts` (registration happens via user imports)
3. Delete the old operator implementations from `functions.ts` (keep only type exports)
4. Update `query/index.ts` to export from the new location

---

## Common Pitfalls

### 1. Circular Imports

If you get circular import errors, check that:
- `registry.ts` doesn't import from files that import operators
- Operator files only import types from `ir.ts`, not implementations

### 2. "Unknown operator" Error at Runtime

This means the operator wasn't imported before the query was compiled.

**Debug:** Add a console.log to `registerOperator`:
```typescript
export function registerOperator(name: string, factory: EvaluatorFactory): void {
  console.log(`Registering operator: ${name}`)
  operatorRegistry.set(name, factory)
}
```

### 3. Tests Failing After Migration

Make sure tests import operators before using them. If a test file uses `eq` but doesn't import it, the test will fail.

---

## File Structure After Migration

```
packages/db/src/
├── query/
│   ├── builder/
│   │   ├── operators/
│   │   │   ├── index.ts      # Barrel export
│   │   │   ├── eq.ts         # eq builder + evaluator
│   │   │   ├── gt.ts
│   │   │   ├── gte.ts
│   │   │   ├── lt.ts
│   │   │   ├── lte.ts
│   │   │   ├── and.ts
│   │   │   ├── or.ts
│   │   │   ├── not.ts
│   │   │   └── ...
│   │   ├── functions.ts      # Only types after migration
│   │   └── ...
│   └── compiler/
│       ├── registry.ts       # NEW: Operator registry
│       ├── evaluators.ts     # Simplified: Just registry lookup
│       └── ...
```

---

## Summary

1. Create `registry.ts` with `registerOperator` / `getOperatorEvaluator`
2. Create operator files that bundle builder + evaluator + registration
3. Modify `evaluators.ts` to use registry lookup
4. Migrate operators one at a time, testing after each
5. Clean up when done

The key insight: importing an operator causes its file to execute, which calls `registerOperator`, which adds it to the Map. By the time you compile a query, all the operators you're using are already registered.

# Tree-Shakable APIs: Architecture Research

## Executive Summary

Converting TanStack DB to tree-shakable APIs requires **architectural changes to the operator evaluation pipeline**, not just file reorganization. The current architecture couples operator builders to a centralized evaluator through string-based dispatch, making true tree-shaking impossible without a registry/plugin pattern.

**Key Finding:** Even splitting operators into separate files provides no bundle size benefit because the evaluator (`evaluators.ts`) contains a 300-line switch statement with ALL operator implementations hardcoded.

**Required Solution:** Each operator must be a complete unit that auto-registers its evaluator when imported.

---

## 1. The Pipeline Coupling Problem

### Current Architecture

```
User Code           Builder              IR                    Evaluator
───────────────────────────────────────────────────────────────────────────
eq(a, b)      →    new Func('eq', args)  →  { name: 'eq', ... }  →  switch(name) {
                                                                      case 'eq': ...
                                                                      case 'gt': ...
                                                                      // 25+ cases
                                                                    }
```

The problem: **string-based dispatch** in the evaluator.

### Why File Splitting Alone Doesn't Work

```typescript
// @tanstack/db/operators/eq.ts - CURRENT APPROACH (doesn't help)
export function eq<T>(left: T, right: T): BasicExpression<boolean> {
  return new Func('eq', [toExpression(left), toExpression(right)])
}
// This just creates an IR node with name='eq'
// The EVALUATOR still needs to know what 'eq' means!
```

```typescript
// evaluators.ts - Still bundles EVERYTHING
function compileFunction(func: Func) {
  switch (func.name) {
    case 'eq': { /* 15 lines */ }
    case 'gt': { /* 12 lines */ }
    case 'gte': { /* 12 lines */ }
    case 'lt': { /* 12 lines */ }
    case 'lte': { /* 12 lines */ }
    case 'and': { /* 20 lines */ }
    case 'or': { /* 20 lines */ }
    case 'not': { /* 10 lines */ }
    case 'in': { /* 12 lines */ }
    case 'like': { /* 15 lines */ }
    case 'ilike': { /* 15 lines */ }
    case 'upper': { /* 5 lines */ }
    case 'lower': { /* 5 lines */ }
    case 'length': { /* 10 lines */ }
    case 'concat': { /* 15 lines */ }
    case 'coalesce': { /* 10 lines */ }
    case 'add': { /* 8 lines */ }
    case 'subtract': { /* 8 lines */ }
    case 'multiply': { /* 8 lines */ }
    case 'divide': { /* 10 lines */ }
    case 'isUndefined': { /* 5 lines */ }
    case 'isNull': { /* 5 lines */ }
    default: throw new UnknownFunctionError(func.name)
  }
}
```

**Result:** Importing just `eq` still includes the entire evaluator with all 25+ operator implementations.

---

## 2. Required Solution: Auto-Registering Operators

Each operator must bundle its builder AND evaluator, registering itself on import:

```typescript
// @tanstack/db/operators/eq.ts - PROPOSED
import { registerOperator } from '../registry.js'
import { Func } from '../ir.js'
import { normalizeValue, areValuesEqual, isUnknown } from '../utils/comparison.js'

// Builder function (what users import and call)
export function eq<T>(left: T, right: T): BasicExpression<boolean> {
  return new Func('eq', [toExpression(left), toExpression(right)])
}

// Evaluator implementation (co-located with builder)
const eqEvaluator = (compiledArgs: CompiledExpression[]) => {
  const [argA, argB] = compiledArgs
  return (data: any) => {
    const a = normalizeValue(argA!(data))
    const b = normalizeValue(argB!(data))
    if (isUnknown(a) || isUnknown(b)) return null
    return areValuesEqual(a, b)
  }
}

// Auto-registration: happens when module is imported
registerOperator('eq', eqEvaluator)
```

```typescript
// @tanstack/db/registry.ts
const operatorRegistry = new Map<string, EvaluatorFactory>()

export function registerOperator(name: string, evaluator: EvaluatorFactory) {
  operatorRegistry.set(name, evaluator)
}

export function getOperatorEvaluator(name: string): EvaluatorFactory {
  const evaluator = operatorRegistry.get(name)
  if (!evaluator) {
    throw new UnknownFunctionError(name)
  }
  return evaluator
}
```

```typescript
// evaluators.ts - Now just a registry lookup (tiny!)
function compileFunction(func: Func, isSingleRow: boolean) {
  const evaluatorFactory = getOperatorEvaluator(func.name)
  const compiledArgs = func.args.map(arg => compileExpressionInternal(arg, isSingleRow))
  return evaluatorFactory(compiledArgs, isSingleRow)
}
```

### Tree-Shaking Now Works

```
User imports                                    Bundle includes
─────────────────────────────────────────────────────────────────────────────
import { eq, gt } from '@tanstack/db/operators' → eq + gt builders & evaluators

                                                  NOT included: and, or, upper,
                                                  lower, like, concat, etc.
```

### Package.json sideEffects

Keep `sideEffects: false` - it still works correctly:

```json
{
  "sideEffects": false
}
```

Why this is fine:
- If you `import { eq }` → bundler includes `eq.ts` → registration runs ✓
- If you don't import `eq` → bundler excludes it → registration never needed ✓

The registration "side effect" is self-contained. It only registers into a Map that's only consulted when compiling a query that uses that operator. No leaked global state.

---

## 3. Type Safety Analysis

The good news: **type safety is preserved** with this architecture.

### Why Types Still Work

1. **Generic constraints are module-independent**
   ```typescript
   // Works across module boundaries
   .where(({ todo }) => eq(todo.completed, false))
   //      ↑ RefsForContext<Context> - inferred at call site
   //                       ↑ Ref<boolean> - flows through generics
   ```

2. **RefProxy is purely runtime**
   - Type inference uses generic constraints, not runtime values
   - The `__path` tracking is invisible to TypeScript

3. **No circular type dependencies between operators**
   - Each operator is self-contained
   - All share the same `BasicExpression` return type

### Type Architecture

```typescript
// Centralized types (shared by all operators)
// @tanstack/db/types.ts
export type BasicExpression<T> = PropRef<T> | Value<T> | Func<T>
export type CompiledExpression = (data: NamespacedRow) => any
export type EvaluatorFactory = (args: CompiledExpression[]) => CompiledExpression

// Each operator imports and uses these
// @tanstack/db/operators/eq.ts
import type { BasicExpression, EvaluatorFactory } from '../types.js'

export function eq<T>(left: T, right: T): BasicExpression<boolean>
```

### Context Type Flow (Unchanged)

The query builder's `Context` type continues to work:

```typescript
interface Context {
  baseSchema: ContextSchema
  schema: ContextSchema        // Evolves through .join(), .select()
  fromSourceName: string
  hasJoins?: boolean
  result?: any
}

// .from() creates initial context
// .join() expands schema
// .where() receives RefsForContext<Context>
// Operators receive typed refs, return BasicExpression
```

None of this depends on where operators are defined.

---

## 4. Full Pipeline Impact

### Components Requiring Changes

| Component | Current State | Required Change |
|-----------|--------------|-----------------|
| **Builder functions** | Create `Func('name', args)` | + Register evaluator |
| **Evaluator** | 300-line switch statement | Registry lookup |
| **Optimizer** | Hardcoded AND/OR handling | Operator hints (optional) |
| **Compiler** | Static db-ivm imports | Dynamic/lazy loading |

### Optimizer Considerations

The optimizer has some operator-specific logic:

```typescript
// optimizer.ts - AND clause splitting
case 'and':
  // Split into multiple WHERE clauses for pushdown
```

Options:
1. **Keep hardcoded** for core operators (and, or, not) - these are always needed
2. **Add operator hints** for optimization behavior
3. **Defer to Phase 3** - optimizer changes are lower priority

### Compiler Considerations

The compiler imports db-ivm operators statically:

```typescript
// compiler/index.ts
import { distinct, filter, map } from "@tanstack/db-ivm"
```

For full tree-shaking, these would need dynamic loading based on query features. This is a Phase 3 optimization.

---

## 5. Implementation Plan

### Phase 1: Registry Infrastructure (3-4 days)

1. Create `registry.ts` with `registerOperator` / `getOperatorEvaluator`
2. Refactor `evaluators.ts` to use registry lookup
3. Keep existing operators working (register them from current location)
4. Add tests for registry behavior

### Phase 2: Split Operators (4-5 days)

1. Create `operators/` directory structure
2. Move each operator to its own file with co-located evaluator
3. Each file auto-registers on import
4. Update exports in `package.json`
5. Add per-operator tests

```
packages/db/src/operators/
├── index.ts          # Re-exports all (convenience)
├── eq.ts             # eq builder + evaluator + registration
├── gt.ts
├── gte.ts
├── lt.ts
├── lte.ts
├── and.ts
├── or.ts
├── not.ts
├── in.ts
├── like.ts
├── ilike.ts
├── upper.ts
├── lower.ts
├── length.ts
├── concat.ts
├── coalesce.ts
├── add.ts
├── subtract.ts
├── multiply.ts
├── divide.ts
├── isUndefined.ts
└── isNull.ts
```

### Phase 3: Extended Tree-Shaking (5-6 days)

1. Lazy-load db-ivm operators in compiler
2. Add operator optimization hints (optional)
3. Split collection managers for mutations tree-shaking
4. Update framework packages (react-db, etc.)

### Total Effort: ~15-18 days

---

## 6. Bundle Size Projections

### After Full Implementation

| Scenario | Current | Tree-Shakable | Reduction |
|----------|---------|---------------|-----------|
| Minimal query (eq only) | ~48kb | ~8-10kb | **79-83%** |
| Basic query (eq, gt, and) | ~48kb | ~10-12kb | **75-79%** |
| Full query features | ~48kb | ~48kb | 0% |

### What Gets Tree-Shaken

With registry architecture:
- ✅ Unused operators (evaluator code)
- ✅ String functions (upper, lower, concat) if not used
- ✅ Math functions (add, subtract, etc.) if not used
- ✅ Null checks (isNull, isUndefined) if not used

Still bundled (core infrastructure):
- Registry (~50 lines)
- IR classes (Func, PropRef, Value)
- Expression compilation core
- Collection core

---

## 7. Risks and Mitigations

### Risk: Registration Order

**Problem:** What if evaluator is looked up before operator is imported?

**Mitigation:** Registration happens at module import time:
```typescript
import { eq } from '@tanstack/db/operators'  // ← eq registers here

// By the time this code runs, eq is already registered
createLiveQueryCollection((q) =>
  q.from({ todo: todos })
   .where(({ todo }) => eq(todo.completed, false))
)
```

### Risk: Duplicate Registration

**Problem:** Same operator imported from multiple entry points.

**Mitigation:** Registry uses Map, duplicate `set()` is idempotent:
```typescript
registerOperator('eq', eqEvaluator)  // First import
registerOperator('eq', eqEvaluator)  // Subsequent imports - no-op
```

### Risk: Missing Operator at Runtime

**Problem:** User creates `Func('custom', args)` without registering evaluator.

**Mitigation:** Clear error message:
```typescript
export function getOperatorEvaluator(name: string): EvaluatorFactory {
  const evaluator = operatorRegistry.get(name)
  if (!evaluator) {
    throw new Error(
      `Unknown operator "${name}". ` +
      `Did you forget to import it from @tanstack/db/operators?`
    )
  }
  return evaluator
}
```

---

## 8. Conclusion

True tree-shaking for TanStack DB operators requires the **auto-registering plugin architecture**:

1. Each operator bundles its builder AND evaluator
2. Import triggers self-registration
3. Evaluator becomes a simple registry lookup
4. Bundlers can eliminate unused operators

**Type safety is fully preserved** because:
- Generic constraints work across module boundaries
- RefProxy is a runtime detail invisible to types
- All operators share centralized type definitions

**Recommended approach:**
- Phase 1: Build registry infrastructure
- Phase 2: Split operators with co-located evaluators
- Phase 3: Extend to compiler and collection managers

This is a significant refactor (~15-18 days) but enables the 75-83% bundle reduction that makes TanStack DB viable for "just trying it out" scenarios.

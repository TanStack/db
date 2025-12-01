# Tree-Shakable APIs Exploration Guide

## The Goal

Enable developers to "just try" TanStack DB with a minimal bundle. A single live query with one operator should be ~10kb, not ~48kb.

```typescript
// This should be ~10kb, not 48kb
import { createCollection } from '@tanstack/db/collection'
import { eq } from '@tanstack/db/operators/eq'
import { createLiveQueryCollection } from '@tanstack/db/live-query'

const todos = createCollection({ ... })
const active = createLiveQueryCollection((q) =>
  q.from({ todo: todos }).where(({ todo }) => eq(todo.completed, false))
)
```

---

## Why Tree-Shaking Doesn't Work Today

### The Pipeline Coupling Problem

The query system has four stages, all tightly coupled through string-based dispatch:

```
Builder              IR                    Evaluator
─────────────────────────────────────────────────────────────
eq(a, b)      →     Func('eq', args)   →   switch(func.name) {
                                             case 'eq': ...
                                             case 'gt': ...
                                             // 25+ hardcoded cases
                                           }
```

**The problem:** Even if you split `eq()` into its own file, the evaluator still contains implementations for ALL operators in one giant switch statement.

```typescript
// evaluators.ts - 486 lines, ALL operators hardcoded
function compileFunction(func: Func) {
  switch (func.name) {
    case 'eq': { /* implementation */ }
    case 'gt': { /* implementation */ }
    case 'and': { /* implementation */ }
    case 'or': { /* implementation */ }
    case 'like': { /* implementation */ }
    case 'upper': { /* implementation */ }
    // ... 20+ more cases
    default: throw new UnknownFunctionError(func.name)
  }
}
```

**Result:** Importing just `eq` still bundles the entire evaluator with all 25+ operator implementations.

### Other Coupling Issues

1. **41 circular dependency chains** detected (see Appendix A)
2. **`types.ts`** imports `collection/index.ts` which pulls in everything
3. **`collection/index.ts`** imports 16 files including all 7 managers
4. **Framework packages** re-export everything from core

---

## The Solution: Auto-Registering Operators

Each operator must be a complete unit that registers itself on import:

```typescript
// @tanstack/db/operators/eq.ts
import { registerOperator } from '../registry.js'
import { Func } from '../ir.js'

// Builder function (what users import)
export function eq<T>(left: T, right: T): BasicExpression<boolean> {
  return new Func('eq', [toExpression(left), toExpression(right)])
}

// Evaluator (co-located with builder)
const eqEvaluator = (compiledArgs) => (data) => {
  const a = normalizeValue(compiledArgs[0](data))
  const b = normalizeValue(compiledArgs[1](data))
  if (isUnknown(a) || isUnknown(b)) return null
  return areValuesEqual(a, b)
}

// Auto-registration on import
registerOperator('eq', eqEvaluator)
```

```typescript
// registry.ts - tiny, always included
const operatorRegistry = new Map<string, EvaluatorFactory>()

export function registerOperator(name: string, evaluator: EvaluatorFactory) {
  operatorRegistry.set(name, evaluator)
}

export function getOperatorEvaluator(name: string): EvaluatorFactory {
  const evaluator = operatorRegistry.get(name)
  if (!evaluator) throw new UnknownFunctionError(name)
  return evaluator
}
```

```typescript
// evaluators.ts - now just a registry lookup
function compileFunction(func: Func) {
  const evaluator = getOperatorEvaluator(func.name)
  return evaluator(compiledArgs)
}
```

### How Tree-Shaking Works

```
User imports                        Bundle includes
─────────────────────────────────────────────────────────────────
import { eq } from '.../eq'    →   eq builder + eq evaluator
import { gt } from '.../gt'    →   gt builder + gt evaluator

                                   NOT included: and, or, upper,
                                   lower, like, concat, etc.
```

### sideEffects: false Still Works

The registration "side effect" is self-contained:
- If you import `eq` → bundler includes it → registration runs ✓
- If you don't import `eq` → bundler excludes it → registration never needed ✓

No leaked global state. The Map is only consulted when compiling queries that use that operator.

---

## Implementation Plan

### Phase 1: Registry Infrastructure (3-4 days)

1. Create `registry.ts` with `registerOperator` / `getOperatorEvaluator`
2. Refactor `evaluators.ts` to use registry lookup instead of switch
3. Register existing operators from their current location (no file moves yet)
4. Add tests for registry behavior

### Phase 2: Split Operators (4-5 days)

Create `operators/` directory with each operator as a complete unit:

```
packages/db/src/operators/
├── index.ts          # Re-exports all (convenience import)
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

Update `package.json` exports:

```json
{
  "exports": {
    ".": "./dist/esm/index.js",
    "./operators": "./dist/esm/operators/index.js",
    "./operators/eq": "./dist/esm/operators/eq.js",
    "./operators/gt": "./dist/esm/operators/gt.js"
  }
}
```

### Phase 3: Extended Tree-Shaking (5-6 days)

1. **Lazy-load db-ivm operators** in compiler based on query features
2. **Split collection managers** for mutations tree-shaking
3. **Break circular dependencies** (41 chains to untangle)
4. **Update framework packages** to not re-export everything

### Total Effort: ~15-18 days

---

## Bundle Size Projections

| Scenario | Current | After Phase 2 | Reduction |
|----------|---------|---------------|-----------|
| Minimal query (eq only) | ~48kb | ~8-10kb | **79-83%** |
| Basic query (eq, gt, and, or) | ~48kb | ~12-14kb | **71-75%** |
| With mutations | ~48kb | ~18-22kb | **54-63%** |
| Full features | ~48kb | ~48kb | 0% |

### What Gets Tree-Shaken

With the registry architecture:
- ✅ Unused query operators (eq, gt, like, upper, etc.)
- ✅ String functions if not used
- ✅ Math functions if not used
- ✅ Null checks if not used

Still bundled (core infrastructure):
- Registry (~50 lines)
- IR classes (Func, PropRef, Value)
- Expression compilation core
- Collection core

---

## Type Safety

Type safety is fully preserved. See `docs/tree-shakable-type-safety-research.md` for details.

Key points:
- Generic constraints work across module boundaries
- RefProxy is a runtime detail invisible to TypeScript
- Context type evolution doesn't depend on operator location
- All operators share centralized type definitions

---

## API Design

### Recommended: Subpath Exports (Preserve Current API)

Users choose their import style:

```typescript
// Full bundle (current behavior, backward compatible)
import { createCollection, eq, gt } from '@tanstack/db'

// Tree-shakable (new)
import { createCollection } from '@tanstack/db/collection'
import { eq } from '@tanstack/db/operators/eq'
import { gt } from '@tanstack/db/operators/gt'

// Convenience bundle of all operators
import { eq, gt, and, or } from '@tanstack/db/operators'
```

The chained query API remains unchanged:

```typescript
createLiveQueryCollection((q) =>
  q.from({ todo: todos })
   .where(({ todo }) => eq(todo.completed, false))
   .orderBy(({ todo }) => todo.createdAt)
   .limit(10)
)
```

---

## Risks and Mitigations

### Risk: Registration Order

**Problem:** Evaluator lookup before operator import?

**Mitigation:** Query compilation happens after the callback returns:
```typescript
createLiveQueryCollection((q) =>
  q.from({ todo: todos })
   .where(({ todo }) => eq(todo.completed, false))  // eq imported
)  // ← Compilation happens here, after callback
```

### Risk: Missing Operator at Runtime

**Problem:** User manually creates `Func('custom', args)` without registration.

**Mitigation:** Clear error message:
```typescript
throw new Error(
  `Unknown operator "${name}". ` +
  `Did you forget to import it from @tanstack/db/operators/${name}?`
)
```

### Risk: Breaking Changes

**Mitigation:** Phased rollout:
- v0.x: Add subpath exports, keep main entry point
- v1.0: Deprecation warnings for full imports
- v2.0: Main entry point only exports types

---

## Appendix A: Dependency Graph Analysis

### Tool

```bash
npx madge --extensions ts packages/db/src/index.ts --circular
npx madge --extensions ts packages/db/src/index.ts --summary
```

### Circular Dependencies (41 chains!)

Most problematic cycles:
```
1. collection/index.ts ↔ changes.ts ↔ events.ts
2. types.ts ↔ query/ir.ts ↔ query/builder/types.ts
3. collection/index.ts → mutations.ts → transactions.ts → collection
4. query/live/collection-config-builder.ts ↔ collection-registry.ts
```

### Most Imported Files

| Dependents | File | Impact |
|------------|------|--------|
| 32 | `types.ts` | Core types - can't split |
| 27 | `query/ir.ts` | Query AST - shared |
| 21 | `collection/index.ts` | Needs refactor |
| 18 | `errors.ts` | Leaf node ✓ |
| 17 | `query/builder/types.ts` | Can centralize |

### Leaf Nodes (Already Tree-Shakable)

```
✓ SortedMap.ts
✓ deferred.ts
✓ errors.ts
✓ event-emitter.ts
✓ scheduler.ts
✓ utils/btree.ts
```

---

## Appendix B: db-ivm Operators

### Currently Bundled

| Operator | Always Needed? |
|----------|----------------|
| `filter` | Yes - core |
| `map` | Yes - core |
| `output` | Yes - core |
| `distinct` | Only for DISTINCT |
| `join` | Only for JOIN |
| `groupBy` | Only for GROUP BY |
| `orderByWithFractionalIndex` | Only for ORDER BY |

### Heavy Optional Operators

| Operator | Lines | Use Case |
|----------|-------|----------|
| `topKWithFractionalIndexBTree` | 307 | Large ordered collections |
| `topKWithFractionalIndex` | 481 | Paginated results |
| `groupBy` | 377 | GROUP BY queries |
| `join` | 374 | JOIN queries |

These should be lazy-loaded based on query features (Phase 3).

---

## Conclusion

True tree-shaking requires the **auto-registering operator architecture**:

1. Each operator bundles builder + evaluator
2. Import triggers self-registration
3. Evaluator becomes a registry lookup
4. Bundlers eliminate unused operators

This is a significant refactor (~15-18 days) but enables the 75-83% bundle reduction needed for TanStack DB to be viable for "just trying it out."

The current chained API is preserved - only the import paths change for users who want smaller bundles.

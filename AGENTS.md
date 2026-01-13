# Agent Coding Guidelines for TanStack DB

This guide provides principles and patterns for AI agents contributing to the TanStack DB codebase. These guidelines are derived from PR review patterns and reflect the quality standards expected in this project.

## Table of Contents

1. [Type Safety](#type-safety)
2. [Code Organization](#code-organization)
3. [Algorithm Efficiency](#algorithm-efficiency)
4. [Semantic Correctness](#semantic-correctness)
5. [Abstraction Design](#abstraction-design)
6. [Code Clarity](#code-clarity)
7. [Testing Requirements](#testing-requirements)
8. [Function Design](#function-design)
9. [Modern JavaScript Patterns](#modern-javascript-patterns)
10. [Edge Cases and Corner Cases](#edge-cases-and-corner-cases)

## Type Safety

### Avoid `any` Types

**❌ Bad:**

```typescript
function processData(data: any) {
  return data.value
}

const result: any = someOperation()
```

**✅ Good:**

```typescript
function processData(data: unknown) {
  if (isDataObject(data)) {
    return data.value
  }
  throw new Error('Invalid data')
}

const result: TQueryData = someOperation()
```

**Key Principles:**

- Use `unknown` instead of `any` when the type is truly unknown
- Provide proper type annotations for return values
- Use type guards to narrow `unknown` types safely
- If you find yourself using `any`, question whether there's a better type

## Code Organization

### Extract Common Logic

**❌ Bad:**

```typescript
// Duplicated logic in multiple places
function processA() {
  const key = typeof value === 'number' ? `__number__${value}` : String(value)
  // ...
}

function processB() {
  const key = typeof value === 'number' ? `__number__${value}` : String(value)
  // ...
}
```

**✅ Good:**

```typescript
function serializeKey(value: string | number): string {
  return typeof value === 'number' ? `__number__${value}` : String(value)
}

function processA() {
  const key = serializeKey(value)
  // ...
}

function processB() {
  const key = serializeKey(value)
  // ...
}
```

### Organize Utilities

**Key Principles:**

- Extract serialization/deserialization logic into utility files
- When you see identical or near-identical code blocks, extract to a helper function
- Prefer small, focused utility functions over large inline implementations
- Move reusable logic into utility modules (e.g., `utils/`, `helpers/`)

### Function Size and Complexity

**❌ Bad:**

```typescript
function syncData() {
  // 200+ lines of logic handling multiple concerns
  // - snapshot phase
  // - buffering
  // - sync state management
  // - error handling
  // all inline...
}
```

**✅ Good:**

```typescript
function syncData() {
  handleSnapshotPhase()
  manageBuffering()
  updateSyncState()
  handleErrors()
}

function handleSnapshotPhase() {
  // Focused logic for snapshot phase
}
```

**Key Principle:** If a function is massive, extract logical sections into separate functions. This improves readability and maintainability.

## Algorithm Efficiency

### Be Mindful of Time Complexity

**❌ Bad: O(n²) Queue Processing:**

```typescript
// Processes elements in queue, but elements may need multiple passes
while (queue.length > 0) {
  const job = queue.shift()
  if (hasUnmetDependencies(job)) {
    queue.push(job) // Re-queue, causing O(n²) behavior
  } else {
    processJob(job)
  }
}
```

**✅ Good: Dependency-Aware Processing:**

```typescript
// Use a data structure that respects dependencies
// Process only jobs with no unmet dependencies
// Consider topological sort for DAG-like structures
const readyJobs = jobs.filter((job) => !hasUnmetDependencies(job))
readyJobs.forEach(processJob)
```

### Use Appropriate Data Structures

**❌ Bad:**

```typescript
// O(n) lookup for each check
const items = ['foo', 'bar', 'baz' /* hundreds more */]
if (items.includes(searchValue)) {
  // ...
}
```

**✅ Good:**

```typescript
// O(1) lookup
const items = new Set(['foo', 'bar', 'baz' /* hundreds more */])
if (items.has(searchValue)) {
  // ...
}
```

**Key Principles:**

- For membership checks on large collections, use `Set` instead of `Array.includes()`
- Be aware of nested loops and their complexity implications
- Consider the worst-case scenario, especially for operations that could process many items
- Use appropriate data structures (Set for lookups, Map for key-value, etc.)

## Semantic Correctness

### Ensure Logic Matches Intent

**❌ Bad:**

```typescript
// Intending to check if subset limit is more restrictive than superset
function isLimitSubset(
  subset: number | undefined,
  superset: number | undefined,
) {
  return subset === undefined || superset === undefined || subset <= superset
}

// Problem: If subset has no limit but superset does, returns true (incorrect)
```

**✅ Good:**

```typescript
function isLimitSubset(
  subset: number | undefined,
  superset: number | undefined,
) {
  // Subset with no limit cannot be a subset of one with a limit
  return superset === undefined || (subset !== undefined && subset <= superset)
}
```

### Validate Intersections and Unions

When merging predicates or combining queries, ensure the semantics are correct:

**Example Problem:**

```sql
-- Query 1: WHERE age >= 18 LIMIT 1
-- Query 2: WHERE age >= 20 LIMIT 3
-- Naive intersection: WHERE age >= 20 LIMIT 1
-- Problem: This may not return the actual intersection of results
```

**Key Principle:** Think carefully about what operations like intersection, union, and subset mean for your specific use case. Consider edge cases with limits, ordering, and predicates.

## Abstraction Design

### Avoid Leaky Abstractions

**❌ Bad:**

```typescript
class Collection {
  getViewKey(key: TKey): string {
    // Caller needs to know internal representation
    return `${this._state.viewKeyPrefix}${key}`
  }
}

// Usage exposes internals
const viewKey = collection.getViewKey(key)
if (viewKey.startsWith(PREFIX)) {
  /* ... */
}
```

**✅ Good:**

```typescript
class Collection {
  getViewKey(key: TKey): string {
    // Delegate to state manager, hiding implementation
    return this._state.getViewKey(key)
  }
}

class CollectionStateManager {
  getViewKey(key: TKey): string {
    return `${this.viewKeyPrefix}${key}`
  }
}
```

**Key Principles:**

- Encapsulate implementation details within the responsible class
- Don't expose internal data structures or representations
- Use delegation to maintain clean boundaries between components
- Keep internal properties private when possible

### Proper Encapsulation

**Key Principle:** If you need to access a property or method from outside a class, add a public method that delegates to the internal implementation rather than exposing the internal property directly.

## Code Clarity

### Prefer Positive Predicates

**❌ Bad:**

```typescript
if (!refs.some((ref) => ref.path[0] === outerAlias)) {
  // treat as safe
}
```

**✅ Good:**

```typescript
if (refs.every((ref) => ref.path[0] !== outerAlias)) {
  // treat as safe
}
```

**Key Principle:** Positive conditions (every, all) are generally easier to understand than negated conditions (not some).

### Simplify Complex Conditions

**❌ Bad:**

```typescript
const isLoadingNow = this.pendingLoadSubsetPromises.size > 0
if (isLoadingNow && !isLoadingNow) {
  // Confusing logic
}
```

**✅ Good:**

```typescript
const wasLoading = this.pendingLoadSubsetPromises.size > 0
this.pendingLoadSubsetPromises.add(promise)
const isLoadingNow = this.pendingLoadSubsetPromises.size === 1

if (isLoadingNow) {
  // Started loading
}
```

### Use Descriptive Names

**❌ Bad:**

```typescript
const viewKeysMap = new Map() // Type in name is redundant
const dependencyBuilders = [] // Sounds like functions that build
```

**✅ Good:**

```typescript
const viewKeys = new Map() // Data structure not in name
const dependentBuilders = [] // Accurately describes dependents
```

**Key Principles:**

- Avoid Hungarian notation (encoding type in variable name)
- Use names that describe the role or purpose, not the data structure
- Choose names that make the code read like prose
- Prefer `dependentBuilders` over `dependencyBuilders` when referring to things that depend on something

## Testing Requirements

### Test-First Approach for Bug Fixes

**Critical Principle:** When fixing a bug, you MUST write a reproduction test FIRST, before implementing any fix. This is mandatory, not optional.

**Workflow:**

1. **Write a failing test** that reproduces the bug
2. **Verify the test fails** with the current code
3. **Implement the fix**
4. **Verify the test passes** with the fix

This ensures:

- The bug is actually fixed (the test proves it)
- The bug doesn't regress in the future
- The fix is validated
- We understand the root cause before implementing a solution

**Example:**

```typescript
// Found a bug with fetchSnapshot resolving after up-to-date message
// FIRST: Write a test that fails without the fix
test('ignores snapshot that resolves after up-to-date message', async () => {
  // Setup: Create conditions that trigger the bug
  // Action: Trigger the problematic sequence
  // Assert: Verify correct behavior
})

// THEN: Run the test - it should FAIL
// THEN: Implement the fix
// THEN: Run the test again - it should PASS
```

**Why Test-First?**

- It forces you to understand the bug before fixing it
- It prevents "fixes" that don't actually address the root cause
- It provides documentation of what the bug was
- It ensures the fix is correct and complete

### Test Corner Cases

Common corner cases to consider:

- Empty arrays or sets
- Single-element collections
- `undefined` vs `null` values
- Operations on already-resolved promises
- Race conditions between async operations
- Limit/offset edge cases (0, 1, very large numbers)
- IN predicates with 0 or 1 elements

## Function Design

### Prefer Explicit Parameters Over Closures

**❌ Bad:**

```typescript
function outer() {
  const config = getConfig()
  const state = getState()

  const updateFn = () => {
    // Closes over config and state
    applyUpdate(config, state)
  }

  scheduler.schedule(updateFn)
}
```

**✅ Good:**

```typescript
function updateEntry(entry: Entry, config: Config, state: State) {
  applyUpdate(entry, config, state)
}

function outer() {
  const config = getConfig()
  const state = getState()

  scheduler.schedule({
    config,
    state,
    update: updateEntry,
  })
}
```

**Key Principles:**

- Functions that take dependencies as arguments are easier to test
- Explicit parameters make data flow clearer
- Closures can hide dependencies and make code harder to follow
- Use closures when they genuinely simplify the code, but be intentional

### Return Type Precision

**❌ Bad:**

```typescript
function serializeKey(key: string | number): unknown {
  return String(key)
}
```

**✅ Good:**

```typescript
function serializeKey(key: string | number): string {
  return String(key)
}
```

**Key Principle:** Always provide the most precise return type. Avoid `unknown` or `any` return types unless truly necessary.

## Modern JavaScript Patterns

### Use Modern Operators

**❌ Bad:**

```typescript
if (firstError === undefined) {
  firstError = error
}

const value = cached !== null && cached !== undefined ? cached : defaultValue

if (obj[key] === undefined) {
  obj[key] = value
}
```

**✅ Good:**

```typescript
firstError ??= error

const value = cached ?? defaultValue

obj[key] ??= value
```

### Use Spread Operator

**❌ Bad:**

```typescript
const combined = []
for (const item of currentItems) {
  combined.push(item)
}
for (const item of newItems) {
  combined.push(item)
}
```

**✅ Good:**

```typescript
const combined = [...currentItems, ...newItems]
```

### Simplify Array Operations

**❌ Bad:**

```typescript
const filtered = []
for (const item of items) {
  if (item.value > 0) {
    filtered.push(item)
  }
}
```

**✅ Good:**

```typescript
const filtered = items.filter((item) => item.value > 0)
```

## Edge Cases and Corner Cases

### Common Patterns to Consider

1. **Key Encoding**: When converting keys to strings, ensure no collisions

   ```typescript
   // ❌ Bad: numeric 1 and string "__number__1" collide
   const key = typeof val === 'number' ? `__number__${val}` : String(val)

   // ✅ Good: proper encoding with type prefix
   const key = `${typeof val}_${String(val)}`
   ```

2. **Subset/Superset Logic**: Consider all cases

   ```typescript
   // Consider: IN with 0, 1, or many elements
   // Consider: EQ vs IN predicates
   // Consider: Range predicates (>=, <=) vs equality
   ```

3. **Limit and Offset**: Handle undefined, 0, and edge values

   ```typescript
   // What happens when limit is 0?
   // What happens when offset exceeds data length?
   // What happens when limit is undefined?
   ```

4. **Optional vs Required**: Be explicit about optionality

   ```typescript
   // ❌ Why is this optional?
   interface Config {
     collection?: Collection
   }

   // ✅ Document or make required if always needed
   interface Config {
     collection: Collection // Always required for query collections
   }
   ```

5. **Race Conditions**: Async operations may resolve in unexpected order
   ```typescript
   // Request snapshot before receiving up-to-date
   // But snapshot resolves after up-to-date arrives
   // Should ignore the stale snapshot
   ```

## Package Versioning

### Understand Semantic Versioning

**Common Mistake:**

```json
{
  "dependencies": {
    "package": "^0.0.0"
  }
}
```

**Problem:** `^0.0.0` restricts to exactly `0.0.0`, not "latest 0.0.x" as you might expect.

From [npm semver docs](https://github.com/npm/node-semver):

> Caret Ranges allow changes that do not modify the left-most non-zero element. For versions `0.0.X`, this means no updates.

**Solutions:**

- Use `*` for any version
- Use `latest` for the latest version
- Use a proper range like `^0.1.0` if that's what you mean

## Documentation and Comments

### Keep Useful Comments

**Good Comment:**

```typescript
// Returning false signals that callers should schedule another pass
return allDone
```

**Good Comment:**

```typescript
// This step is necessary because the query function has captured
// the old subscription instance in its closure
```

### Remove Outdated Comments

**Key Principle:** When refactoring code, update or remove comments that reference old function names or outdated logic.

## General Principles

1. **Question Optionality**: If a property is optional, understand why. Often it should be required.

2. **Consider Performance**: Before implementing, think about time complexity, especially for operations that might process many items.

3. **Validate Semantics**: Ensure that your implementation actually does what you think it does. Consider edge cases.

4. **Avoid Premature Complexity**: Don't add ternaries, special cases, or checks for things that can't happen.

5. **Test First for Bugs**: Reproduce bugs in tests before fixing them.

6. **Be Consistent**: Follow naming conventions and patterns used elsewhere in the codebase.

7. **Simplify**: Modern JavaScript provides many concise operators and methods. Use them.

8. **Encapsulate**: Hide implementation details. Use delegation and proper abstraction boundaries.

9. **Type Precisely**: Use the most specific type possible. Avoid `any`.

10. **Extract When Duplicating**: If you're writing the same logic twice, extract it.

## When in Doubt

If you're unsure about an implementation decision:

1. Look for similar patterns in the existing codebase
2. Consider the worst-case scenario for performance
3. Think about edge cases and corner cases
4. Ask: "Does this abstraction leak implementation details?"
5. Ask: "Would this be easy to test?"
6. Ask: "Is this as simple as it could be?"

Remember: Simple, well-typed, well-tested code with clear abstractions is the goal. We raise the standard of code quality—not through complexity, but through clarity and correctness.

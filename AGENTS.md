# Agent Coding Guidelines for TanStack DB

This guide provides principles and patterns for AI agents contributing to the TanStack DB codebase. These guidelines are derived from PR review patterns and reflect the quality standards expected in this project.

## Think like a scientist

Treat the code as an implementation of laws about observable behavior. Before
changing a subsystem, articulate the law, its authority, and the conditions
under which it applies. Think hard about whether it is the right law and whether
we fully enforce it. Existing behavior is evidence about the implementation;
it is not, by itself, authority for the promise.

Use oracles as instruments: a small independent model enacts a law, legal
histories exercise it, and public observations test production against it.
Seek cases that distinguish plausible explanations. A mismatch can expose a
production bug, a wrong model or law, missing information at the production
boundary, or an unsuitable observation checkpoint. A green oracle can still
miss a violation when its histories, path, observation checkpoint, or
comparison are insufficient.
Correctly implemented behavior can also fail the user's need. Use the
[repair-location table](docs/contributing/instruments/adversarial-review.md#locate-the-repair)
after diagnosing which account failed, before changing expectations.

Challenge the laws themselves when the task warrants it: their suitability,
interactions, and underlying concepts can need revision. Keep proposed design
changes distinct from defects under the accepted contract. Preserve useful
implementation freedom and state what the evidence does and does not establish.

Before creating or editing an oracle, load
[oracle-authoring](.agents/skills/oracle-authoring/SKILL.md). This applies to
an edit of an oracle or of the production driver, history grammar, or
comparison that it uses. It also applies when the edit fixes a bug or a review
finding.
Before reviewing an oracle, load
[oracle-review](.agents/skills/oracle-review/SKILL.md). Both use the
oracle guide below and a small [instrument library](docs/contributing/instruments/index.md)
that is also available for other design work. Select instruments as needed;
routine work does not require a full instrument sequence.

## How oracle work is scored

Every behavior change in an area that an oracle owns has two possible paths.
The maintainer runs hostile auditors on every pull request. The auditors look
for the shortcuts listed below and report each one. Pick the path with this in
mind: a shortcut does not finish the task sooner. It moves the work into
review, where it costs more.

### The oracle-first path

1. State the law and its authority.
2. Extend the oracle so that generated histories reach the state where the law
   matters. Declare that state with
   [`createOracleReach`](packages/db/tests/oracle-reach.ts), and show that the
   generated histories reach it.
3. Run the oracle against the unchanged production code. It fails: this is the
   RED result, and it proves that the oracle sees the defect.
4. Change production. The oracle gives immediate feedback on each attempt,
   including attempts that break a neighboring law.
5. Show that a hostile mutant, such as the original defect, fails the oracle.

On this path, you know the fix is correct before you push it. Reviewers find
little that is new, so the total work and token spend stay low. Later agents
inherit a clean model of the subsystem that they can extend in place.

### The shortcut path

Change production first, then adjust the oracle until it passes: relax a
comparison, add an exclusion, change a model rule to match the new output, or
add one pinned example. The tests pass, but nothing shows that the oracle can
see the defect class. Auditors find the gap. Each finding costs a fix, a new
witness, and another review round, and the next fix often breaks a
neighboring law that the oracle still cannot see.

In one recorded case, a production-first rewrite of reload handling needed four
more review rounds and about ten follow-up commits. Each round found a defect
in the previous round's fix. A grammar-first pass then found the last defect on
its first run, and the fix that followed made the rule smaller. The result is
usually the same code, after much more work, rework, and maintainer
frustration.

### Extra credit

Work earns extra credit for:

- an oracle improvement that has proof: a declared reach, a RED result on the
  parent commit, a GREEN result, and a hostile mutant that fails.
- a model that stays independent of production and short, with each rule tied
  to its authority.
- a production change that is clean and light in shipped bytes, especially one
  that removes states, branches, or recovery paths.

### Penalties

Auditors penalize these shortcuts heavily, and a pull request that contains one
is not ready:

- **Production first:** a production change in an oracle-owned area without a
  RED result from the extended oracle on the code before the change.
- **Model hacking:** a model rule changed to match production output without a
  stated authority (a contract document and section, or a maintainer
  decision). Production output is evidence. It is not authority.
- **Unreachable claims:** a closure claim for a state that generated histories
  do not reach, or a reach that nobody measured.
- **Quiet exclusions:** a skipped, narrowed, or relaxed comparison without an
  entry in the [coverage map](docs/contributing/oracle-coverage.md) that names
  the owner and the maintainer decision.
- **Pinned-only coverage:** a named example where the law needs a generator
  dimension.
- **Unit tests inside oracles:** ordinary examples or concrete type assertions
  placed in an oracle file. A fixed regression must replay the shared model,
  production driver, and comparison without its own expected answer.
- **"Pre-existing" as a dismissal:** a reachable counterexample that an agent
  labels as older than the change, but does not fix, record in the coverage
  map with its trace, or bring to the maintainer for a decision.
- **No mutant:** a closure claim without a hostile mutant that fails the
  oracle.

### The evidence block

Every pull request or commit that changes behavior in an oracle-owned area
includes this block:

- **Law:** the law and its authority.
- **Reach:** the declared state and how many generated histories reached it.
- **RED:** the command and the failure on the parent commit.
- **GREEN:** the command and the result after the change.
- **Mutant:** the hostile mutant and how the oracle rejected it.
- **Limits:** the states, paths, and observations that the evidence does not
  cover.

### Lint feedback while you work

The `oracle/` lint rules in `scripts/eslint-plugin-oracle/` report the
shortcuts that a syntactic check can see. The repository's agent hooks
(`.claude/`, `.codex/`, `.gemini/`, and `.github/hooks/`) return the reports
after each edit and at the end of each turn. A hook sees only the edits that
the harness's own edit tools make. After an edit through a shell command, or
in a harness without these hooks, run `pnpm lint:changed` before you finish.

Fix a report. Do not turn the rule off. The hooks, `pnpm lint:changed`, the
pre-commit hook, and CI ignore `eslint-disable` comments for these rules. A
true exception needs a maintainer to change the rule in a reviewed pull
request.

## Required reading: live-query materialization

Before reading, analyzing, or modifying correlated live-query materialization
code under `packages/db/src/query/live/`, read
`packages/db/src/query/live/ARCHITECTURE.md` in full. Read it before changing
the related includes oracle tests as well.

Treat that document's component boundaries and normative laws as constraints.
If a change intentionally revises an architectural contract, update the
architecture document in the same pull request.

## Required reading: executable subsystem models

Read `docs/contributing/glossary.md` before naming or renaming a subsystem
state, action, boundary, or observation. Production code, executable models,
tests, and design documents must use the same term for the same concept. A
model may stay structurally independent, but it must declare any abstraction
that combines, splits, or does not correspond to production concepts.

Some oracle files are also the shortest documentation for their subsystem.
Before changing a covered contract or its machinery, use
`docs/contributing/oracle-coverage.md` to find the primary executable owner and
read its stated limits. Do not infer authority from a filename alone.

Read these stable entry points before the narrower owner:

- For correlated live-query materialization, read the architecture document
  required above.
- For Collection mutation admission, subscription ownership, replay,
  publication, or disposal, read
  `packages/db/tests/collection-subscription-lifecycle-grammar-oracle.ts`.
- For optimistic snapshots and settlement, read
  `packages/db/tests/optimistic-history-oracle.ts`.
- For opaque cursor pagination, read
  `packages/query-db-collection/tests/cursor-pagination/model-oracle.ts`.
- For TrailBase lifecycle work, read
  `packages/trailbase-db-collection/tests/ORACLE.md`.
- For cross-framework behavior, read the shared contract under
  `packages/db/tests/conformance/` and the receiving framework's driver. One
  framework's scheduling cut does not prove another's.

The opening prose states the contract. The small model states the expected
behavior. The production driver and comparison check whether the implementation
refines the model for the exercised histories and observations. If a change
revises one of these contracts, update all three in the same pull request. Do not update only the assertions to match new production output.

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
11. [Git and PR Hygiene](#git-and-pr-hygiene)
12. [Code Weight and Fail-Fast Design](#code-weight-and-fail-fast-design)

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

### Reject Multiple Copies of `@tanstack/db`

TanStack DB does not support interoperability between multiple copies of
`@tanstack/db` in one runtime.
Each copy has its own transaction stack and IR classes. Do not add cross-copy
expression support or shape-based fallbacks to make the copies interoperate.
Keep the existing duplicate-instance check, which throws
`DuplicateDbInstanceError` for duplicate development browser loads. Do not
replace its error with a warning. SSR and test runners may evaluate the
package twice without exchanging values; do not reject those independent
loads or add per-value tracking solely to detect unsupported cross-copy use.

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

### Required reading: oracle tests

Before designing, changing, or reviewing an oracle or generated-history test,
read [Oracle Testing Rubric](docs/contributing/oracle-rubric.md).
Use the [coverage map](docs/contributing/oracle-coverage.md) to find an existing
owner and its limits before adding another model. The guide explains testing
methods; it does not authorize new product behavior or retire existing laws.

### Write Oracle Tests as Literate Programs

Write every oracle and generated-history test as a literate program.
Combine explanatory prose with executable code so the file teaches the
subsystem contract. Follow
[ORC-003](docs/contributing/oracle-rubric.md#orc-003-distinguishable-oracle-responsibilities)
and the guide's
[literate-oracle guidance](docs/contributing/oracle-rubric.md#write-the-oracle-as-executable-subsystem-documentation).

Start with the promised law and its limits before introducing test mechanics.
Explain the central law beside the independent model. Describe the legal
history grammar, production path, public observations, and comparison checkpoint
beside the relevant code. Keep the contract, model, history grammar, production
driver, and refinement check distinguishable. Place their explanations close
enough for a reviewer to compare them directly.

Use the project glossary's terms and clear, direct prose. Explain why each
observation follows from the model. Update the prose when the executable law
changes. Code, headings, or a separate review report alone do not satisfy this
requirement.

Keep the prose proportional to the law. A compact oracle can use one opening
comment and short explanations beside its code. A focused regression may remain
short, but it does not waive this requirement for an oracle or replace
applicable oracle coverage.

### Always Add Tests for Bugs

**Key Principle:** Reproduce a bug in a test before fixing it, then follow the
[applicable oracle coverage requirements](#require-applicable-oracle-coverage).
The evidence must show:

- The bug is actually fixed
- The bug doesn't regress in the future
- The fix is validated

**Example:**

```typescript
// Found a bug with fetchSnapshot resolving after up-to-date message
// First isolate the failure in a focused regression:
test('ignores snapshot that resolves after up-to-date message', async () => {
  // Reproduce the corner case
  // Verify it's handled correctly
})

// Then extend the applicable primary oracle so the law is exercised across
// nearby legal histories.
```

### Treat Every Review Bug as a Test Gap

When a reviewer agent confirms a bug, it must also ask why the existing tests
did not catch it. The finding should name the missing test law, state
transition, generator dimension, adapter boundary, or assertion. If a test or
oracle should already have caught the bug, identify the false-green model,
classifier, fixture, or assertion that let it pass. Use that analysis to suggest
the smallest test or oracle improvement that would catch the same class of bug,
not only the reported example.

### Close the Declared Bug Class

A passing reproduction fixes one trace; it does not establish that the bug
class is closed. Before claiming closure, name the violated product law and
bound the claim by legal histories, production paths, and public observations
at specific checkpoints.

Extend the primary oracle so it reaches the reported trace and nearby legal
histories that distinguish the repair from plausible wrong designs. Use a
separate oracle owner when another boundary needs a different model. Show that
the check fails on the original implementation or a hostile mutant at the
intended checkpoint, then passes with the fix.

At closeout, state what the evidence covers. Record remaining in-scope
histories or paths in the oracle coverage map with an owner and needed witness.
A reachable in-scope counterexample keeps the class open. Passing random runs
is not a universal proof. A bug-fix pull request is not ready while a known
in-scope part of the declared bug class remains open.

Every bug-fix pull request must show how it evaluated and closed the declared
bug class. State the violated law and its authority. Name the legal histories,
production paths, and public observation checkpoints that the oracle exercises.
Include the original or hostile-mutant RED result and the repaired GREEN result.
State any remaining limits. A passing reproduction for one trace does not
satisfy this requirement.

### Keep Oracles Independent

An oracle is useful only when its expected result comes from a source independent
of the implementation under test. Do not translate production branches, state
machines, classifiers, or helper functions into a second implementation and call
that an oracle. Both copies can encode the same wrong assumption.

- Derive expected behavior from public contracts, documented prior behavior,
  mathematical laws, or a separately specified reference model.
- Keep the reference model structurally different from production. Do not import
  the production helper or reuse its classifications to compute expected results.
- Preserve existing contract tests unless a product or design decision explicitly
  changes the contract. Rewriting a passing expectation to match new production
  behavior is a design review, not routine test maintenance.
- When production work suggests an oracle change, compare the old and new
  semantics with counterexamples before editing the oracle.
- Use hostile mutants to prove the oracle rejects plausible wrong designs,
  including the mistake production currently makes. A green oracle without a
  demonstrated kill is weak evidence.
- Use process grammar to explore lifecycle paths, and design grammar to challenge
  the oracle's reference semantics. More generated traces cannot repair a wrong
  reference model.

### Require Applicable Oracle Coverage

An oracle that checks general laws across generated states and histories is a
stronger form of coverage than a unit test for one specific example. Every
production change that adds, removes, or changes observable behavior must
extend the primary oracle when that oracle can express the governing law. Add
the missing model rule, generator dimension, state transition, or observable
assertion; adding more pinned examples alone does not generalize the oracle. Do
not submit only an isolated unit test for behavior owned by an applicable
oracle. An internal refactor does not require new oracle coverage when existing
applicable oracles already exercise the unchanged contract.

Applicability follows the contract ownership recorded in
`docs/contributing/oracle-coverage.md`, not the limits of the owner's current
histories, production paths, or observations. A missing history, path, or
observation is a coverage gap in the primary owner. Add a separate oracle owner
only when the boundary requires a different independent judgment. Add a
receiving witness when a claim crosses an adapter, framework, provider, or other
integration boundary.

For a bug fix, use a focused regression to isolate and shrink the failure, then
keep it as a replay example for the broader oracle. Verify that the expanded
oracle fails without the fix and passes with it. Keep valuable unit tests as
supplemental coverage, but do not treat them as a substitute for applicable
oracle coverage. If no existing oracle applies, create one when the behavior
admits a practical independent model. For a change that is not a bug fix, a
focused test alone is acceptable only when an oracle is not practical for the
behavior. The pull request must identify the relevant coverage-map entry and
explain why extending its owner, creating a new independent oracle, or adding a
receiving witness is not practical. Bug fixes cannot use this focused-test-only
exception. They must provide evidence that closes the entire declared bug class.

### Keep Unit Tests Out of Oracles

Oracle files contain reusable laws, independent models, input or history
grammars, shared comparisons, and their execution. Do not put ordinary unit
tests or concrete type assertions in an oracle file. A filename, coverage-map
entry, contract comment, or table of fixtures does not turn examples into an
oracle.

Keep a fixed regression as input to the same model, production driver, and
comparison that the generated campaign uses. It must not carry a separate
expected answer or its own assertions. Checker calibration may supply a wrong
observation to that same comparison. Put supplemental unit tests in ordinary
test files; they do not discharge an oracle-owned coverage obligation.

For compile-time contracts, generate legal TypeScript inputs and check their
public types against a reusable independent type law. A list of
`expectTypeOf` calls or `@ts-expect-error` examples is not an oracle. Negative
checks derived by the shared law from generated inputs are permitted.

### Name Oracle Files for Discovery

Include `oracle` in filenames that own an independent reference computation,
state model, differential or metamorphic comparison, or reusable law checker.
Modules that define the model, checker, or its history grammar also qualify.
Identify the actual mechanism before renaming a file. A coverage-map entry,
contract comment, or collection of fixed assertions is not sufficient evidence.

Ordinary example tests, type assertions, fixtures, registration wrappers, and
runner utilities keep their ordinary names. A module that only drives production
or records observations is not an oracle definition. Report oracle owners and
definitions separately from supporting files; a file count is not an oracle count.
Preserve runner suffixes and update imports, commands, replay selectors, and
current documentation whenever an oracle file moves.

### Name Tests After Behavior

Test names should state the behavior they prove. Do not put issue or pull
request numbers in test names; those references become stale and make the test
suite harder to read. When an external report contains essential context that
the test cannot express, link it in a nearby comment instead.

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

## Git and PR Hygiene

### Never Rewrite Published Branch History

**Do not amend, rebase, squash, or force-push a branch after it has been pushed or has an open PR.** This includes `git push --force` and `git push --force-with-lease`.

Once a branch is visible to others, treat its history as shared. If CI fails or follow-up changes are needed, add a normal follow-up commit and push normally.

**❌ Bad:**

```bash
git commit --amend --no-edit
git push --force-with-lease
```

**✅ Good:**

```bash
git add <files>
git commit -m "fix: address CI failure"
git push
```

**Key Principles:**

- Never force-push unless the user explicitly asks for it in that moment.
- Do not assume `--force-with-lease` is acceptable; it still rewrites shared history.
- Prefer small follow-up commits over rewritten history on PR branches.
- If a clean history is desired, let the human maintainer squash or rebase during merge.
- If you think history rewriting is necessary, stop and ask for explicit confirmation before running any command.

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

## Code Weight and Fail-Fast Design

Treat production code as a continuing cost. Bug fixes and features should aim
for a net-negative production diff. Pay for new behavior by
refactoring the existing code it touches: merge duplicated logic and parallel
structures, delete indirection, and remove branches that the change makes
redundant. Refactoring existing code is the expected way to fix a bug or add a
feature. Do not graft new code onto a design and leave the old code in place.

Measure production code weight in shipped bytes, not lines. Run
`pnpm size:compare` (add `--files` for a per-file breakdown). It builds the
changed packages with the same minified build that the Compressed size CI
check uses, bundles each one as an app's production build would, and
compares gzip and brotli bytes with the merge-base on `origin/main`.
Development-only code, such as full error messages, does not count.
A package bundle keeps every export, so `size:compare` also reports
scenarios in `scripts/size-scenarios/`, each tree-shaken as an app ships it.
`app` is the typical app: a query collection, a filtered live query, and the
React adapter. Its weight reaches nearly every user, so weigh it most. Each
other scenario adds one feature to `app`, and its feature-cost column shows
what that feature adds. Comments, names, and formatting cost nothing in that measure, so
keep useful comments and clear names. Never delete a comment, shorten a name,
or reformat code to improve a code-weight number. Reduce states, branches,
helpers, and recovery paths.

When a change still grows production bytes after that work, state why. Name
the refactors you tried and the evidence that ruled them out.

Tests and contract documentation can grow to prove the behavior. Report their
weight separately from production code.

Use the test-first and bug-class guidance above to reproduce the failure and
identify the violated contract. Strengthen or simplify existing control flow
before adding state or recovery machinery.

### Separate Valid Edge Cases from Contract Contradictions

A rare but valid operation is not an invariant violation. The implementation
must support it.

An impossible internal state or a contradictory collaborator signal is an
invariant violation. Throw or reject immediately at the boundary. Check the
invariant before the code releases established state or publishes success.

Do not convert an invariant violation into false readiness, partial success,
or a silent fallback. In library code, "crash" means a synchronous throw or a
rejected promise. It does not require process termination.

### Recovery Must Earn Its Code Weight

Add retries, generations, queues, fallback states, or rollback paths only when
all these conditions are true:

- The condition can occur during valid operation.
- The public contract defines recovery behavior.
- Recovery protects user-visible behavior.
- A test or oracle proves the recovery law.

If a condition requires a programming error or contract breach, detect it and
fail loudly. Do not build a second lifecycle to recover from it.

Prefer a small change to the current abstraction over a replacement state
machine. A new state machine requires an explicit architectural reason and an
oracle law that the existing design cannot express.

For reviewer-proposed defensive machinery based only on contradictory mocks,
add an invariant witness that fails before mutation instead.

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

# `caseWhen` Operator Plan

## Goal

Add a general conditional operator modeled on SQL `CASE WHEN` expressions, with
SQLite's variadic `iif()` function as useful prior art for the compact function
signature.

The core form should be usable anywhere a normal query expression can be used:

- `select`
- `where`
- `having`
- `orderBy`
- `groupBy`
- join conditions, when it produces a valid comparison operand

In `select()` it should also be able to conditionally return objects, ref
spreads, and includes. That select projection support should work independently
of multi-source `from`; multi-source can use it later, but must not be a
prerequisite for implementing or testing `caseWhen`.

## SQLite Reference

SQLite's current `iif()` / `if()` behavior is a useful reference for compact
function-call syntax:

- `iif(B1,V1,...)` takes Boolean/value pairs.
- It returns the value for the first true Boolean.
- If there is an odd number of arguments, the final argument is the default
  value returned when all Booleans are false.
- If there is an even number of arguments and all Boolean arguments are false,
  it returns `NULL`.
- It requires at least two arguments.
- It is shorthand for `CASE`.
- It short-circuits: inactive value expressions are not evaluated, and Boolean
  expressions after the first true Boolean are not evaluated.
- The two-argument form and `if()` alias were added in SQLite 3.48.0
  (2025-01-14).
- Variadic argument support was added in SQLite 3.49.0 (2025-02-06).

TanStack DB should follow the same broad behavior, but expose it as
`caseWhen(...)` because that is closer to common SQL terminology and avoids
making SQLite-specific naming the primary API.

Target example:

```ts
const query = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .select(({ user }) => ({
      id: user.id,
      adultProfile: caseWhen(gt(user.age, 18), {
        ...user,
        posts: q
          .from({ post: postsCollection })
          .where(({ post }) => eq(post.userId, user.id))
          .orderBy(({ post }) => post.createdAt)
          .select(({ post }) => post.title),
      }),
    })),
)
```

When `user.age > 18`, `adultProfile` should exist and include `posts`. When the
condition is false, `adultProfile` should be `undefined`. This exercises
conditional projection, ref spreads, and includes without relying on
multi-source `from`.

## Why This Needs Its Own Design

`caseWhen` should be one public operator, not separate scalar and projection
APIs. The same helper can work in ordinary expression positions:

```ts
caseWhen(gt(user.age, 18), `adult`, `minor`)
```

and in select projections with object branch values:

```ts
caseWhen(message, {
  ...message,
  chunks: childQuery,
})
```

That object can contain nested select expressions, spread refs, and includes
subqueries. This means the implementation cannot always lower `caseWhen` to a
plain scalar `Func` node up front.

The helper also cannot reliably branch on call location. At runtime and in
TypeScript, `caseWhen(...)` is evaluated before it is passed to `where`,
`orderBy`, or `select`, so it does not know which query method will consume it.
The practical split is based on branch value shape:

- If every branch value is expression-like, `caseWhen` can be a normal scalar
  expression and can be used anywhere expressions are accepted.
- If any branch value is a projection object, ref spread, includes subquery, or
  other select-only value, `caseWhen` becomes a select-only projection value.

Using a projection-valued `caseWhen` in `where`, `having`, `groupBy`, `orderBy`,
or a join condition should be rejected by types where possible and with a clear
runtime error otherwise. Although an object could theoretically be returned and
then filtered on, TanStack DB's filters are SQL-like predicates rather than
JavaScript truthiness checks, so object-valued predicates would be surprising.

This keeps the public API unified while avoiding a hard "branch by call
location" implementation.

## API

Proposed helper:

```ts
caseWhen(condition, thenValue)
caseWhen(condition, thenValue, elseValue)
caseWhen(condition1, value1, condition2, value2)
caseWhen(condition1, value1, condition2, value2, elseValue)
```

Semantics:

- Evaluate condition/value pairs from left to right.
- Return the value for the first true condition.
- If a final default argument is provided, return it when no condition matches.
- If no default is provided and no condition matches:
  - scalar expression form should return `null`, matching SQLite
  - object projection branches should return `undefined`, matching projection DX
- A source alias ref, such as `message`, is a valid condition. It evaluates to
  the row object when present and `undefined` when absent.
- Inactive branches must not evaluate.

Condition truth should use the query engine's existing SQL-like predicate
semantics for scalar booleans, with one extension: non-nullish object refs should
count as true so source alias guards work naturally.

## Type Semantics

Scalar expression examples:

```ts
caseWhen(condition, thenValue) // BasicExpression<T | null>
caseWhen(condition, thenValue, elseValue) // BasicExpression<TThen | TElse>
caseWhen(c1, v1, c2, v2, fallback) // BasicExpression<V1 | V2 | Fallback>
```

Select projection examples:

```ts
caseWhen(condition, thenObject) // ThenResult | undefined
caseWhen(condition, thenObject, elseObject) // ThenResult | ElseResult
```

For the target projection example:

```ts
adultProfile: caseWhen(gt(user.age, 18), {
  ...user,
  posts: q.from(...),
})
```

the selected result should be approximately:

```ts
{
  id: number
  adultProfile:
    | (User & {
        posts: Collection<string>
      })
    | undefined
}
```

The scalar two-argument form should include `null` because that matches SQLite.
The projection two-argument form should include `undefined` because the field is
conditionally absent from the projected object.

Variadic typing should preserve branch unions but can be conservative:

```ts
type CaseWhenScalarResult<Args> =
  UnionOfValueArgs<Args> | NullIfNoDefault<Args>
```

## Scalar IR Design

For expression-like branches, use a dedicated expression node or the existing
`Func` path:

```ts
new Func(`caseWhen`, args.map(toExpression))
```

The evaluator should implement SQLite-like left-to-right short-circuiting. This
means `compileFunction` cannot eagerly evaluate every argument before deciding
which value branch is active. It can still pre-compile argument evaluators, but
must call only the necessary evaluators at row evaluation time.

Using a dedicated `CaseWhenExpression` class may be cleaner than `Func` because
the evaluator can represent condition/value pairs directly and avoid treating it
like an eager ordinary function. If `Func` is used, `compileFunction` needs a
special `caseWhen` branch before any generic argument evaluation.

## Select Projection IR Design

Add a dedicated select expression node for non-scalar branch values:

```ts
export class ConditionalSelect extends BaseExpression {
  public type = `conditionalSelect` as const

  constructor(
    public branches: Array<{
      condition: BasicExpression
      value: SelectValueIR
    }>,
    public defaultValue?: SelectValueIR,
  ) {
    super()
  }
}
```

`SelectValueIR` should represent the same values that can appear inside a select
object after lowering:

- `BasicExpression`
- `Aggregate`
- nested select objects
- `IncludesSubquery`
- spread sentinels, if still needed after `buildNestedSelect`

The exact type can be internal at first. The important part is that the then and
default branches are compiled through the same path as normal select values.

## Builder Changes

Add an exported helper in `query/builder/functions.ts`:

```ts
export function caseWhen<TArgs extends CaseWhenArgs>(
  ...args: TArgs
): CaseWhenResult<TArgs>
```

Return strategy:

- If all value/default arguments are scalar expression-like values, return a
  scalar conditional expression.
- If any value/default argument is a select object, ref spread, includes
  subquery, `toArray` wrapper, or other select-only value, return a
  `CaseWhenWrapper` that is only valid inside `select()`.

This does not depend on call location. It only depends on the branch values
provided to `caseWhen`.

The wrapper should hold raw user values until `buildNestedSelect` lowers them,
mirroring how includes subqueries and `toArray` wrappers are detected during
select building.

`buildNestedSelect` should detect `CaseWhenWrapper` and recursively lower:

- condition arguments via `toExpression`
- value/default arguments via `buildNestedSelect`

The resulting IR node is `ConditionalSelect`.

## Compiler Changes

Scalar expression compiler:

- Add `caseWhen` handling to `compileFunction`.
- Validate at runtime or builder time that there are at least two arguments.
- Interpret arguments as condition/value pairs plus optional default.
- Use short-circuit evaluation.
- Return `null` when no condition matches and no default exists.
- Reject select-only branch values before expression compilation. These should
  never reach `compileExpression`, but the error should be explicit if they do.

Select projection compiler:

- Update select compilation so `ConditionalSelect` is handled wherever select
  values are compiled.

Select projection runtime behavior:

1. Compile each condition expression once.
2. Compile each branch value using the existing select-value compiler.
3. Compile the default value if provided.
4. At row evaluation time:
   - evaluate conditions left to right
   - evaluate and return the first matching branch value
   - otherwise evaluate and return the default value
   - otherwise return `undefined`

Important: the inactive branch should not evaluate. This matters for refs like
`message.id` that only exist on one source branch, and for includes routing.

## Includes Interaction

Includes inside an inactive `caseWhen` branch should not materialize for that row.

Implementation direction:

- `extractIncludesFromSelect` needs to traverse into `ConditionalSelect`
  branches.
- Include routing should preserve the full conditional guard chain for includes
  found under a `caseWhen`.
- When parent routing is generated, only emit a parent key for a guarded include
  if the guard evaluates as active.

This is the core reason projection `caseWhen` should be represented explicitly
in the select IR: the include compiler needs to know that a child include is
conditional on a parent row shape.

## Tests

Add runtime tests:

- scalar `caseWhen(condition, thenValue)` returns `thenValue` or `null`.
- scalar `caseWhen(condition, thenValue, elseValue)` returns the expected branch.
- variadic scalar `caseWhen(c1, v1, c2, v2, fallback)` returns the first matching
  branch or fallback.
- variadic scalar `caseWhen(c1, v1, c2, v2)` returns `null` when no branch
  matches.
- The inactive branch is not evaluated.
- Nested object projection works.
- `caseWhen` works with ref spreads.
- `caseWhen` works with scalar then/else values.
- scalar `caseWhen` works in `where`, `orderBy`, `groupBy`, `having`, and
  selected expressions.
- projection-valued `caseWhen` works in `select()` for a normal single-source
  query.
- projection-valued `caseWhen` works in `select()` with a normal joined query,
  such as conditionally projecting the optional side of a left join.
- includes inside `caseWhen` only materialize for rows where the guard is true.
- future integration: multi-source `from` with
  `caseWhen(message, { ...message, chunks })` behaves as expected once
  multi-source `from` exists.

Add type tests:

- scalar two-argument `caseWhen` returns `BasicExpression<T | null>`.
- scalar three-argument `caseWhen` returns `BasicExpression<TThen | TElse>`.
- scalar variadic `caseWhen` unions all value/default branch types.
- projection two-argument `caseWhen` adds `| undefined`.
- projection three-argument `caseWhen` returns the union of then and else result
  types.
- projection variadic `caseWhen` unions all value/default branch result types.
- projection-valued `caseWhen` is accepted as a `select()` field.
- projection-valued `caseWhen` is rejected in expression helper types where that
  is practical.
- object projections preserve nested field types.
- includes inside a `caseWhen` branch infer as `Collection<Child>` or array/string
  according to existing includes materialization rules.
- source alias conditions are accepted.

## Suggested Implementation Phases

1. Add scalar `caseWhen` helper returning a scalar expression for
   expression-like branches.
2. Add short-circuit scalar evaluator support for `caseWhen`.
3. Add scalar runtime and type tests, including variadic forms.
4. Add `CaseWhenWrapper` for select-only branch values, selected by branch value
   shape rather than call location.
5. Add `ConditionalSelect` IR.
6. Lower `CaseWhenWrapper` in `buildNestedSelect`.
7. Teach select result typing about projection `CaseWhenWrapper`.
8. Compile `ConditionalSelect` for ordinary select objects.
9. Add explicit errors for projection-valued `caseWhen` in expression contexts.
10. Add object projection tests using ordinary single-source and joined queries.
11. Add include extraction/routing support for guarded includes.
12. Add multi-source `from` integration tests later, once that feature exists.

## Open Questions

- Should scalar `caseWhen` exactly match SQL/SQLite's `NULL` fallback while
  projection `caseWhen` uses `undefined`, or should both forms use one fallback
  value for consistency?
- What is the exact condition truth rule for non-boolean values? The likely
  answer is SQL-like predicate truth for scalar values plus non-nullish object
  truth for alias guards.

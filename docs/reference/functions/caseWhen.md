---
id: caseWhen
title: caseWhen
---

```ts
function caseWhen<T>(...args): CaseWhenOutput<T>;
```

Defined in: [packages/db/src/query/builder/functions.ts:494](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L494)

Returns the value for the first matching condition, similar to SQL
`CASE WHEN`.

Arguments are evaluated as condition/value pairs followed by an optional
default value. Scalar branch values return a query expression and can be used
in expression contexts like `select`, `where`, `orderBy`, `groupBy`,
`having`, and equality join operands. If no scalar branch matches and no
default is provided, the result is `null`.

When a branch value is a projection object, `caseWhen` becomes a select-only
projection value. Projection branches can include nested fields, ref spreads,
and includes. If no projection branch matches and no default is provided, the
result is `undefined`.

## Type Parameters

### T

`T` *extends* \[`ExpressionLike`, `CaseWhenValue`, `...CaseWhenValue[]`\]

## Parameters

### args

...`T` & `T` *extends* \[`unknown`, `unknown`, `...Rest[]`\] ? \[`ExpressionLike`, `CaseWhenValue`, `...(Rest extends [unknown, unknown, ...Rest[]] ? [ExpressionLike, CaseWhenValue, ...(Rest extends [unknown, unknown, ...Rest[]] ? [ExpressionLike, CaseWhenValue, ...(Rest extends [unknown, unknown, ...Rest[]] ? [ExpressionLike, CaseWhenValue, ...(Rest extends [(...), (...), ...(...)[]] ? [(...), (...), ...(...)[]] : Rest)[]] : Rest)[]] : Rest)[]] : Rest)[]`\] : `T`

## Returns

`CaseWhenOutput`\<`T`\>

## Examples

```ts
caseWhen(gt(user.age, 18), `adult`, `minor`)
```

```ts
caseWhen(
  gt(user.age, 65),
  `senior`,
  gt(user.age, 18),
  `adult`,
  `minor`,
)
```

```ts
caseWhen(gt(user.age, 18), {
  ...user,
  posts: include(
    q
      .from({ post: postsCollection })
      .where(({ post }) => eq(post.userId, user.id)),
  ),
})
```

---
id: groupingCompiler
title: groupingCompiler
---

```ts
const groupingCompiler: object;
```

Defined in: [packages/db/src/query/compiler/grouping.ts:7](https://github.com/TanStack/db/blob/main/packages/db/src/query/compiler/grouping.ts#L7)

The grouping compiler. Aggregate values and `groupKeys` carry it onto the
query IR, so apps that never group or aggregate do not bundle it.

## Type Declaration

### processGroupBy()

```ts
processGroupBy: (pipeline, groupByClause, valueIdentity, isSourceRef, havingClauses?, selectClause?, fnHavingClauses?, aggregateCollectionId?, mainSource?, sanitizeCallbackRows) => NamespacedAndKeyedStream;
```

Processes the GROUP BY clause with optional HAVING and SELECT
Works with the new $selected structure from early SELECT processing

#### Parameters

##### pipeline

[`NamespacedAndKeyedStream`](../type-aliases/NamespacedAndKeyedStream.md)

##### groupByClause

[`GroupBy`](../@tanstack/namespaces/IR/type-aliases/GroupBy.md)

##### valueIdentity

`ValueIdentity`

##### isSourceRef

(`ref`) => `boolean`

Whether a ref reads a field of the query's own rows.

##### havingClauses?

[`Where`](../@tanstack/namespaces/IR/type-aliases/Where.md)[]

##### selectClause?

[`Select`](../@tanstack/namespaces/IR/type-aliases/Select.md)

##### fnHavingClauses?

(`row`) => `any`[]

##### aggregateCollectionId?

`string`

##### mainSource?

`string`

##### sanitizeCallbackRows?

`boolean` = `false`

#### Returns

[`NamespacedAndKeyedStream`](../type-aliases/NamespacedAndKeyedStream.md)

### replaceAggregatesByRefs()

```ts
replaceAggregatesByRefs: (havingExpr, selectClause, resultAlias) => BasicExpression;
```

Transforms expressions to replace aggregate functions with references to computed values.

For aggregate expressions, finds matching aggregates in the SELECT clause and replaces them
with PropRef([resultAlias, alias]) to reference the computed aggregate value.

Ref expressions (table columns and $selected fields) and value expressions are passed through unchanged.
Function expressions are recursively transformed.

#### Parameters

##### havingExpr

The expression to transform (can be aggregate, ref, func, or val)

[`Aggregate`](../@tanstack/namespaces/IR/classes/Aggregate.md)\<`any`\> | [`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)

##### selectClause

[`Select`](../@tanstack/namespaces/IR/type-aliases/Select.md)

The SELECT clause containing aliases and aggregate definitions

##### resultAlias

`string` = `...`

The namespace alias for SELECT results (default: '$selected')

#### Returns

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)

A transformed BasicExpression that references computed values instead of raw expressions

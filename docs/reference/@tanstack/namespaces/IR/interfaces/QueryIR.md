---
id: QueryIR
title: QueryIR
---

Defined in: [packages/db/src/query/ir.ts:16](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L16)

## Properties

### distinct?

```ts
optional distinct: true;
```

Defined in: [packages/db/src/query/ir.ts:28](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L28)

***

### fnHaving?

```ts
optional fnHaving: (row) => any[];
```

Defined in: [packages/db/src/query/ir.ts:34](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L34)

#### Parameters

##### row

[`NamespacedRow`](../../../../type-aliases/NamespacedRow.md)

#### Returns

`any`

***

### fnSelect()?

```ts
optional fnSelect: (row) => any;
```

Defined in: [packages/db/src/query/ir.ts:32](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L32)

#### Parameters

##### row

[`NamespacedRow`](../../../../type-aliases/NamespacedRow.md)

#### Returns

`any`

***

### fnWhere?

```ts
optional fnWhere: (row) => any[];
```

Defined in: [packages/db/src/query/ir.ts:33](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L33)

#### Parameters

##### row

[`NamespacedRow`](../../../../type-aliases/NamespacedRow.md)

#### Returns

`any`

***

### from

```ts
from: From;
```

Defined in: [packages/db/src/query/ir.ts:17](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L17)

***

### groupBy?

```ts
optional groupBy: GroupBy;
```

Defined in: [packages/db/src/query/ir.ts:21](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L21)

***

### grouping?

```ts
optional grouping: object;
```

Defined in: [packages/db/src/query/ir.ts:23](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L23)

#### processGroupBy()

```ts
processGroupBy: (pipeline, groupByClause, valueIdentity, isSourceRef, havingClauses?, selectClause?, fnHavingClauses?, aggregateCollectionId?, mainSource?, sanitizeCallbackRows) => NamespacedAndKeyedStream;
```

Processes the GROUP BY clause with optional HAVING and SELECT
Works with the new $selected structure from early SELECT processing

##### Parameters

###### pipeline

[`NamespacedAndKeyedStream`](../../../../type-aliases/NamespacedAndKeyedStream.md)

###### groupByClause

[`GroupBy`](../type-aliases/GroupBy.md)

###### valueIdentity

`ValueIdentity`

###### isSourceRef

(`ref`) => `boolean`

Whether a ref reads a field of the query's own rows.

###### havingClauses?

[`Where`](../type-aliases/Where.md)[]

###### selectClause?

[`Select`](../type-aliases/Select.md)

###### fnHavingClauses?

(`row`) => `any`[]

###### aggregateCollectionId?

`string`

###### mainSource?

`string`

###### sanitizeCallbackRows?

`boolean` = `false`

##### Returns

[`NamespacedAndKeyedStream`](../../../../type-aliases/NamespacedAndKeyedStream.md)

#### replaceAggregatesByRefs()

```ts
replaceAggregatesByRefs: (havingExpr, selectClause, resultAlias) => BasicExpression;
```

Transforms expressions to replace aggregate functions with references to computed values.

For aggregate expressions, finds matching aggregates in the SELECT clause and replaces them
with PropRef([resultAlias, alias]) to reference the computed aggregate value.

Ref expressions (table columns and $selected fields) and value expressions are passed through unchanged.
Function expressions are recursively transformed.

##### Parameters

###### havingExpr

The expression to transform (can be aggregate, ref, func, or val)

[`Aggregate`](../classes/Aggregate.md)\<`any`\> | [`BasicExpression`](../type-aliases/BasicExpression.md)

###### selectClause

[`Select`](../type-aliases/Select.md)

The SELECT clause containing aliases and aggregate definitions

###### resultAlias

`string` = `...`

The namespace alias for SELECT results (default: '$selected')

##### Returns

[`BasicExpression`](../type-aliases/BasicExpression.md)

A transformed BasicExpression that references computed values instead of raw expressions

***

### having?

```ts
optional having: Where[];
```

Defined in: [packages/db/src/query/ir.ts:24](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L24)

***

### join?

```ts
optional join: Join;
```

Defined in: [packages/db/src/query/ir.ts:19](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L19)

***

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/query/ir.ts:26](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L26)

***

### offset?

```ts
optional offset: number;
```

Defined in: [packages/db/src/query/ir.ts:27](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L27)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/query/ir.ts:25](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L25)

***

### select?

```ts
optional select: Select;
```

Defined in: [packages/db/src/query/ir.ts:18](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L18)

***

### singleResult?

```ts
optional singleResult: true;
```

Defined in: [packages/db/src/query/ir.ts:29](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L29)

***

### where?

```ts
optional where: Where[];
```

Defined in: [packages/db/src/query/ir.ts:20](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L20)

---
id: Aggregate
title: Aggregate
---

Defined in: [packages/db/src/query/ir.ts:274](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L274)

## Extends

- `BaseExpression`\<`T`\>

## Type Parameters

### T

`T` = `any`

## Constructors

### Constructor

```ts
new Aggregate<T>(
   name, 
   args, 
grouping): Aggregate<T>;
```

Defined in: [packages/db/src/query/ir.ts:276](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L276)

#### Parameters

##### name

`string`

##### args

[`BasicExpression`](../type-aliases/BasicExpression.md)\<`any`\>[]

##### grouping

###### processGroupBy

(`pipeline`, `groupByClause`, `valueIdentity`, `isSourceRef`, `havingClauses?`, `selectClause?`, `fnHavingClauses?`, `aggregateCollectionId?`, `mainSource?`, `sanitizeCallbackRows`) => [`NamespacedAndKeyedStream`](../../../../type-aliases/NamespacedAndKeyedStream.md)

###### replaceAggregatesByRefs

(`havingExpr`, `selectClause`, `resultAlias`) => [`BasicExpression`](../type-aliases/BasicExpression.md)

#### Returns

`Aggregate`\<`T`\>

#### Overrides

```ts
BaseExpression<T>.constructor
```

## Properties

### \_\_returnType

```ts
readonly __returnType: T;
```

Defined in: [packages/db/src/query/ir.ts:97](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L97)

**`Internal`**

- Type brand for TypeScript inference

#### Inherited from

```ts
BaseExpression.__returnType
```

***

### args

```ts
args: BasicExpression<any>[];
```

Defined in: [packages/db/src/query/ir.ts:278](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L278)

***

### grouping

```ts
grouping: object;
```

Defined in: [packages/db/src/query/ir.ts:280](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L280)

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

`Aggregate`\<`any`\> | [`BasicExpression`](../type-aliases/BasicExpression.md)

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

### name

```ts
name: string;
```

Defined in: [packages/db/src/query/ir.ts:277](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L277)

***

### type

```ts
type: "agg";
```

Defined in: [packages/db/src/query/ir.ts:275](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L275)

#### Overrides

```ts
BaseExpression.type
```

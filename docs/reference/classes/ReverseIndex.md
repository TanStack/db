---
id: ReverseIndex
title: ReverseIndex
---

# Class: ReverseIndex\<TKey\>

Defined in: [packages/db/src/indexes/reverse-index.ts:4](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L4)

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number`

## Implements

- [`IndexReader`](../type-aliases/IndexReader.md)\<`TKey`\>

## Constructors

### Constructor

```ts
new ReverseIndex<TKey>(index): ReverseIndex<TKey>;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:9](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L9)

#### Parameters

##### index

[`IndexInterface`](../interfaces/IndexInterface.md)\<`TKey`\>

#### Returns

`ReverseIndex`\<`TKey`\>

## Accessors

### keyCount

#### Get Signature

```ts
get keyCount(): number;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:55](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L55)

##### Returns

`number`

#### Implementation of

```ts
IndexReader.keyCount
```

***

### supportsRangeOptimization

#### Get Signature

```ts
get supportsRangeOptimization(): boolean;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:47](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L47)

Whether range lookups (gt/gte/lt/lte) on this index can be trusted to
return every matching key. Range traversal relies on the index ordering, so
it is unsafe when the index uses a custom comparator, whose order may not
match the WHERE evaluator's relational operators. Callers must fall back to
a full scan when this is `false`.

##### Returns

`boolean`

#### Implementation of

```ts
IndexReader.supportsRangeOptimization
```

## Methods

### canOptimizeRangeFor()

```ts
canOptimizeRangeFor(value): boolean;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:51](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L51)

Whether the live values in this index share the predicate operand's
relational domain. Mixed domains can sort differently in the index and
WHERE evaluator, which can make a range lookup omit matching rows.

#### Parameters

##### value

`unknown`

#### Returns

`boolean`

#### Implementation of

```ts
IndexReader.canOptimizeRangeFor
```

***

### lookup()

```ts
lookup(operation, value): Set<TKey>;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:15](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L15)

#### Parameters

##### operation

`"eq"` | `"gt"` | `"gte"` | `"lt"` | `"lte"` | `"in"` | `"like"` | `"ilike"`

##### value

`any`

#### Returns

`Set`\<`TKey`\>

#### Implementation of

```ts
IndexReader.lookup
```

***

### rangeQuery()

```ts
rangeQuery(options): Set<TKey>;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:29](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L29)

#### Parameters

##### options

[`BTreeRangeQueryOptions`](../interfaces/BTreeRangeQueryOptions.md) = `{}`

#### Returns

`Set`\<`TKey`\>

#### Implementation of

```ts
IndexReader.rangeQuery
```

***

### supports()

```ts
supports(operation): boolean;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:43](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L43)

#### Parameters

##### operation

`"eq"` | `"gt"` | `"gte"` | `"lt"` | `"lte"` | `"in"` | `"like"` | `"ilike"`

#### Returns

`boolean`

#### Implementation of

```ts
IndexReader.supports
```

***

### take()

```ts
take(
   n, 
   from, 
   filterFn?): TKey[];
```

Defined in: [packages/db/src/indexes/reverse-index.ts:33](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L33)

#### Parameters

##### n

`number`

##### from

`any`

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

#### Implementation of

```ts
IndexReader.take
```

***

### takeFromStart()

```ts
takeFromStart(n, filterFn?): TKey[];
```

Defined in: [packages/db/src/indexes/reverse-index.ts:37](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L37)

#### Parameters

##### n

`number`

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

#### Implementation of

```ts
IndexReader.takeFromStart
```

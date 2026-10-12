---
id: ReverseIndex
title: ReverseIndex
---

Defined in: [packages/db/src/indexes/reverse-index.ts:5](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L5)

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number`

## Implements

- [`IndexReader`](../type-aliases/IndexReader.md)\<`TKey`\>

## Constructors

### Constructor

```ts
new ReverseIndex<TKey>(index, nullsFirst?): ReverseIndex<TKey>;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:16](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L16)

#### Parameters

##### index

[`IndexInterface`](../interfaces/IndexInterface.md)\<`TKey`\>

##### nullsFirst?

`boolean`

Whether nullish values come first in the reversed
order. The original index keeps them at the opposite end, so reversing
it alone would move them; ordered reads put them back. Omit it to read
the original index's plain reversed walk, as earlier releases did.

#### Returns

`ReverseIndex`\<`TKey`\>

## Accessors

### keyCount

#### Get Signature

```ts
get keyCount(): number;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:110](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L110)

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

Defined in: [packages/db/src/indexes/reverse-index.ts:102](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L102)

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

Defined in: [packages/db/src/indexes/reverse-index.ts:106](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L106)

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

Defined in: [packages/db/src/indexes/reverse-index.ts:25](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L25)

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

Defined in: [packages/db/src/indexes/reverse-index.ts:39](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L39)

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

Defined in: [packages/db/src/indexes/reverse-index.ts:98](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L98)

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

Defined in: [packages/db/src/indexes/reverse-index.ts:49](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L49)

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

Defined in: [packages/db/src/indexes/reverse-index.ts:56](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L56)

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

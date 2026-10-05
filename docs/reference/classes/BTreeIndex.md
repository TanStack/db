---
id: BTreeIndex
title: BTreeIndex
---

Defined in: [packages/db/src/indexes/btree-index.ts:41](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L41)

B+Tree index for sorted data with range queries
This maintains items in sorted order and provides efficient range operations

## Extends

- [`BaseIndex`](BaseIndex.md)\<`TKey`\>

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Constructors

### Constructor

```ts
new BTreeIndex<TKey>(
   id, 
   expression, 
   name?, 
options?): BTreeIndex<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:139](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L139)

#### Parameters

##### id

`number`

##### expression

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)

##### name?

`string`

##### options?

`any`

#### Returns

`BTreeIndex`\<`TKey`\>

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`constructor`](BaseIndex.md#constructor)

## Properties

### compareFn()

```ts
protected readonly compareFn: (a, b) => number;
```

Defined in: [packages/db/src/indexes/base-index.ts:130](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L130)

Orders indexed values. Every result is checked, because a custom
comparator or custom collation may be supplied by the user.

#### Parameters

##### a

`any`

##### b

`any`

#### Returns

`number`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`compareFn`](BaseIndex.md#comparefn)

***

### compareOptions

```ts
protected readonly compareOptions: CompareOptions;
```

Defined in: [packages/db/src/indexes/base-index.ts:125](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L125)

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`compareOptions`](BaseIndex.md#compareoptions)

***

### expression

```ts
readonly expression: BasicExpression;
```

Defined in: [packages/db/src/indexes/base-index.ts:123](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L123)

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`expression`](BaseIndex.md#expression)

***

### hasCustomComparator

```ts
protected readonly hasCustomComparator: boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:136](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L136)

A user-supplied comparator's ordering may not match the WHERE evaluator's
relational operators.

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`hasCustomComparator`](BaseIndex.md#hascustomcomparator)

***

### id

```ts
readonly id: number;
```

Defined in: [packages/db/src/indexes/base-index.ts:121](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L121)

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`id`](BaseIndex.md#id)

***

### name?

```ts
readonly optional name: string;
```

Defined in: [packages/db/src/indexes/base-index.ts:122](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L122)

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`name`](BaseIndex.md#name)

***

### supportedOperations

```ts
readonly supportedOperations: Set<"eq" | "gt" | "gte" | "lt" | "lte" | "in" | "like" | "ilike">;
```

Defined in: [packages/db/src/indexes/btree-index.ts:44](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L44)

#### Overrides

[`BaseIndex`](BaseIndex.md).[`supportedOperations`](BaseIndex.md#supportedoperations)

## Accessors

### keyCount

#### Get Signature

```ts
get keyCount(): number;
```

Defined in: [packages/db/src/indexes/btree-index.ts:262](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L262)

Gets the number of indexed keys

##### Returns

`number`

#### Overrides

[`BaseIndex`](BaseIndex.md).[`keyCount`](BaseIndex.md#keycount)

***

### supportsRangeOptimization

#### Get Signature

```ts
get supportsRangeOptimization(): boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:205](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L205)

Whether range lookups (gt/gte/lt/lte) on this index can be trusted to
return every matching key. Range traversal relies on the index ordering, so
it is unsafe when the index uses a custom comparator, whose order may not
match the WHERE evaluator's relational operators. Callers must fall back to
a full scan when this is `false`.

##### Returns

`boolean`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`supportsRangeOptimization`](BaseIndex.md#supportsrangeoptimization)

## Methods

### add()

```ts
add(key, item): void;
```

Defined in: [packages/db/src/indexes/btree-index.ts:76](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L76)

Adds a value to the index

#### Parameters

##### key

`TKey`

##### item

`any`

#### Returns

`void`

#### Overrides

[`BaseIndex`](BaseIndex.md).[`add`](BaseIndex.md#add)

***

### addRangeValue()

```ts
protected addRangeValue(value): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:209](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L209)

#### Parameters

##### value

`unknown`

#### Returns

`void`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`addRangeValue`](BaseIndex.md#addrangevalue)

***

### build()

```ts
build(entries): void;
```

Defined in: [packages/db/src/indexes/btree-index.ts:210](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L210)

Builds the index from a collection of entries

#### Parameters

##### entries

`Iterable`\<\[`TKey`, `any`\]\>

#### Returns

`void`

#### Overrides

[`BaseIndex`](BaseIndex.md).[`build`](BaseIndex.md#build)

***

### canOptimizeRangeFor()

```ts
canOptimizeRangeFor(value): boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:231](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L231)

Whether the live values in this index share the predicate operand's
relational domain. Mixed domains can sort differently in the index and
WHERE evaluator, which can make a range lookup omit matching rows.

#### Parameters

##### value

`unknown`

#### Returns

`boolean`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`canOptimizeRangeFor`](BaseIndex.md#canoptimizerangefor)

***

### clear()

```ts
clear(): void;
```

Defined in: [packages/db/src/indexes/btree-index.ts:221](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L221)

Clears all data from the index

#### Returns

`void`

#### Overrides

[`BaseIndex`](BaseIndex.md).[`clear`](BaseIndex.md#clear)

***

### clearRangeValues()

```ts
protected clearRangeValues(): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:227](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L227)

#### Returns

`void`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`clearRangeValues`](BaseIndex.md#clearrangevalues)

***

### equalityLookup()

```ts
equalityLookup(value): Set<TKey>;
```

Defined in: [packages/db/src/indexes/btree-index.ts:271](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L271)

Performs an equality lookup

#### Parameters

##### value

`any`

#### Returns

`Set`\<`TKey`\>

#### Overrides

[`BaseIndex`](BaseIndex.md).[`equalityLookup`](BaseIndex.md#equalitylookup)

***

### evaluateIndexExpression()

```ts
protected evaluateIndexExpression(item): any;
```

Defined in: [packages/db/src/indexes/base-index.ts:299](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L299)

#### Parameters

##### item

`any`

#### Returns

`any`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`evaluateIndexExpression`](BaseIndex.md#evaluateindexexpression)

***

### inArrayLookup()

```ts
inArrayLookup(values): Set<TKey>;
```

Defined in: [packages/db/src/indexes/btree-index.ts:416](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L416)

Performs an IN array lookup

#### Parameters

##### values

`any`[]

#### Returns

`Set`\<`TKey`\>

#### Overrides

[`BaseIndex`](BaseIndex.md).[`inArrayLookup`](BaseIndex.md#inarraylookup)

***

### initialize()

```ts
protected initialize(_options?): void;
```

Defined in: [packages/db/src/indexes/btree-index.ts:71](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L71)

#### Parameters

##### \_options?

`BTreeIndexOptions`

#### Returns

`void`

#### Overrides

[`BaseIndex`](BaseIndex.md).[`initialize`](BaseIndex.md#initialize)

***

### lookup()

```ts
lookup(operation, value): Set<TKey>;
```

Defined in: [packages/db/src/indexes/btree-index.ts:231](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L231)

Performs a lookup operation

#### Parameters

##### operation

`"eq"` | `"gt"` | `"gte"` | `"lt"` | `"lte"` | `"in"` | `"like"` | `"ilike"`

##### value

`any`

#### Returns

`Set`\<`TKey`\>

#### Overrides

[`BaseIndex`](BaseIndex.md).[`lookup`](BaseIndex.md#lookup)

***

### matchesCompareOptions()

```ts
matchesCompareOptions(compareOptions): boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:253](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L253)

Checks if the compare options match the index's compare options.
The direction is ignored because the index can be reversed if the direction is different.

#### Parameters

##### compareOptions

`CompareOptions`

#### Returns

`boolean`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`matchesCompareOptions`](BaseIndex.md#matchescompareoptions)

***

### matchesDirection()

```ts
matchesDirection(direction): boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:293](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L293)

Checks if the index matches the provided direction.

#### Parameters

##### direction

[`OrderByDirection`](../@tanstack/namespaces/IR/type-aliases/OrderByDirection.md)

#### Returns

`boolean`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`matchesDirection`](BaseIndex.md#matchesdirection)

***

### matchesField()

```ts
matchesField(fieldPath): boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:241](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L241)

#### Parameters

##### fieldPath

`string`[]

#### Returns

`boolean`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`matchesField`](BaseIndex.md#matchesfield)

***

### rangeQuery()

```ts
rangeQuery(options): Set<TKey>;
```

Defined in: [packages/db/src/indexes/btree-index.ts:280](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L280)

Performs a range query with options
This is more efficient for compound queries like "WHERE a > 5 AND a < 10"

#### Parameters

##### options

[`BTreeRangeQueryOptions`](../interfaces/BTreeRangeQueryOptions.md) = `{}`

#### Returns

`Set`\<`TKey`\>

#### Overrides

[`BaseIndex`](BaseIndex.md).[`rangeQuery`](BaseIndex.md#rangequery)

***

### rangeQueryReversed()

```ts
rangeQueryReversed(options): Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:187](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L187)

#### Parameters

##### options

[`BTreeRangeQueryOptions`](../interfaces/BTreeRangeQueryOptions.md) = `{}`

#### Returns

`Set`\<`TKey`\>

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`rangeQueryReversed`](BaseIndex.md#rangequeryreversed)

***

### remove()

```ts
remove(key, item): void;
```

Defined in: [packages/db/src/indexes/btree-index.ts:124](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L124)

Removes a value from the index

#### Parameters

##### key

`TKey`

##### item

`any`

#### Returns

`void`

#### Overrides

[`BaseIndex`](BaseIndex.md).[`remove`](BaseIndex.md#remove)

***

### removeRangeValue()

```ts
protected removeRangeValue(value): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:218](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L218)

#### Parameters

##### value

`unknown`

#### Returns

`void`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`removeRangeValue`](BaseIndex.md#removerangevalue)

***

### supports()

```ts
supports(operation): boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:201](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L201)

#### Parameters

##### operation

`"eq"` | `"gt"` | `"gte"` | `"lt"` | `"lte"` | `"in"` | `"like"` | `"ilike"`

#### Returns

`boolean`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`supports`](BaseIndex.md#supports)

***

### take()

```ts
take(
   n, 
   from, 
   filterFn?): TKey[];
```

Defined in: [packages/db/src/indexes/btree-index.ts:362](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L362)

Returns the next n items after the provided item.

#### Parameters

##### n

`number`

The number of items to return

##### from

`any`

The item to start from (exclusive).

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

The next n items after the provided key.

#### Overrides

[`BaseIndex`](BaseIndex.md).[`take`](BaseIndex.md#take)

***

### takeFromStart()

```ts
takeFromStart(n, filterFn?): TKey[];
```

Defined in: [packages/db/src/indexes/btree-index.ts:375](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L375)

Returns the first n items from the beginning.

#### Parameters

##### n

`number`

The number of items to return

##### filterFn?

(`key`) => `boolean`

Optional filter function

#### Returns

`TKey`[]

The first n items

#### Overrides

[`BaseIndex`](BaseIndex.md).[`takeFromStart`](BaseIndex.md#takefromstart)

***

### takeReversed()

```ts
takeReversed(
   n, 
   from, 
   filterFn?): TKey[];
```

Defined in: [packages/db/src/indexes/btree-index.ts:387](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L387)

Returns the next n items **before** the provided item (in descending order).

#### Parameters

##### n

`number`

The number of items to return

##### from

`any`

The item to start from (exclusive). Required.

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

The next n items **before** the provided key.

#### Overrides

[`BaseIndex`](BaseIndex.md).[`takeReversed`](BaseIndex.md#takereversed)

***

### takeReversedFromEnd()

```ts
takeReversedFromEnd(n, filterFn?): TKey[];
```

Defined in: [packages/db/src/indexes/btree-index.ts:404](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L404)

Returns the last n items from the end.

#### Parameters

##### n

`number`

The number of items to return

##### filterFn?

(`key`) => `boolean`

Optional filter function

#### Returns

`TKey`[]

The last n items

#### Overrides

[`BaseIndex`](BaseIndex.md).[`takeReversedFromEnd`](BaseIndex.md#takereversedfromend)

***

### update()

```ts
update(
   key, 
   oldItem, 
   newItem): void;
```

Defined in: [packages/db/src/indexes/btree-index.ts:177](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L177)

Updates a value in the index

#### Parameters

##### key

`TKey`

##### oldItem

`any`

##### newItem

`any`

#### Returns

`void`

#### Overrides

[`BaseIndex`](BaseIndex.md).[`update`](BaseIndex.md#update)

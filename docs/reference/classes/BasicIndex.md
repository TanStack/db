---
id: BasicIndex
title: BasicIndex
---

Defined in: [packages/db/src/indexes/basic-index.ts:37](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L37)

Basic index using Map + sorted Array.

- Map for O(1) equality lookups
- Sorted Array for O(log n) range queries via binary search
- O(n) updates to maintain sort order

Simpler and smaller than BTreeIndex, good for read-heavy workloads.
Use BTreeIndex for write-heavy workloads with large collections.

## Extends

- [`BaseIndex`](BaseIndex.md)\<`TKey`\>

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Constructors

### Constructor

```ts
new BasicIndex<TKey>(
   id, 
   expression, 
   name?, 
options?): BasicIndex<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:158](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L158)

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

`BasicIndex`\<`TKey`\>

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`constructor`](BaseIndex.md#constructor)

## Properties

### compareFn()

```ts
protected readonly compareFn: (a, b) => number;
```

Defined in: [packages/db/src/indexes/base-index.ts:149](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L149)

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

Defined in: [packages/db/src/indexes/base-index.ts:144](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L144)

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`compareOptions`](BaseIndex.md#compareoptions)

***

### expression

```ts
readonly expression: BasicExpression;
```

Defined in: [packages/db/src/indexes/base-index.ts:142](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L142)

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`expression`](BaseIndex.md#expression)

***

### hasCustomComparator

```ts
protected readonly hasCustomComparator: boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:155](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L155)

A user-supplied comparator's ordering may not match the WHERE evaluator's
relational operators.

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`hasCustomComparator`](BaseIndex.md#hascustomcomparator)

***

### id

```ts
readonly id: number;
```

Defined in: [packages/db/src/indexes/base-index.ts:140](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L140)

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`id`](BaseIndex.md#id)

***

### name?

```ts
readonly optional name: string;
```

Defined in: [packages/db/src/indexes/base-index.ts:141](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L141)

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`name`](BaseIndex.md#name)

***

### supportedOperations

```ts
readonly supportedOperations: Set<"eq" | "gt" | "gte" | "lt" | "lte" | "in" | "like" | "ilike">;
```

Defined in: [packages/db/src/indexes/base-index.ts:143](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L143)

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`supportedOperations`](BaseIndex.md#supportedoperations)

## Accessors

### keyCount

#### Get Signature

```ts
get keyCount(): number;
```

Defined in: [packages/db/src/indexes/basic-index.ts:234](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L234)

Gets the number of indexed keys

##### Returns

`number`

#### Overrides

[`BaseIndex`](BaseIndex.md).[`keyCount`](BaseIndex.md#keycount)

***

### supportsOrderOptimization

#### Get Signature

```ts
get supportsOrderOptimization(): boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:259](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L259)

Whether a query can use this index for its declared ordered prefix.

##### Returns

`boolean`

Whether a query can use this index for its declared ordered prefix.

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`supportsOrderOptimization`](BaseIndex.md#supportsorderoptimization)

***

### supportsRangeOptimization

#### Get Signature

```ts
get supportsRangeOptimization(): boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:255](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L255)

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

Defined in: [packages/db/src/indexes/basic-index.ts:51](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L51)

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

Defined in: [packages/db/src/indexes/base-index.ts:277](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L277)

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

Defined in: [packages/db/src/indexes/basic-index.ts:182](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L182)

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

Defined in: [packages/db/src/indexes/base-index.ts:299](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L299)

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

Defined in: [packages/db/src/indexes/basic-index.ts:213](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L213)

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

Defined in: [packages/db/src/indexes/base-index.ts:295](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L295)

#### Returns

`void`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`clearRangeValues`](BaseIndex.md#clearrangevalues)

***

### equalityLookup()

```ts
equalityLookup(value): Set<TKey>;
```

Defined in: [packages/db/src/indexes/basic-index.ts:241](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L241)

Performs an equality lookup - O(1)

#### Parameters

##### value

`any`

#### Returns

`Set`\<`TKey`\>

#### Overrides

[`BaseIndex`](BaseIndex.md).[`equalityLookup`](BaseIndex.md#equalitylookup)

***

### evaluateAddedValue()

```ts
protected evaluateAddedValue(key, item): any;
```

Defined in: [packages/db/src/indexes/base-index.ts:374](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L374)

The indexed value of a row being added. A throwing expression fails the write.

#### Parameters

##### key

`TKey`

##### item

`any`

#### Returns

`any`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`evaluateAddedValue`](BaseIndex.md#evaluateaddedvalue)

***

### evaluateIndexExpression()

```ts
protected evaluateIndexExpression(item): any;
```

Defined in: [packages/db/src/indexes/base-index.ts:367](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L367)

#### Parameters

##### item

`any`

#### Returns

`any`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`evaluateIndexExpression`](BaseIndex.md#evaluateindexexpression)

***

### exactBucketKeys()

```ts
protected exactBucketKeys(value): Iterable<TKey, any, any> | undefined;
```

Defined in: [packages/db/src/indexes/base-index.ts:205](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L205)

#### Parameters

##### value

`any`

#### Returns

`Iterable`\<`TKey`, `any`, `any`\> \| `undefined`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`exactBucketKeys`](BaseIndex.md#exactbucketkeys)

***

### inArrayLookup()

```ts
inArrayLookup(values): Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:228](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L228)

Combine exact buckets without copying each bucket first.

#### Parameters

##### values

`any`[]

#### Returns

`Set`\<`TKey`\>

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`inArrayLookup`](BaseIndex.md#inarraylookup)

***

### initialize()

```ts
protected initialize(_options?): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:365](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L365)

#### Parameters

##### \_options?

`any`

#### Returns

`void`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`initialize`](BaseIndex.md#initialize)

***

### lookup()

```ts
lookup(operation, value): Set<TKey>;
```

Defined in: [packages/db/src/indexes/basic-index.ts:221](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L221)

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

### lookupSupportedOperation()

```ts
protected lookupSupportedOperation(operation, value): Set<TKey> | undefined;
```

Defined in: [packages/db/src/indexes/base-index.ts:211](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L211)

#### Parameters

##### operation

`"eq"` | `"gt"` | `"gte"` | `"lt"` | `"lte"` | `"in"` | `"like"` | `"ilike"`

##### value

`any`

#### Returns

`Set`\<`TKey`\> \| `undefined`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`lookupSupportedOperation`](BaseIndex.md#lookupsupportedoperation)

***

### matchesCompareOptions()

```ts
matchesCompareOptions(compareOptions): boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:321](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L321)

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

Defined in: [packages/db/src/indexes/base-index.ts:361](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L361)

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

Defined in: [packages/db/src/indexes/base-index.ts:309](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L309)

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

Defined in: [packages/db/src/indexes/basic-index.ts:249](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L249)

Performs a range query using binary search - O(log n + m)

#### Parameters

##### options

[`RangeQueryOptions`](../interfaces/RangeQueryOptions.md) = `{}`

#### Returns

`Set`\<`TKey`\>

#### Overrides

[`BaseIndex`](BaseIndex.md).[`rangeQuery`](BaseIndex.md#rangequery)

***

### rangeQueryReversed()

```ts
rangeQueryReversed(options): Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:237](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L237)

#### Parameters

##### options

[`RangeQueryOptions`](../interfaces/RangeQueryOptions.md) = `{}`

#### Returns

`Set`\<`TKey`\>

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`rangeQueryReversed`](BaseIndex.md#rangequeryreversed)

***

### remove()

```ts
remove(key, item): void;
```

Defined in: [packages/db/src/indexes/basic-index.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L88)

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

Defined in: [packages/db/src/indexes/base-index.ts:286](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L286)

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

Defined in: [packages/db/src/indexes/base-index.ts:251](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L251)

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

Defined in: [packages/db/src/indexes/basic-index.ts:313](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L313)

Returns the next n items in sorted order

#### Parameters

##### n

`number`

##### from

`any`

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

#### Overrides

[`BaseIndex`](BaseIndex.md).[`take`](BaseIndex.md#take)

***

### takeFromStart()

```ts
takeFromStart(n, filterFn?): TKey[];
```

Defined in: [packages/db/src/indexes/basic-index.ts:360](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L360)

Returns the first n items in sorted order (from the start)

#### Parameters

##### n

`number`

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

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

Defined in: [packages/db/src/indexes/basic-index.ts:334](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L334)

Returns the next n items in reverse sorted order

#### Parameters

##### n

`number`

##### from

`any`

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

#### Overrides

[`BaseIndex`](BaseIndex.md).[`takeReversed`](BaseIndex.md#takereversed)

***

### takeReversedFromEnd()

```ts
takeReversedFromEnd(n, filterFn?): TKey[];
```

Defined in: [packages/db/src/indexes/basic-index.ts:367](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L367)

Returns the first n items in reverse sorted order (from the end)

#### Parameters

##### n

`number`

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

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

Defined in: [packages/db/src/indexes/basic-index.ts:148](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L148)

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

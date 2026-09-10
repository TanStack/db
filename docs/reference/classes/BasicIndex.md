---
id: BasicIndex
title: BasicIndex
---

# Class: BasicIndex\<TKey\>

Defined in: [packages/db/src/indexes/basic-index.ts:45](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L45)

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

Defined in: [packages/db/src/indexes/basic-index.ts:66](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L66)

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

#### Overrides

[`BaseIndex`](BaseIndex.md).[`constructor`](BaseIndex.md#constructor)

## Properties

### compareOptions

```ts
protected compareOptions: CompareOptions;
```

Defined in: [packages/db/src/indexes/base-index.ts:122](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L122)

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`compareOptions`](BaseIndex.md#compareoptions)

***

### expression

```ts
readonly expression: BasicExpression;
```

Defined in: [packages/db/src/indexes/base-index.ts:120](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L120)

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`expression`](BaseIndex.md#expression)

***

### hasCustomComparator

```ts
protected hasCustomComparator: boolean = false;
```

Defined in: [packages/db/src/indexes/base-index.ts:128](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L128)

Set by subclasses when constructed with a user-supplied comparator, whose
ordering may not match the WHERE evaluator's relational operators.

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`hasCustomComparator`](BaseIndex.md#hascustomcomparator)

***

### id

```ts
readonly id: number;
```

Defined in: [packages/db/src/indexes/base-index.ts:118](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L118)

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`id`](BaseIndex.md#id)

***

### name?

```ts
readonly optional name: string;
```

Defined in: [packages/db/src/indexes/base-index.ts:119](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L119)

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`name`](BaseIndex.md#name)

***

### supportedOperations

```ts
readonly supportedOperations: Set<"eq" | "gt" | "gte" | "lt" | "lte" | "in" | "like" | "ilike">;
```

Defined in: [packages/db/src/indexes/basic-index.ts:48](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L48)

#### Overrides

[`BaseIndex`](BaseIndex.md).[`supportedOperations`](BaseIndex.md#supportedoperations)

## Accessors

### keyCount

#### Get Signature

```ts
get keyCount(): number;
```

Defined in: [packages/db/src/indexes/basic-index.ts:294](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L294)

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

Defined in: [packages/db/src/indexes/base-index.ts:193](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L193)

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

Defined in: [packages/db/src/indexes/basic-index.ts:85](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L85)

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

Defined in: [packages/db/src/indexes/base-index.ts:197](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L197)

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

Defined in: [packages/db/src/indexes/basic-index.ts:217](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L217)

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

Defined in: [packages/db/src/indexes/base-index.ts:219](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L219)

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

Defined in: [packages/db/src/indexes/basic-index.ts:253](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L253)

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

Defined in: [packages/db/src/indexes/base-index.ts:215](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L215)

#### Returns

`void`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`clearRangeValues`](BaseIndex.md#clearrangevalues)

***

### equalityLookup()

```ts
equalityLookup(value): Set<TKey>;
```

Defined in: [packages/db/src/indexes/basic-index.ts:301](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L301)

Performs an equality lookup - O(1)

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

Defined in: [packages/db/src/indexes/base-index.ts:276](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L276)

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

Defined in: [packages/db/src/indexes/basic-index.ts:471](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L471)

Performs an IN array lookup - O(k) where k is values.length

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

Defined in: [packages/db/src/indexes/basic-index.ts:80](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L80)

#### Parameters

##### \_options?

[`BasicIndexOptions`](../interfaces/BasicIndexOptions.md)

#### Returns

`void`

#### Overrides

[`BaseIndex`](BaseIndex.md).[`initialize`](BaseIndex.md#initialize)

***

### lookup()

```ts
lookup(operation, value): Set<TKey>;
```

Defined in: [packages/db/src/indexes/basic-index.ts:263](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L263)

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

Defined in: [packages/db/src/indexes/base-index.ts:241](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L241)

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

Defined in: [packages/db/src/indexes/base-index.ts:270](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L270)

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

Defined in: [packages/db/src/indexes/base-index.ts:229](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L229)

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

Defined in: [packages/db/src/indexes/basic-index.ts:309](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L309)

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

Defined in: [packages/db/src/indexes/base-index.ts:175](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L175)

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

Defined in: [packages/db/src/indexes/basic-index.ts:126](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L126)

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

Defined in: [packages/db/src/indexes/base-index.ts:206](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L206)

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

Defined in: [packages/db/src/indexes/base-index.ts:189](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L189)

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

Defined in: [packages/db/src/indexes/basic-index.ts:373](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L373)

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

Defined in: [packages/db/src/indexes/basic-index.ts:420](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L420)

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

Defined in: [packages/db/src/indexes/basic-index.ts:394](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L394)

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

Defined in: [packages/db/src/indexes/basic-index.ts:427](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L427)

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

Defined in: [packages/db/src/indexes/basic-index.ts:183](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/basic-index.ts#L183)

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

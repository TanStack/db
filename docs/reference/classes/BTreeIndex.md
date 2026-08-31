---
id: BTreeIndex
title: BTreeIndex
---

# Class: BTreeIndex\<TKey\>

Defined in: [packages/db/src/indexes/btree-index.ts:36](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L36)

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

Defined in: [packages/db/src/indexes/btree-index.ts:56](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L56)

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

#### Overrides

[`BaseIndex`](BaseIndex.md).[`constructor`](BaseIndex.md#constructor)

## Properties

### compareOptions

```ts
protected compareOptions: CompareOptions;
```

Defined in: [packages/db/src/indexes/base-index.ts:124](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L124)

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`compareOptions`](BaseIndex.md#compareoptions)

***

### expression

```ts
readonly expression: BasicExpression;
```

Defined in: [packages/db/src/indexes/base-index.ts:118](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L118)

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`expression`](BaseIndex.md#expression)

***

### hasCustomComparator

```ts
protected hasCustomComparator: boolean = false;
```

Defined in: [packages/db/src/indexes/base-index.ts:130](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L130)

Set by subclasses when constructed with a user-supplied comparator, whose
ordering may not match the WHERE evaluator's relational operators.

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`hasCustomComparator`](BaseIndex.md#hascustomcomparator)

***

### id

```ts
readonly id: number;
```

Defined in: [packages/db/src/indexes/base-index.ts:116](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L116)

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`id`](BaseIndex.md#id)

***

### lastUpdated

```ts
protected lastUpdated: Date;
```

Defined in: [packages/db/src/indexes/base-index.ts:123](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L123)

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`lastUpdated`](BaseIndex.md#lastupdated)

***

### lookupCount

```ts
protected lookupCount: number = 0;
```

Defined in: [packages/db/src/indexes/base-index.ts:121](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L121)

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`lookupCount`](BaseIndex.md#lookupcount)

***

### name?

```ts
readonly optional name: string;
```

Defined in: [packages/db/src/indexes/base-index.ts:117](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L117)

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`name`](BaseIndex.md#name)

***

### supportedOperations

```ts
readonly supportedOperations: Set<"eq" | "gt" | "gte" | "lt" | "lte" | "in" | "like" | "ilike">;
```

Defined in: [packages/db/src/indexes/btree-index.ts:39](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L39)

#### Overrides

[`BaseIndex`](BaseIndex.md).[`supportedOperations`](BaseIndex.md#supportedoperations)

***

### totalLookupTime

```ts
protected totalLookupTime: number = 0;
```

Defined in: [packages/db/src/indexes/base-index.ts:122](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L122)

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`totalLookupTime`](BaseIndex.md#totallookuptime)

## Accessors

### indexedKeysSet

#### Get Signature

```ts
get indexedKeysSet(): Set<TKey>;
```

Defined in: [packages/db/src/indexes/btree-index.ts:439](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L439)

##### Returns

`Set`\<`TKey`\>

#### Overrides

[`BaseIndex`](BaseIndex.md).[`indexedKeysSet`](BaseIndex.md#indexedkeysset)

***

### keyCount

#### Get Signature

```ts
get keyCount(): number;
```

Defined in: [packages/db/src/indexes/btree-index.ts:243](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L243)

Gets the number of indexed keys

##### Returns

`number`

#### Overrides

[`BaseIndex`](BaseIndex.md).[`keyCount`](BaseIndex.md#keycount)

***

### orderedEntriesArray

#### Get Signature

```ts
get orderedEntriesArray(): [any, Set<TKey>][];
```

Defined in: [packages/db/src/indexes/btree-index.ts:443](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L443)

##### Returns

\[`any`, `Set`\<`TKey`\>\][]

#### Overrides

[`BaseIndex`](BaseIndex.md).[`orderedEntriesArray`](BaseIndex.md#orderedentriesarray)

***

### orderedEntriesArrayReversed

#### Get Signature

```ts
get orderedEntriesArrayReversed(): [any, Set<TKey>][];
```

Defined in: [packages/db/src/indexes/btree-index.ts:452](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L452)

##### Returns

\[`any`, `Set`\<`TKey`\>\][]

#### Overrides

[`BaseIndex`](BaseIndex.md).[`orderedEntriesArrayReversed`](BaseIndex.md#orderedentriesarrayreversed)

***

### supportsRangeOptimization

#### Get Signature

```ts
get supportsRangeOptimization(): boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:185](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L185)

Whether range lookups (gt/gte/lt/lte) on this index can be trusted to
return every matching key. Range traversal relies on the index ordering, so
it is unsafe when the index uses a custom comparator, whose order may not
match the WHERE evaluator's relational operators. Callers must fall back to
a full scan when this is `false`.

##### Returns

`boolean`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`supportsRangeOptimization`](BaseIndex.md#supportsrangeoptimization)

***

### valueMapData

#### Get Signature

```ts
get valueMapData(): Map<any, Set<TKey>>;
```

Defined in: [packages/db/src/indexes/btree-index.ts:459](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L459)

##### Returns

`Map`\<`any`, `Set`\<`TKey`\>\>

#### Overrides

[`BaseIndex`](BaseIndex.md).[`valueMapData`](BaseIndex.md#valuemapdata)

## Methods

### add()

```ts
add(key, item): void;
```

Defined in: [packages/db/src/indexes/btree-index.ts:85](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L85)

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

### build()

```ts
build(entries): void;
```

Defined in: [packages/db/src/indexes/btree-index.ts:187](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L187)

Builds the index from a collection of entries

#### Parameters

##### entries

`Iterable`\<\[`TKey`, `any`\]\>

#### Returns

`void`

#### Overrides

[`BaseIndex`](BaseIndex.md).[`build`](BaseIndex.md#build)

***

### clear()

```ts
clear(): void;
```

Defined in: [packages/db/src/indexes/btree-index.ts:198](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L198)

Clears all data from the index

#### Returns

`void`

#### Overrides

[`BaseIndex`](BaseIndex.md).[`clear`](BaseIndex.md#clear)

***

### equalityLookup()

```ts
equalityLookup(value): Set<TKey>;
```

Defined in: [packages/db/src/indexes/btree-index.ts:252](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L252)

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

Defined in: [packages/db/src/indexes/base-index.ts:246](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L246)

#### Parameters

##### item

`any`

#### Returns

`any`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`evaluateIndexExpression`](BaseIndex.md#evaluateindexexpression)

***

### getStats()

```ts
getStats(): IndexStats;
```

Defined in: [packages/db/src/indexes/base-index.ts:234](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L234)

#### Returns

[`IndexStats`](../interfaces/IndexStats.md)

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`getStats`](BaseIndex.md#getstats)

***

### inArrayLookup()

```ts
inArrayLookup(values): Set<TKey>;
```

Defined in: [packages/db/src/indexes/btree-index.ts:424](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L424)

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

Defined in: [packages/db/src/indexes/btree-index.ts:80](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L80)

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

Defined in: [packages/db/src/indexes/btree-index.ts:208](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L208)

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

Defined in: [packages/db/src/indexes/base-index.ts:201](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L201)

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

Defined in: [packages/db/src/indexes/base-index.ts:230](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L230)

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

Defined in: [packages/db/src/indexes/base-index.ts:189](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L189)

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

Defined in: [packages/db/src/indexes/btree-index.ts:261](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L261)

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

Defined in: [packages/db/src/indexes/btree-index.ts:308](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L308)

Performs a reversed range query

#### Parameters

##### options

[`BTreeRangeQueryOptions`](../interfaces/BTreeRangeQueryOptions.md) = `{}`

#### Returns

`Set`\<`TKey`\>

#### Overrides

[`BaseIndex`](BaseIndex.md).[`rangeQueryReversed`](BaseIndex.md#rangequeryreversed)

***

### remove()

```ts
remove(key, item): void;
```

Defined in: [packages/db/src/indexes/btree-index.ts:120](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L120)

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

### supports()

```ts
supports(operation): boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:181](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L181)

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

Defined in: [packages/db/src/indexes/btree-index.ts:370](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L370)

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

Defined in: [packages/db/src/indexes/btree-index.ts:383](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L383)

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

Defined in: [packages/db/src/indexes/btree-index.ts:395](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L395)

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

Defined in: [packages/db/src/indexes/btree-index.ts:412](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L412)

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

### trackLookup()

```ts
protected trackLookup(startTime): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:252](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L252)

#### Parameters

##### startTime

`number`

#### Returns

`void`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`trackLookup`](BaseIndex.md#tracklookup)

***

### update()

```ts
update(
   key, 
   oldItem, 
   newItem): void;
```

Defined in: [packages/db/src/indexes/btree-index.ts:159](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/btree-index.ts#L159)

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

***

### updateTimestamp()

```ts
protected updateTimestamp(): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:258](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L258)

#### Returns

`void`

#### Inherited from

[`BaseIndex`](BaseIndex.md).[`updateTimestamp`](BaseIndex.md#updatetimestamp)

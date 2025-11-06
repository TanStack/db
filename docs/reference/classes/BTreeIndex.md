---
id: BTreeIndex
title: BTreeIndex
---

# Class: BTreeIndex\<TKey\>

Defined in: packages/db/src/indexes/btree-index.ts:30

B+Tree index for sorted data with range queries
This maintains items in sorted order and provides efficient range operations

## Extends

- [`BaseIndex`](../BaseIndex.md)\<`TKey`\>

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

Defined in: packages/db/src/indexes/btree-index.ts:50

#### Parameters

##### id

`number`

##### expression

[`BasicExpression`](../../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)

##### name?

`string`

##### options?

`any`

#### Returns

`BTreeIndex`\<`TKey`\>

#### Overrides

[`BaseIndex`](../BaseIndex.md).[`constructor`](../BaseIndex.md#constructor)

## Properties

### compareOptions

```ts
protected compareOptions: CompareOptions;
```

Defined in: packages/db/src/indexes/base-index.ts:87

#### Inherited from

[`BaseIndex`](../BaseIndex.md).[`compareOptions`](../BaseIndex.md#compareoptions)

***

### expression

```ts
readonly expression: BasicExpression;
```

Defined in: packages/db/src/indexes/base-index.ts:81

#### Inherited from

[`BaseIndex`](../BaseIndex.md).[`expression`](../BaseIndex.md#expression)

***

### id

```ts
readonly id: number;
```

Defined in: packages/db/src/indexes/base-index.ts:79

#### Inherited from

[`BaseIndex`](../BaseIndex.md).[`id`](../BaseIndex.md#id)

***

### lastUpdated

```ts
protected lastUpdated: Date;
```

Defined in: packages/db/src/indexes/base-index.ts:86

#### Inherited from

[`BaseIndex`](../BaseIndex.md).[`lastUpdated`](../BaseIndex.md#lastupdated)

***

### lookupCount

```ts
protected lookupCount: number = 0;
```

Defined in: packages/db/src/indexes/base-index.ts:84

#### Inherited from

[`BaseIndex`](../BaseIndex.md).[`lookupCount`](../BaseIndex.md#lookupcount)

***

### name?

```ts
readonly optional name: string;
```

Defined in: packages/db/src/indexes/base-index.ts:80

#### Inherited from

[`BaseIndex`](../BaseIndex.md).[`name`](../BaseIndex.md#name)

***

### supportedOperations

```ts
readonly supportedOperations: Set<"eq" | "gt" | "gte" | "lt" | "lte" | "in" | "like" | "ilike">;
```

Defined in: packages/db/src/indexes/btree-index.ts:33

#### Overrides

[`BaseIndex`](../BaseIndex.md).[`supportedOperations`](../BaseIndex.md#supportedoperations)

***

### totalLookupTime

```ts
protected totalLookupTime: number = 0;
```

Defined in: packages/db/src/indexes/base-index.ts:85

#### Inherited from

[`BaseIndex`](../BaseIndex.md).[`totalLookupTime`](../BaseIndex.md#totallookuptime)

## Accessors

### indexedKeysSet

#### Get Signature

```ts
get indexedKeysSet(): Set<TKey>;
```

Defined in: packages/db/src/indexes/btree-index.ts:333

##### Returns

`Set`\<`TKey`\>

#### Overrides

[`BaseIndex`](../BaseIndex.md).[`indexedKeysSet`](../BaseIndex.md#indexedkeysset)

***

### keyCount

#### Get Signature

```ts
get keyCount(): number;
```

Defined in: packages/db/src/indexes/btree-index.ts:199

Gets the number of indexed keys

##### Returns

`number`

#### Overrides

[`BaseIndex`](../BaseIndex.md).[`keyCount`](../BaseIndex.md#keycount)

***

### orderedEntriesArray

#### Get Signature

```ts
get orderedEntriesArray(): [any, Set<TKey>][];
```

Defined in: packages/db/src/indexes/btree-index.ts:337

##### Returns

\[`any`, `Set`\<`TKey`\>\][]

#### Overrides

[`BaseIndex`](../BaseIndex.md).[`orderedEntriesArray`](../BaseIndex.md#orderedentriesarray)

***

### orderedEntriesArrayReversed

#### Get Signature

```ts
get orderedEntriesArrayReversed(): [any, Set<TKey>][];
```

Defined in: packages/db/src/indexes/btree-index.ts:343

##### Returns

\[`any`, `Set`\<`TKey`\>\][]

#### Overrides

[`BaseIndex`](../BaseIndex.md).[`orderedEntriesArrayReversed`](../BaseIndex.md#orderedentriesarrayreversed)

***

### valueMapData

#### Get Signature

```ts
get valueMapData(): Map<any, Set<TKey>>;
```

Defined in: packages/db/src/indexes/btree-index.ts:350

##### Returns

`Map`\<`any`, `Set`\<`TKey`\>\>

#### Overrides

[`BaseIndex`](../BaseIndex.md).[`valueMapData`](../BaseIndex.md#valuemapdata)

## Methods

### add()

```ts
add(key, item): void;
```

Defined in: packages/db/src/indexes/btree-index.ts:69

Adds a value to the index

#### Parameters

##### key

`TKey`

##### item

`any`

#### Returns

`void`

#### Overrides

[`BaseIndex`](../BaseIndex.md).[`add`](../BaseIndex.md#add)

***

### build()

```ts
build(entries): void;
```

Defined in: packages/db/src/indexes/btree-index.ts:143

Builds the index from a collection of entries

#### Parameters

##### entries

`Iterable`\<\[`TKey`, `any`\]\>

#### Returns

`void`

#### Overrides

[`BaseIndex`](../BaseIndex.md).[`build`](../BaseIndex.md#build)

***

### clear()

```ts
clear(): void;
```

Defined in: packages/db/src/indexes/btree-index.ts:154

Clears all data from the index

#### Returns

`void`

#### Overrides

[`BaseIndex`](../BaseIndex.md).[`clear`](../BaseIndex.md#clear)

***

### equalityLookup()

```ts
equalityLookup(value): Set<TKey>;
```

Defined in: packages/db/src/indexes/btree-index.ts:208

Performs an equality lookup

#### Parameters

##### value

`any`

#### Returns

`Set`\<`TKey`\>

#### Overrides

[`BaseIndex`](../BaseIndex.md).[`equalityLookup`](../BaseIndex.md#equalitylookup)

***

### evaluateIndexExpression()

```ts
protected evaluateIndexExpression(item): any;
```

Defined in: packages/db/src/indexes/base-index.ts:182

#### Parameters

##### item

`any`

#### Returns

`any`

#### Inherited from

[`BaseIndex`](../BaseIndex.md).[`evaluateIndexExpression`](../BaseIndex.md#evaluateindexexpression)

***

### getStats()

```ts
getStats(): IndexStats;
```

Defined in: packages/db/src/indexes/base-index.ts:169

#### Returns

[`IndexStats`](../../interfaces/IndexStats.md)

#### Inherited from

[`BaseIndex`](../BaseIndex.md).[`getStats`](../BaseIndex.md#getstats)

***

### inArrayLookup()

```ts
inArrayLookup(values): Set<TKey>;
```

Defined in: packages/db/src/indexes/btree-index.ts:318

Performs an IN array lookup

#### Parameters

##### values

`any`[]

#### Returns

`Set`\<`TKey`\>

#### Overrides

[`BaseIndex`](../BaseIndex.md).[`inArrayLookup`](../BaseIndex.md#inarraylookup)

***

### initialize()

```ts
protected initialize(_options?): void;
```

Defined in: packages/db/src/indexes/btree-index.ts:64

#### Parameters

##### \_options?

[`BTreeIndexOptions`](../../interfaces/BTreeIndexOptions.md)

#### Returns

`void`

#### Overrides

[`BaseIndex`](../BaseIndex.md).[`initialize`](../BaseIndex.md#initialize)

***

### lookup()

```ts
lookup(operation, value): Set<TKey>;
```

Defined in: packages/db/src/indexes/btree-index.ts:164

Performs a lookup operation

#### Parameters

##### operation

`"eq"` | `"gt"` | `"gte"` | `"lt"` | `"lte"` | `"in"` | `"like"` | `"ilike"`

##### value

`any`

#### Returns

`Set`\<`TKey`\>

#### Overrides

[`BaseIndex`](../BaseIndex.md).[`lookup`](../BaseIndex.md#lookup)

***

### matchesCompareOptions()

```ts
matchesCompareOptions(compareOptions): boolean;
```

Defined in: packages/db/src/indexes/base-index.ts:146

Checks if the compare options match the index's compare options.
The direction is ignored because the index can be reversed if the direction is different.

#### Parameters

##### compareOptions

`CompareOptions`

#### Returns

`boolean`

#### Inherited from

[`BaseIndex`](../BaseIndex.md).[`matchesCompareOptions`](../BaseIndex.md#matchescompareoptions)

***

### matchesDirection()

```ts
matchesDirection(direction): boolean;
```

Defined in: packages/db/src/indexes/base-index.ts:165

Checks if the index matches the provided direction.

#### Parameters

##### direction

[`OrderByDirection`](../../@tanstack/namespaces/IR/type-aliases/OrderByDirection.md)

#### Returns

`boolean`

#### Inherited from

[`BaseIndex`](../BaseIndex.md).[`matchesDirection`](../BaseIndex.md#matchesdirection)

***

### matchesField()

```ts
matchesField(fieldPath): boolean;
```

Defined in: packages/db/src/indexes/base-index.ts:134

#### Parameters

##### fieldPath

`string`[]

#### Returns

`boolean`

#### Inherited from

[`BaseIndex`](../BaseIndex.md).[`matchesField`](../BaseIndex.md#matchesfield)

***

### rangeQuery()

```ts
rangeQuery(options): Set<TKey>;
```

Defined in: packages/db/src/indexes/btree-index.ts:217

Performs a range query with options
This is more efficient for compound queries like "WHERE a > 5 AND a < 10"

#### Parameters

##### options

[`RangeQueryOptions`](../../interfaces/RangeQueryOptions.md) = `{}`

#### Returns

`Set`\<`TKey`\>

#### Overrides

[`BaseIndex`](../BaseIndex.md).[`rangeQuery`](../BaseIndex.md#rangequery)

***

### rangeQueryReversed()

```ts
rangeQueryReversed(options): Set<TKey>;
```

Defined in: packages/db/src/indexes/btree-index.ts:250

Performs a reversed range query

#### Parameters

##### options

[`RangeQueryOptions`](../../interfaces/RangeQueryOptions.md) = `{}`

#### Returns

`Set`\<`TKey`\>

#### Overrides

[`BaseIndex`](../BaseIndex.md).[`rangeQueryReversed`](../BaseIndex.md#rangequeryreversed)

***

### remove()

```ts
remove(key, item): void;
```

Defined in: packages/db/src/indexes/btree-index.ts:100

Removes a value from the index

#### Parameters

##### key

`TKey`

##### item

`any`

#### Returns

`void`

#### Overrides

[`BaseIndex`](../BaseIndex.md).[`remove`](../BaseIndex.md#remove)

***

### supports()

```ts
supports(operation): boolean;
```

Defined in: packages/db/src/indexes/base-index.ts:130

#### Parameters

##### operation

`"eq"` | `"gt"` | `"gte"` | `"lt"` | `"lte"` | `"in"` | `"like"` | `"ilike"`

#### Returns

`boolean`

#### Inherited from

[`BaseIndex`](../BaseIndex.md).[`supports`](../BaseIndex.md#supports)

***

### take()

```ts
take(
   n, 
   from?, 
   filterFn?): TKey[];
```

Defined in: packages/db/src/indexes/btree-index.ts:295

Returns the next n items after the provided item or the first n items if no from item is provided.

#### Parameters

##### n

`number`

The number of items to return

##### from?

`any`

The item to start from (exclusive). Starts from the smallest item (inclusive) if not provided.

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

The next n items after the provided key. Returns the first n items if no from item is provided.

#### Overrides

[`BaseIndex`](../BaseIndex.md).[`take`](../BaseIndex.md#take)

***

### takeReversed()

```ts
takeReversed(
   n, 
   from?, 
   filterFn?): TKey[];
```

Defined in: packages/db/src/indexes/btree-index.ts:306

Returns the next n items **before** the provided item (in descending order) or the last n items if no from item is provided.

#### Parameters

##### n

`number`

The number of items to return

##### from?

`any`

The item to start from (exclusive). Starts from the largest item (inclusive) if not provided.

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

The next n items **before** the provided key. Returns the last n items if no from item is provided.

#### Overrides

[`BaseIndex`](../BaseIndex.md).[`takeReversed`](../BaseIndex.md#takereversed)

***

### trackLookup()

```ts
protected trackLookup(startTime): void;
```

Defined in: packages/db/src/indexes/base-index.ts:187

#### Parameters

##### startTime

`number`

#### Returns

`void`

#### Inherited from

[`BaseIndex`](../BaseIndex.md).[`trackLookup`](../BaseIndex.md#tracklookup)

***

### update()

```ts
update(
   key, 
   oldItem, 
   newItem): void;
```

Defined in: packages/db/src/indexes/btree-index.ts:135

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

[`BaseIndex`](../BaseIndex.md).[`update`](../BaseIndex.md#update)

***

### updateTimestamp()

```ts
protected updateTimestamp(): void;
```

Defined in: packages/db/src/indexes/base-index.ts:193

#### Returns

`void`

#### Inherited from

[`BaseIndex`](../BaseIndex.md).[`updateTimestamp`](../BaseIndex.md#updatetimestamp)

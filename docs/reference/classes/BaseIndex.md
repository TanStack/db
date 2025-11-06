---
id: BaseIndex
title: BaseIndex
---

# Abstract Class: BaseIndex\<TKey\>

Defined in: packages/db/src/indexes/base-index.ts:76

Base abstract class that all index types extend

## Extended by

- [`BTreeIndex`](../BTreeIndex.md)

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Implements

- [`IndexInterface`](../../interfaces/IndexInterface.md)\<`TKey`\>

## Constructors

### Constructor

```ts
new BaseIndex<TKey>(
   id, 
   expression, 
   name?, 
options?): BaseIndex<TKey>;
```

Defined in: packages/db/src/indexes/base-index.ts:89

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

`BaseIndex`\<`TKey`\>

## Properties

### compareOptions

```ts
protected compareOptions: CompareOptions;
```

Defined in: packages/db/src/indexes/base-index.ts:87

***

### expression

```ts
readonly expression: BasicExpression;
```

Defined in: packages/db/src/indexes/base-index.ts:81

***

### id

```ts
readonly id: number;
```

Defined in: packages/db/src/indexes/base-index.ts:79

***

### lastUpdated

```ts
protected lastUpdated: Date;
```

Defined in: packages/db/src/indexes/base-index.ts:86

***

### lookupCount

```ts
protected lookupCount: number = 0;
```

Defined in: packages/db/src/indexes/base-index.ts:84

***

### name?

```ts
readonly optional name: string;
```

Defined in: packages/db/src/indexes/base-index.ts:80

***

### supportedOperations

```ts
abstract readonly supportedOperations: Set<"eq" | "gt" | "gte" | "lt" | "lte" | "in" | "like" | "ilike">;
```

Defined in: packages/db/src/indexes/base-index.ts:82

***

### totalLookupTime

```ts
protected totalLookupTime: number = 0;
```

Defined in: packages/db/src/indexes/base-index.ts:85

## Accessors

### indexedKeysSet

#### Get Signature

```ts
get abstract indexedKeysSet(): Set<TKey>;
```

Defined in: packages/db/src/indexes/base-index.ts:126

##### Returns

`Set`\<`TKey`\>

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`indexedKeysSet`](../../interfaces/IndexInterface.md#indexedkeysset)

***

### keyCount

#### Get Signature

```ts
get abstract keyCount(): number;
```

Defined in: packages/db/src/indexes/base-index.ts:119

##### Returns

`number`

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`keyCount`](../../interfaces/IndexInterface.md#keycount)

***

### orderedEntriesArray

#### Get Signature

```ts
get abstract orderedEntriesArray(): [any, Set<TKey>][];
```

Defined in: packages/db/src/indexes/base-index.ts:124

##### Returns

\[`any`, `Set`\<`TKey`\>\][]

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`orderedEntriesArray`](../../interfaces/IndexInterface.md#orderedentriesarray)

***

### orderedEntriesArrayReversed

#### Get Signature

```ts
get abstract orderedEntriesArrayReversed(): [any, Set<TKey>][];
```

Defined in: packages/db/src/indexes/base-index.ts:125

##### Returns

\[`any`, `Set`\<`TKey`\>\][]

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`orderedEntriesArrayReversed`](../../interfaces/IndexInterface.md#orderedentriesarrayreversed)

***

### valueMapData

#### Get Signature

```ts
get abstract valueMapData(): Map<any, Set<TKey>>;
```

Defined in: packages/db/src/indexes/base-index.ts:127

##### Returns

`Map`\<`any`, `Set`\<`TKey`\>\>

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`valueMapData`](../../interfaces/IndexInterface.md#valuemapdata)

## Methods

### add()

```ts
abstract add(key, item): void;
```

Defined in: packages/db/src/indexes/base-index.ts:103

#### Parameters

##### key

`TKey`

##### item

`any`

#### Returns

`void`

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`add`](../../interfaces/IndexInterface.md#add)

***

### build()

```ts
abstract build(entries): void;
```

Defined in: packages/db/src/indexes/base-index.ts:106

#### Parameters

##### entries

`Iterable`\<\[`TKey`, `any`\]\>

#### Returns

`void`

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`build`](../../interfaces/IndexInterface.md#build)

***

### clear()

```ts
abstract clear(): void;
```

Defined in: packages/db/src/indexes/base-index.ts:107

#### Returns

`void`

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`clear`](../../interfaces/IndexInterface.md#clear)

***

### equalityLookup()

```ts
abstract equalityLookup(value): Set<TKey>;
```

Defined in: packages/db/src/indexes/base-index.ts:120

#### Parameters

##### value

`any`

#### Returns

`Set`\<`TKey`\>

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`equalityLookup`](../../interfaces/IndexInterface.md#equalitylookup)

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

***

### getStats()

```ts
getStats(): IndexStats;
```

Defined in: packages/db/src/indexes/base-index.ts:169

#### Returns

[`IndexStats`](../../interfaces/IndexStats.md)

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`getStats`](../../interfaces/IndexInterface.md#getstats)

***

### inArrayLookup()

```ts
abstract inArrayLookup(values): Set<TKey>;
```

Defined in: packages/db/src/indexes/base-index.ts:121

#### Parameters

##### values

`any`[]

#### Returns

`Set`\<`TKey`\>

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`inArrayLookup`](../../interfaces/IndexInterface.md#inarraylookup)

***

### initialize()

```ts
abstract protected initialize(options?): void;
```

Defined in: packages/db/src/indexes/base-index.ts:180

#### Parameters

##### options?

`any`

#### Returns

`void`

***

### lookup()

```ts
abstract lookup(operation, value): Set<TKey>;
```

Defined in: packages/db/src/indexes/base-index.ts:108

#### Parameters

##### operation

`"eq"` | `"gt"` | `"gte"` | `"lt"` | `"lte"` | `"in"` | `"like"` | `"ilike"`

##### value

`any`

#### Returns

`Set`\<`TKey`\>

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`lookup`](../../interfaces/IndexInterface.md#lookup)

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

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`matchesCompareOptions`](../../interfaces/IndexInterface.md#matchescompareoptions)

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

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`matchesDirection`](../../interfaces/IndexInterface.md#matchesdirection)

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

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`matchesField`](../../interfaces/IndexInterface.md#matchesfield)

***

### rangeQuery()

```ts
abstract rangeQuery(options): Set<TKey>;
```

Defined in: packages/db/src/indexes/base-index.ts:122

#### Parameters

##### options

[`RangeQueryOptions`](../../interfaces/RangeQueryOptions.md)

#### Returns

`Set`\<`TKey`\>

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`rangeQuery`](../../interfaces/IndexInterface.md#rangequery)

***

### rangeQueryReversed()

```ts
abstract rangeQueryReversed(options): Set<TKey>;
```

Defined in: packages/db/src/indexes/base-index.ts:123

#### Parameters

##### options

[`RangeQueryOptions`](../../interfaces/RangeQueryOptions.md)

#### Returns

`Set`\<`TKey`\>

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`rangeQueryReversed`](../../interfaces/IndexInterface.md#rangequeryreversed)

***

### remove()

```ts
abstract remove(key, item): void;
```

Defined in: packages/db/src/indexes/base-index.ts:104

#### Parameters

##### key

`TKey`

##### item

`any`

#### Returns

`void`

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`remove`](../../interfaces/IndexInterface.md#remove)

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

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`supports`](../../interfaces/IndexInterface.md#supports)

***

### take()

```ts
abstract take(
   n, 
   from?, 
   filterFn?): TKey[];
```

Defined in: packages/db/src/indexes/base-index.ts:109

#### Parameters

##### n

`number`

##### from?

`TKey`

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`take`](../../interfaces/IndexInterface.md#take)

***

### takeReversed()

```ts
abstract takeReversed(
   n, 
   from?, 
   filterFn?): TKey[];
```

Defined in: packages/db/src/indexes/base-index.ts:114

#### Parameters

##### n

`number`

##### from?

`TKey`

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`takeReversed`](../../interfaces/IndexInterface.md#takereversed)

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

***

### update()

```ts
abstract update(
   key, 
   oldItem, 
   newItem): void;
```

Defined in: packages/db/src/indexes/base-index.ts:105

#### Parameters

##### key

`TKey`

##### oldItem

`any`

##### newItem

`any`

#### Returns

`void`

#### Implementation of

[`IndexInterface`](../../interfaces/IndexInterface.md).[`update`](../../interfaces/IndexInterface.md#update)

***

### updateTimestamp()

```ts
protected updateTimestamp(): void;
```

Defined in: packages/db/src/indexes/base-index.ts:193

#### Returns

`void`

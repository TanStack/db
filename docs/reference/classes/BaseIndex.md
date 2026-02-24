---
id: BaseIndex
title: BaseIndex
---

# Abstract Class: BaseIndex\<TKey\>

Defined in: [packages/db/src/indexes/base-index.ts:81](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L81)

Base abstract class that all index types extend

## Extended by

- [`BTreeIndex`](BTreeIndex.md)

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` \| `undefined` = `string` \| `number` \| `undefined`

## Implements

- [`IndexInterface`](../interfaces/IndexInterface.md)\<`TKey`\>

## Constructors

### Constructor

```ts
new BaseIndex<TKey>(
   id, 
   expression, 
   name?, 
options?): BaseIndex<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:94](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L94)

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

`BaseIndex`\<`TKey`\>

## Properties

### compareOptions

```ts
protected compareOptions: CompareOptions;
```

Defined in: [packages/db/src/indexes/base-index.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L92)

***

### expression

```ts
readonly expression: BasicExpression;
```

Defined in: [packages/db/src/indexes/base-index.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L86)

***

### id

```ts
readonly id: number;
```

Defined in: [packages/db/src/indexes/base-index.ts:84](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L84)

***

### lastUpdated

```ts
protected lastUpdated: Date;
```

Defined in: [packages/db/src/indexes/base-index.ts:91](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L91)

***

### lookupCount

```ts
protected lookupCount: number = 0;
```

Defined in: [packages/db/src/indexes/base-index.ts:89](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L89)

***

### name?

```ts
readonly optional name: string;
```

Defined in: [packages/db/src/indexes/base-index.ts:85](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L85)

***

### supportedOperations

```ts
abstract readonly supportedOperations: Set<"eq" | "gt" | "gte" | "lt" | "lte" | "in" | "like" | "ilike">;
```

Defined in: [packages/db/src/indexes/base-index.ts:87](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L87)

***

### totalLookupTime

```ts
protected totalLookupTime: number = 0;
```

Defined in: [packages/db/src/indexes/base-index.ts:90](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L90)

## Accessors

### indexedKeysSet

#### Get Signature

```ts
get abstract indexedKeysSet(): Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:139](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L139)

##### Returns

`Set`\<`TKey`\>

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`indexedKeysSet`](../interfaces/IndexInterface.md#indexedkeysset)

***

### keyCount

#### Get Signature

```ts
get abstract keyCount(): number;
```

Defined in: [packages/db/src/indexes/base-index.ts:132](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L132)

##### Returns

`number`

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`keyCount`](../interfaces/IndexInterface.md#keycount)

***

### orderedEntriesArray

#### Get Signature

```ts
get abstract orderedEntriesArray(): [any, Set<TKey>][];
```

Defined in: [packages/db/src/indexes/base-index.ts:137](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L137)

##### Returns

\[`any`, `Set`\<`TKey`\>\][]

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`orderedEntriesArray`](../interfaces/IndexInterface.md#orderedentriesarray)

***

### orderedEntriesArrayReversed

#### Get Signature

```ts
get abstract orderedEntriesArrayReversed(): [any, Set<TKey>][];
```

Defined in: [packages/db/src/indexes/base-index.ts:138](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L138)

##### Returns

\[`any`, `Set`\<`TKey`\>\][]

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`orderedEntriesArrayReversed`](../interfaces/IndexInterface.md#orderedentriesarrayreversed)

***

### valueMapData

#### Get Signature

```ts
get abstract valueMapData(): Map<any, Set<TKey>>;
```

Defined in: [packages/db/src/indexes/base-index.ts:140](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L140)

##### Returns

`Map`\<`any`, `Set`\<`TKey`\>\>

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`valueMapData`](../interfaces/IndexInterface.md#valuemapdata)

## Methods

### add()

```ts
abstract add(key, item): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:108](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L108)

#### Parameters

##### key

`TKey`

##### item

`any`

#### Returns

`void`

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`add`](../interfaces/IndexInterface.md#add)

***

### build()

```ts
abstract build(entries): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:111](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L111)

#### Parameters

##### entries

`Iterable`\<\[`TKey`, `any`\]\>

#### Returns

`void`

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`build`](../interfaces/IndexInterface.md#build)

***

### clear()

```ts
abstract clear(): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:112](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L112)

#### Returns

`void`

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`clear`](../interfaces/IndexInterface.md#clear)

***

### equalityLookup()

```ts
abstract equalityLookup(value): Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:133](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L133)

#### Parameters

##### value

`any`

#### Returns

`Set`\<`TKey`\>

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`equalityLookup`](../interfaces/IndexInterface.md#equalitylookup)

***

### evaluateIndexExpression()

```ts
protected evaluateIndexExpression(item): any;
```

Defined in: [packages/db/src/indexes/base-index.ts:195](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L195)

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

Defined in: [packages/db/src/indexes/base-index.ts:182](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L182)

#### Returns

[`IndexStats`](../interfaces/IndexStats.md)

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`getStats`](../interfaces/IndexInterface.md#getstats)

***

### inArrayLookup()

```ts
abstract inArrayLookup(values): Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:134](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L134)

#### Parameters

##### values

`any`[]

#### Returns

`Set`\<`TKey`\>

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`inArrayLookup`](../interfaces/IndexInterface.md#inarraylookup)

***

### initialize()

```ts
abstract protected initialize(options?): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:193](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L193)

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

Defined in: [packages/db/src/indexes/base-index.ts:113](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L113)

#### Parameters

##### operation

`"eq"` | `"gt"` | `"gte"` | `"lt"` | `"lte"` | `"in"` | `"like"` | `"ilike"`

##### value

`any`

#### Returns

`Set`\<`TKey`\>

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`lookup`](../interfaces/IndexInterface.md#lookup)

***

### matchesCompareOptions()

```ts
matchesCompareOptions(compareOptions): boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:159](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L159)

Checks if the compare options match the index's compare options.
The direction is ignored because the index can be reversed if the direction is different.

#### Parameters

##### compareOptions

`CompareOptions`

#### Returns

`boolean`

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`matchesCompareOptions`](../interfaces/IndexInterface.md#matchescompareoptions)

***

### matchesDirection()

```ts
matchesDirection(direction): boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:178](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L178)

Checks if the index matches the provided direction.

#### Parameters

##### direction

[`OrderByDirection`](../@tanstack/namespaces/IR/type-aliases/OrderByDirection.md)

#### Returns

`boolean`

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`matchesDirection`](../interfaces/IndexInterface.md#matchesdirection)

***

### matchesField()

```ts
matchesField(fieldPath): boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:147](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L147)

#### Parameters

##### fieldPath

`string`[]

#### Returns

`boolean`

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`matchesField`](../interfaces/IndexInterface.md#matchesfield)

***

### rangeQuery()

```ts
abstract rangeQuery(options): Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:135](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L135)

#### Parameters

##### options

[`RangeQueryOptions`](../interfaces/RangeQueryOptions.md)

#### Returns

`Set`\<`TKey`\>

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`rangeQuery`](../interfaces/IndexInterface.md#rangequery)

***

### rangeQueryReversed()

```ts
abstract rangeQueryReversed(options): Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:136](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L136)

#### Parameters

##### options

[`RangeQueryOptions`](../interfaces/RangeQueryOptions.md)

#### Returns

`Set`\<`TKey`\>

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`rangeQueryReversed`](../interfaces/IndexInterface.md#rangequeryreversed)

***

### remove()

```ts
abstract remove(key, item): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:109](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L109)

#### Parameters

##### key

`TKey`

##### item

`any`

#### Returns

`void`

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`remove`](../interfaces/IndexInterface.md#remove)

***

### supports()

```ts
supports(operation): boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:143](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L143)

#### Parameters

##### operation

`"eq"` | `"gt"` | `"gte"` | `"lt"` | `"lte"` | `"in"` | `"like"` | `"ilike"`

#### Returns

`boolean`

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`supports`](../interfaces/IndexInterface.md#supports)

***

### take()

```ts
abstract take(
   n, 
   from, 
   filterFn?): TKey[];
```

Defined in: [packages/db/src/indexes/base-index.ts:114](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L114)

#### Parameters

##### n

`number`

##### from

`TKey`

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`take`](../interfaces/IndexInterface.md#take)

***

### takeFromStart()

```ts
abstract takeFromStart(n, filterFn?): TKey[];
```

Defined in: [packages/db/src/indexes/base-index.ts:119](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L119)

#### Parameters

##### n

`number`

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`takeFromStart`](../interfaces/IndexInterface.md#takefromstart)

***

### takeReversed()

```ts
abstract takeReversed(
   n, 
   from, 
   filterFn?): TKey[];
```

Defined in: [packages/db/src/indexes/base-index.ts:123](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L123)

#### Parameters

##### n

`number`

##### from

`TKey`

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`takeReversed`](../interfaces/IndexInterface.md#takereversed)

***

### takeReversedFromEnd()

```ts
abstract takeReversedFromEnd(n, filterFn?): TKey[];
```

Defined in: [packages/db/src/indexes/base-index.ts:128](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L128)

#### Parameters

##### n

`number`

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`takeReversedFromEnd`](../interfaces/IndexInterface.md#takereversedfromend)

***

### trackLookup()

```ts
protected trackLookup(startTime): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:200](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L200)

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

Defined in: [packages/db/src/indexes/base-index.ts:110](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L110)

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

[`IndexInterface`](../interfaces/IndexInterface.md).[`update`](../interfaces/IndexInterface.md#update)

***

### updateTimestamp()

```ts
protected updateTimestamp(): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:206](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L206)

#### Returns

`void`

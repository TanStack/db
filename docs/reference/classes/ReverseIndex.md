---
id: ReverseIndex
title: ReverseIndex
---

# Class: ReverseIndex\<TKey\>

Defined in: [packages/db/src/indexes/reverse-index.ts:6](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L6)

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number`

## Implements

- [`IndexInterface`](../interfaces/IndexInterface.md)\<`TKey`\>

## Constructors

### Constructor

```ts
new ReverseIndex<TKey>(index): ReverseIndex<TKey>;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:11](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L11)

#### Parameters

##### index

[`IndexInterface`](../interfaces/IndexInterface.md)\<`TKey`\>

#### Returns

`ReverseIndex`\<`TKey`\>

## Accessors

### indexedKeysSet

#### Get Signature

```ts
get indexedKeysSet(): Set<TKey>;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:124](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L124)

##### Returns

`Set`\<`TKey`\>

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`indexedKeysSet`](../interfaces/IndexInterface.md#indexedkeysset)

***

### keyCount

#### Get Signature

```ts
get keyCount(): number;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:112](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L112)

##### Returns

`number`

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`keyCount`](../interfaces/IndexInterface.md#keycount)

***

### orderedEntriesArray

#### Get Signature

```ts
get orderedEntriesArray(): [any, Set<TKey>][];
```

Defined in: [packages/db/src/indexes/reverse-index.ts:62](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L62)

##### Returns

\[`any`, `Set`\<`TKey`\>\][]

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`orderedEntriesArray`](../interfaces/IndexInterface.md#orderedentriesarray)

***

### orderedEntriesArrayReversed

#### Get Signature

```ts
get orderedEntriesArrayReversed(): [any, Set<TKey>][];
```

Defined in: [packages/db/src/indexes/reverse-index.ts:66](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L66)

##### Returns

\[`any`, `Set`\<`TKey`\>\][]

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`orderedEntriesArrayReversed`](../interfaces/IndexInterface.md#orderedentriesarrayreversed)

***

### valueMapData

#### Get Signature

```ts
get valueMapData(): Map<any, Set<TKey>>;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:128](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L128)

##### Returns

`Map`\<`any`, `Set`\<`TKey`\>\>

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`valueMapData`](../interfaces/IndexInterface.md#valuemapdata)

## Methods

### add()

```ts
add(key, item): void;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L92)

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
build(entries): void;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:104](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L104)

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
clear(): void;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:108](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L108)

#### Returns

`void`

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`clear`](../interfaces/IndexInterface.md#clear)

***

### equalityLookup()

```ts
equalityLookup(value): Set<TKey>;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:116](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L116)

#### Parameters

##### value

`any`

#### Returns

`Set`\<`TKey`\>

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`equalityLookup`](../interfaces/IndexInterface.md#equalitylookup)

***

### getStats()

```ts
getStats(): IndexStats;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L88)

#### Returns

[`IndexStats`](../interfaces/IndexStats.md)

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`getStats`](../interfaces/IndexInterface.md#getstats)

***

### inArrayLookup()

```ts
inArrayLookup(values): Set<TKey>;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:120](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L120)

#### Parameters

##### values

`any`[]

#### Returns

`Set`\<`TKey`\>

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`inArrayLookup`](../interfaces/IndexInterface.md#inarraylookup)

***

### lookup()

```ts
lookup(operation, value): Set<TKey>;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:17](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L17)

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

Defined in: [packages/db/src/indexes/reverse-index.ts:80](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L80)

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

Defined in: [packages/db/src/indexes/reverse-index.ts:84](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L84)

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

Defined in: [packages/db/src/indexes/reverse-index.ts:76](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L76)

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
rangeQuery(options): Set<TKey>;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:31](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L31)

#### Parameters

##### options

[`BTreeRangeQueryOptions`](../interfaces/BTreeRangeQueryOptions.md) = `{}`

#### Returns

`Set`\<`TKey`\>

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`rangeQuery`](../interfaces/IndexInterface.md#rangequery)

***

### rangeQueryReversed()

```ts
rangeQueryReversed(options): Set<TKey>;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:35](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L35)

#### Parameters

##### options

[`BTreeRangeQueryOptions`](../interfaces/BTreeRangeQueryOptions.md) = `{}`

#### Returns

`Set`\<`TKey`\>

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`rangeQueryReversed`](../interfaces/IndexInterface.md#rangequeryreversed)

***

### remove()

```ts
remove(key, item): void;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:96](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L96)

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

Defined in: [packages/db/src/indexes/reverse-index.ts:72](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L72)

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
take(
   n, 
   from, 
   filterFn?): TKey[];
```

Defined in: [packages/db/src/indexes/reverse-index.ts:39](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L39)

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

[`IndexInterface`](../interfaces/IndexInterface.md).[`take`](../interfaces/IndexInterface.md#take)

***

### takeFromStart()

```ts
takeFromStart(n, filterFn?): TKey[];
```

Defined in: [packages/db/src/indexes/reverse-index.ts:43](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L43)

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
takeReversed(
   n, 
   from, 
   filterFn?): TKey[];
```

Defined in: [packages/db/src/indexes/reverse-index.ts:47](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L47)

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

[`IndexInterface`](../interfaces/IndexInterface.md).[`takeReversed`](../interfaces/IndexInterface.md#takereversed)

***

### takeReversedFromEnd()

```ts
takeReversedFromEnd(n, filterFn?): TKey[];
```

Defined in: [packages/db/src/indexes/reverse-index.ts:55](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L55)

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

### update()

```ts
update(
   key, 
   oldItem, 
   newItem): void;
```

Defined in: [packages/db/src/indexes/reverse-index.ts:100](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/reverse-index.ts#L100)

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

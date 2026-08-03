---
id: BaseIndex
title: BaseIndex
---

# Abstract Class: BaseIndex\<TKey\>

Defined in: [packages/db/src/indexes/base-index.ts:90](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L90)

Base abstract class that all index types extend

## Extended by

- [`BasicIndex`](BasicIndex.md)
- [`BTreeIndex`](BTreeIndex.md)

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

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

Defined in: [packages/db/src/indexes/base-index.ts:108](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L108)

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

Defined in: [packages/db/src/indexes/base-index.ts:101](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L101)

***

### expression

```ts
readonly expression: BasicExpression;
```

Defined in: [packages/db/src/indexes/base-index.ts:95](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L95)

***

### hasCustomComparator

```ts
protected hasCustomComparator: boolean = false;
```

Defined in: [packages/db/src/indexes/base-index.ts:106](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L106)

Set by subclasses when constructed with a user-supplied comparator, whose
ordering may not match the WHERE evaluator's relational operators.

***

### id

```ts
readonly id: number;
```

Defined in: [packages/db/src/indexes/base-index.ts:93](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L93)

***

### lastUpdated

```ts
protected lastUpdated: Date;
```

Defined in: [packages/db/src/indexes/base-index.ts:100](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L100)

***

### lookupCount

```ts
protected lookupCount: number = 0;
```

Defined in: [packages/db/src/indexes/base-index.ts:98](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L98)

***

### name?

```ts
readonly optional name: string;
```

Defined in: [packages/db/src/indexes/base-index.ts:94](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L94)

***

### supportedOperations

```ts
abstract readonly supportedOperations: Set<"eq" | "gt" | "gte" | "lt" | "lte" | "in" | "like" | "ilike">;
```

Defined in: [packages/db/src/indexes/base-index.ts:96](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L96)

***

### totalLookupTime

```ts
protected totalLookupTime: number = 0;
```

Defined in: [packages/db/src/indexes/base-index.ts:99](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L99)

## Accessors

### indexedKeysSet

#### Get Signature

```ts
get abstract indexedKeysSet(): Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:153](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L153)

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

Defined in: [packages/db/src/indexes/base-index.ts:146](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L146)

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

Defined in: [packages/db/src/indexes/base-index.ts:151](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L151)

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

Defined in: [packages/db/src/indexes/base-index.ts:152](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L152)

##### Returns

\[`any`, `Set`\<`TKey`\>\][]

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`orderedEntriesArrayReversed`](../interfaces/IndexInterface.md#orderedentriesarrayreversed)

***

### supportsRangeOptimization

#### Get Signature

```ts
get supportsRangeOptimization(): boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:161](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L161)

Whether range lookups (gt/gte/lt/lte) on this index can be trusted to
return every matching key. Range traversal relies on the index ordering, so
it is unsafe when the index uses a custom comparator, whose order may not
match the WHERE evaluator's relational operators. Callers must fall back to
a full scan when this is `false`.

##### Returns

`boolean`

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`supportsRangeOptimization`](../interfaces/IndexInterface.md#supportsrangeoptimization)

***

### valueMapData

#### Get Signature

```ts
get abstract valueMapData(): Map<any, Set<TKey>>;
```

Defined in: [packages/db/src/indexes/base-index.ts:154](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L154)

##### Returns

`Map`\<`any`, `Set`\<`TKey`\>\>

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`valueMapData`](../interfaces/IndexInterface.md#valuemapdata)

## Methods

### add()

```ts
abstract add(key, item): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:122](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L122)

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

Defined in: [packages/db/src/indexes/base-index.ts:125](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L125)

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

Defined in: [packages/db/src/indexes/base-index.ts:126](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L126)

#### Returns

`void`

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`clear`](../interfaces/IndexInterface.md#clear)

***

### equalityLookup()

```ts
abstract equalityLookup(value): Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:147](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L147)

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

Defined in: [packages/db/src/indexes/base-index.ts:212](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L212)

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

Defined in: [packages/db/src/indexes/base-index.ts:200](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L200)

#### Returns

[`IndexStats`](../interfaces/IndexStats.md)

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`getStats`](../interfaces/IndexInterface.md#getstats)

***

### inArrayLookup()

```ts
abstract inArrayLookup(values): Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:148](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L148)

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

Defined in: [packages/db/src/indexes/base-index.ts:210](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L210)

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

Defined in: [packages/db/src/indexes/base-index.ts:127](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L127)

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

Defined in: [packages/db/src/indexes/base-index.ts:177](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L177)

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

Defined in: [packages/db/src/indexes/base-index.ts:196](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L196)

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

Defined in: [packages/db/src/indexes/base-index.ts:165](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L165)

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

Defined in: [packages/db/src/indexes/base-index.ts:149](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L149)

#### Parameters

##### options

[`BTreeRangeQueryOptions`](../interfaces/BTreeRangeQueryOptions.md)

#### Returns

`Set`\<`TKey`\>

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`rangeQuery`](../interfaces/IndexInterface.md#rangequery)

***

### rangeQueryReversed()

```ts
abstract rangeQueryReversed(options): Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:150](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L150)

#### Parameters

##### options

[`BTreeRangeQueryOptions`](../interfaces/BTreeRangeQueryOptions.md)

#### Returns

`Set`\<`TKey`\>

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`rangeQueryReversed`](../interfaces/IndexInterface.md#rangequeryreversed)

***

### remove()

```ts
abstract remove(key, item): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:123](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L123)

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

Defined in: [packages/db/src/indexes/base-index.ts:157](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L157)

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

Defined in: [packages/db/src/indexes/base-index.ts:128](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L128)

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

Defined in: [packages/db/src/indexes/base-index.ts:133](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L133)

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

Defined in: [packages/db/src/indexes/base-index.ts:137](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L137)

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

Defined in: [packages/db/src/indexes/base-index.ts:142](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L142)

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

Defined in: [packages/db/src/indexes/base-index.ts:217](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L217)

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

Defined in: [packages/db/src/indexes/base-index.ts:124](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L124)

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

Defined in: [packages/db/src/indexes/base-index.ts:223](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L223)

#### Returns

`void`

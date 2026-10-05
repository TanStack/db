---
id: BaseIndex
title: BaseIndex
---

Defined in: [packages/db/src/indexes/base-index.ts:118](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L118)

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

`BaseIndex`\<`TKey`\>

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

***

### compareOptions

```ts
protected readonly compareOptions: CompareOptions;
```

Defined in: [packages/db/src/indexes/base-index.ts:125](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L125)

***

### expression

```ts
readonly expression: BasicExpression;
```

Defined in: [packages/db/src/indexes/base-index.ts:123](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L123)

***

### hasCustomComparator

```ts
protected readonly hasCustomComparator: boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:136](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L136)

A user-supplied comparator's ordering may not match the WHERE evaluator's
relational operators.

***

### id

```ts
readonly id: number;
```

Defined in: [packages/db/src/indexes/base-index.ts:121](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L121)

***

### name?

```ts
readonly optional name: string;
```

Defined in: [packages/db/src/indexes/base-index.ts:122](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L122)

***

### supportedOperations

```ts
abstract readonly supportedOperations: Set<"eq" | "gt" | "gte" | "lt" | "lte" | "in" | "like" | "ilike">;
```

Defined in: [packages/db/src/indexes/base-index.ts:124](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L124)

## Accessors

### keyCount

#### Get Signature

```ts
get abstract keyCount(): number;
```

Defined in: [packages/db/src/indexes/base-index.ts:181](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L181)

##### Returns

`number`

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`keyCount`](../interfaces/IndexInterface.md#keycount)

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

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`supportsRangeOptimization`](../interfaces/IndexInterface.md#supportsrangeoptimization)

## Methods

### add()

```ts
abstract add(key, item): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:157](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L157)

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

***

### build()

```ts
abstract build(entries): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:160](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L160)

#### Parameters

##### entries

`Iterable`\<\[`TKey`, `any`\]\>

#### Returns

`void`

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`build`](../interfaces/IndexInterface.md#build)

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

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`canOptimizeRangeFor`](../interfaces/IndexInterface.md#canoptimizerangefor)

***

### clear()

```ts
abstract clear(): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:161](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L161)

#### Returns

`void`

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`clear`](../interfaces/IndexInterface.md#clear)

***

### clearRangeValues()

```ts
protected clearRangeValues(): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:227](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L227)

#### Returns

`void`

***

### equalityLookup()

```ts
abstract equalityLookup(value): Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:182](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L182)

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

Defined in: [packages/db/src/indexes/base-index.ts:299](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L299)

#### Parameters

##### item

`any`

#### Returns

`any`

***

### inArrayLookup()

```ts
abstract inArrayLookup(values): Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:183](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L183)

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

Defined in: [packages/db/src/indexes/base-index.ts:297](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L297)

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

Defined in: [packages/db/src/indexes/base-index.ts:162](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L162)

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

Defined in: [packages/db/src/indexes/base-index.ts:253](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L253)

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

Defined in: [packages/db/src/indexes/base-index.ts:293](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L293)

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

Defined in: [packages/db/src/indexes/base-index.ts:241](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L241)

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

Defined in: [packages/db/src/indexes/base-index.ts:184](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L184)

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
rangeQueryReversed(options): Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:187](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L187)

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
abstract remove(key, item): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:158](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L158)

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

Defined in: [packages/db/src/indexes/base-index.ts:163](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L163)

#### Parameters

##### n

`number`

##### from

`unknown`

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

Defined in: [packages/db/src/indexes/base-index.ts:168](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L168)

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

Defined in: [packages/db/src/indexes/base-index.ts:172](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L172)

#### Parameters

##### n

`number`

##### from

`unknown`

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

Defined in: [packages/db/src/indexes/base-index.ts:177](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L177)

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
abstract update(
   key, 
   oldItem, 
   newItem): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:159](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L159)

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

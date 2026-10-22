---
id: BaseIndex
title: BaseIndex
---

Defined in: [packages/db/src/indexes/base-index.ts:137](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L137)

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

`BaseIndex`\<`TKey`\>

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

***

### compareOptions

```ts
protected readonly compareOptions: CompareOptions;
```

Defined in: [packages/db/src/indexes/base-index.ts:144](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L144)

***

### expression

```ts
readonly expression: BasicExpression;
```

Defined in: [packages/db/src/indexes/base-index.ts:142](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L142)

***

### hasCustomComparator

```ts
protected readonly hasCustomComparator: boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:155](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L155)

A user-supplied comparator's ordering may not match the WHERE evaluator's
relational operators.

***

### id

```ts
readonly id: number;
```

Defined in: [packages/db/src/indexes/base-index.ts:140](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L140)

***

### name?

```ts
readonly optional name: string;
```

Defined in: [packages/db/src/indexes/base-index.ts:141](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L141)

***

### supportedOperations

```ts
readonly supportedOperations: Set<"eq" | "gt" | "gte" | "lt" | "lte" | "in" | "like" | "ilike">;
```

Defined in: [packages/db/src/indexes/base-index.ts:143](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L143)

## Accessors

### keyCount

#### Get Signature

```ts
get abstract keyCount(): number;
```

Defined in: [packages/db/src/indexes/base-index.ts:203](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L203)

##### Returns

`number`

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`keyCount`](../interfaces/IndexInterface.md#keycount)

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

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`supportsOrderOptimization`](../interfaces/IndexInterface.md#supportsorderoptimization)

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

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`supportsRangeOptimization`](../interfaces/IndexInterface.md#supportsrangeoptimization)

## Methods

### add()

```ts
abstract add(key, item): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:179](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L179)

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

Defined in: [packages/db/src/indexes/base-index.ts:277](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L277)

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

Defined in: [packages/db/src/indexes/base-index.ts:182](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L182)

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

Defined in: [packages/db/src/indexes/base-index.ts:299](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L299)

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

Defined in: [packages/db/src/indexes/base-index.ts:183](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L183)

#### Returns

`void`

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`clear`](../interfaces/IndexInterface.md#clear)

***

### clearRangeValues()

```ts
protected clearRangeValues(): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:295](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L295)

#### Returns

`void`

***

### equalityLookup()

```ts
abstract equalityLookup(value): Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:204](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L204)

#### Parameters

##### value

`any`

#### Returns

`Set`\<`TKey`\>

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`equalityLookup`](../interfaces/IndexInterface.md#equalitylookup)

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

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`inArrayLookup`](../interfaces/IndexInterface.md#inarraylookup)

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

***

### lookup()

```ts
abstract lookup(operation, value): Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:184](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L184)

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

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`matchesCompareOptions`](../interfaces/IndexInterface.md#matchescompareoptions)

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

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`matchesDirection`](../interfaces/IndexInterface.md#matchesdirection)

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

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`matchesField`](../interfaces/IndexInterface.md#matchesfield)

***

### rangeQuery()

```ts
abstract rangeQuery(options): Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:208](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L208)

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
rangeQueryReversed(options): Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:237](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L237)

#### Parameters

##### options

[`RangeQueryOptions`](../interfaces/RangeQueryOptions.md) = `{}`

#### Returns

`Set`\<`TKey`\>

#### Implementation of

[`IndexInterface`](../interfaces/IndexInterface.md).[`rangeQueryReversed`](../interfaces/IndexInterface.md#rangequeryreversed)

***

### remove()

```ts
abstract remove(key, item): void;
```

Defined in: [packages/db/src/indexes/base-index.ts:180](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L180)

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

Defined in: [packages/db/src/indexes/base-index.ts:286](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L286)

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

Defined in: [packages/db/src/indexes/base-index.ts:251](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L251)

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

Defined in: [packages/db/src/indexes/base-index.ts:185](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L185)

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

Defined in: [packages/db/src/indexes/base-index.ts:190](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L190)

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

Defined in: [packages/db/src/indexes/base-index.ts:194](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L194)

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

Defined in: [packages/db/src/indexes/base-index.ts:199](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L199)

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

Defined in: [packages/db/src/indexes/base-index.ts:181](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L181)

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

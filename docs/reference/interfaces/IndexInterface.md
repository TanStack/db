---
id: IndexInterface
title: IndexInterface
---

Defined in: [packages/db/src/indexes/base-index.ts:74](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L74)

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### add()

```ts
add: (key, item) => void;
```

Defined in: [packages/db/src/indexes/base-index.ts:77](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L77)

#### Parameters

##### key

`TKey`

##### item

`any`

#### Returns

`void`

***

### build()

```ts
build: (entries) => void;
```

Defined in: [packages/db/src/indexes/base-index.ts:81](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L81)

#### Parameters

##### entries

`Iterable`\<\[`TKey`, `any`\]\>

#### Returns

`void`

***

### canOptimizeRangeFor()?

```ts
optional canOptimizeRangeFor: (value) => boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:127](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L127)

Whether the live values in this index share the predicate operand's
relational domain. Mixed domains can sort differently in the index and
WHERE evaluator, which can make a range lookup omit matching rows.

#### Parameters

##### value

`unknown`

#### Returns

`boolean`

***

### clear()

```ts
clear: () => void;
```

Defined in: [packages/db/src/indexes/base-index.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L82)

#### Returns

`void`

***

### equalityLookup()

```ts
equalityLookup: (value) => Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L86)

#### Parameters

##### value

`any`

#### Returns

`Set`\<`TKey`\>

***

### inArrayLookup()

```ts
inArrayLookup: (values) => Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:87](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L87)

#### Parameters

##### values

`any`[]

#### Returns

`Set`\<`TKey`\>

***

### lookup()

```ts
lookup: (operation, value) => Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:84](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L84)

#### Parameters

##### operation

`"eq"` | `"gt"` | `"gte"` | `"lt"` | `"lte"` | `"in"` | `"like"` | `"ilike"`

##### value

`any`

#### Returns

`Set`\<`TKey`\>

***

### matchesCompareOptions()

```ts
matchesCompareOptions: (compareOptions) => boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:130](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L130)

#### Parameters

##### compareOptions

`CompareOptions`

#### Returns

`boolean`

***

### matchesDirection()

```ts
matchesDirection: (direction) => boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:131](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L131)

#### Parameters

##### direction

[`OrderByDirection`](../@tanstack/namespaces/IR/type-aliases/OrderByDirection.md)

#### Returns

`boolean`

***

### matchesField()

```ts
matchesField: (fieldPath) => boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:129](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L129)

#### Parameters

##### fieldPath

`string`[]

#### Returns

`boolean`

***

### rangeQuery()

```ts
rangeQuery: (options) => Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:89](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L89)

#### Parameters

##### options

[`RangeQueryOptions`](RangeQueryOptions.md)

#### Returns

`Set`\<`TKey`\>

***

### rangeQueryReversed()

```ts
rangeQueryReversed: (options) => Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:90](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L90)

#### Parameters

##### options

[`RangeQueryOptions`](RangeQueryOptions.md)

#### Returns

`Set`\<`TKey`\>

***

### remove()

```ts
remove: (key, item) => void;
```

Defined in: [packages/db/src/indexes/base-index.ts:78](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L78)

#### Parameters

##### key

`TKey`

##### item

`any`

#### Returns

`void`

***

### supports()

```ts
supports: (operation) => boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:109](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L109)

#### Parameters

##### operation

`"eq"` | `"gt"` | `"gte"` | `"lt"` | `"lte"` | `"in"` | `"like"` | `"ilike"`

#### Returns

`boolean`

***

### supportsOrderOptimization?

```ts
readonly optional supportsOrderOptimization: boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:120](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L120)

Whether a query can use this index for its declared ordered prefix.

***

### take()

```ts
take: (n, from, filterFn?) => TKey[];
```

Defined in: [packages/db/src/indexes/base-index.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L92)

#### Parameters

##### n

`number`

##### from

`unknown`

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

***

### takeFromStart()

```ts
takeFromStart: (n, filterFn?) => TKey[];
```

Defined in: [packages/db/src/indexes/base-index.ts:97](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L97)

#### Parameters

##### n

`number`

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

***

### takeReversed()

```ts
takeReversed: (n, from, filterFn?) => TKey[];
```

Defined in: [packages/db/src/indexes/base-index.ts:98](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L98)

#### Parameters

##### n

`number`

##### from

`unknown`

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

***

### takeReversedFromEnd()

```ts
takeReversedFromEnd: (n, filterFn?) => TKey[];
```

Defined in: [packages/db/src/indexes/base-index.ts:103](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L103)

#### Parameters

##### n

`number`

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

***

### update()

```ts
update: (key, oldItem, newItem) => void;
```

Defined in: [packages/db/src/indexes/base-index.ts:79](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L79)

#### Parameters

##### key

`TKey`

##### oldItem

`any`

##### newItem

`any`

#### Returns

`void`

## Accessors

### keyCount

#### Get Signature

```ts
get keyCount(): number;
```

Defined in: [packages/db/src/indexes/base-index.ts:108](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L108)

##### Returns

`number`

***

### supportsRangeOptimization

#### Get Signature

```ts
get supportsRangeOptimization(): boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:118](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L118)

Whether range lookups (gt/gte/lt/lte) on this index can be trusted to
return every matching key. Range traversal relies on the index ordering, so
it is unsafe when the index uses a custom comparator, whose order may not
match the WHERE evaluator's relational operators. Callers must fall back to
a full scan when this is `false`.

##### Returns

`boolean`

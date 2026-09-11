---
id: IndexInterface
title: IndexInterface
---

# Interface: IndexInterface\<TKey\>

Defined in: [packages/db/src/indexes/base-index.ts:54](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L54)

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### add()

```ts
add: (key, item) => void;
```

Defined in: [packages/db/src/indexes/base-index.ts:57](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L57)

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

Defined in: [packages/db/src/indexes/base-index.ts:61](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L61)

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

Defined in: [packages/db/src/indexes/base-index.ts:105](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L105)

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

Defined in: [packages/db/src/indexes/base-index.ts:62](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L62)

#### Returns

`void`

***

### equalityLookup()

```ts
equalityLookup: (value) => Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:66](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L66)

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

Defined in: [packages/db/src/indexes/base-index.ts:67](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L67)

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

Defined in: [packages/db/src/indexes/base-index.ts:64](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L64)

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

Defined in: [packages/db/src/indexes/base-index.ts:108](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L108)

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

Defined in: [packages/db/src/indexes/base-index.ts:109](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L109)

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

Defined in: [packages/db/src/indexes/base-index.ts:107](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L107)

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

Defined in: [packages/db/src/indexes/base-index.ts:69](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L69)

#### Parameters

##### options

[`BTreeRangeQueryOptions`](BTreeRangeQueryOptions.md)

#### Returns

`Set`\<`TKey`\>

***

### rangeQueryReversed()

```ts
rangeQueryReversed: (options) => Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:70](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L70)

#### Parameters

##### options

[`BTreeRangeQueryOptions`](BTreeRangeQueryOptions.md)

#### Returns

`Set`\<`TKey`\>

***

### remove()

```ts
remove: (key, item) => void;
```

Defined in: [packages/db/src/indexes/base-index.ts:58](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L58)

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

Defined in: [packages/db/src/indexes/base-index.ts:89](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L89)

#### Parameters

##### operation

`"eq"` | `"gt"` | `"gte"` | `"lt"` | `"lte"` | `"in"` | `"like"` | `"ilike"`

#### Returns

`boolean`

***

### take()

```ts
take: (n, from, filterFn?) => TKey[];
```

Defined in: [packages/db/src/indexes/base-index.ts:72](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L72)

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

Defined in: [packages/db/src/indexes/base-index.ts:77](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L77)

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

Defined in: [packages/db/src/indexes/base-index.ts:78](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L78)

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

Defined in: [packages/db/src/indexes/base-index.ts:83](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L83)

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

Defined in: [packages/db/src/indexes/base-index.ts:59](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L59)

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

Defined in: [packages/db/src/indexes/base-index.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L88)

##### Returns

`number`

***

### supportsRangeOptimization

#### Get Signature

```ts
get supportsRangeOptimization(): boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:98](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L98)

Whether range lookups (gt/gte/lt/lte) on this index can be trusted to
return every matching key. Range traversal relies on the index ordering, so
it is unsafe when the index uses a custom comparator, whose order may not
match the WHERE evaluator's relational operators. Callers must fall back to
a full scan when this is `false`.

##### Returns

`boolean`

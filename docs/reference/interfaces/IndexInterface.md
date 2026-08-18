---
id: IndexInterface
title: IndexInterface
---

# Interface: IndexInterface\<TKey\>

Defined in: [packages/db/src/indexes/base-index.ts:29](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L29)

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### add()

```ts
add: (key, item) => void;
```

Defined in: [packages/db/src/indexes/base-index.ts:32](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L32)

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

Defined in: [packages/db/src/indexes/base-index.ts:36](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L36)

#### Parameters

##### entries

`Iterable`\<\[`TKey`, `any`\]\>

#### Returns

`void`

***

### clear()

```ts
clear: () => void;
```

Defined in: [packages/db/src/indexes/base-index.ts:37](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L37)

#### Returns

`void`

***

### equalityLookup()

```ts
equalityLookup: (value) => Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:41](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L41)

#### Parameters

##### value

`any`

#### Returns

`Set`\<`TKey`\>

***

### getStats()

```ts
getStats: () => IndexStats;
```

Defined in: [packages/db/src/indexes/base-index.ts:85](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L85)

#### Returns

[`IndexStats`](IndexStats.md)

***

### inArrayLookup()

```ts
inArrayLookup: (values) => Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:42](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L42)

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

Defined in: [packages/db/src/indexes/base-index.ts:39](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L39)

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

Defined in: [packages/db/src/indexes/base-index.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L82)

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

Defined in: [packages/db/src/indexes/base-index.ts:83](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L83)

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

Defined in: [packages/db/src/indexes/base-index.ts:81](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L81)

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

Defined in: [packages/db/src/indexes/base-index.ts:44](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L44)

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

Defined in: [packages/db/src/indexes/base-index.ts:45](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L45)

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

Defined in: [packages/db/src/indexes/base-index.ts:33](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L33)

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

Defined in: [packages/db/src/indexes/base-index.ts:70](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L70)

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

Defined in: [packages/db/src/indexes/base-index.ts:47](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L47)

#### Parameters

##### n

`number`

##### from

`TKey`

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

***

### takeFromStart()

```ts
takeFromStart: (n, filterFn?) => TKey[];
```

Defined in: [packages/db/src/indexes/base-index.ts:52](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L52)

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

Defined in: [packages/db/src/indexes/base-index.ts:53](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L53)

#### Parameters

##### n

`number`

##### from

`TKey`

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

***

### takeReversedFromEnd()

```ts
takeReversedFromEnd: (n, filterFn?) => TKey[];
```

Defined in: [packages/db/src/indexes/base-index.ts:58](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L58)

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

Defined in: [packages/db/src/indexes/base-index.ts:34](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L34)

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

### indexedKeysSet

#### Get Signature

```ts
get indexedKeysSet(): Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:67](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L67)

##### Returns

`Set`\<`TKey`\>

***

### keyCount

#### Get Signature

```ts
get keyCount(): number;
```

Defined in: [packages/db/src/indexes/base-index.ts:63](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L63)

##### Returns

`number`

***

### orderedEntriesArray

#### Get Signature

```ts
get orderedEntriesArray(): [any, Set<TKey>][];
```

Defined in: [packages/db/src/indexes/base-index.ts:64](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L64)

##### Returns

\[`any`, `Set`\<`TKey`\>\][]

***

### orderedEntriesArrayReversed

#### Get Signature

```ts
get orderedEntriesArrayReversed(): [any, Set<TKey>][];
```

Defined in: [packages/db/src/indexes/base-index.ts:65](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L65)

##### Returns

\[`any`, `Set`\<`TKey`\>\][]

***

### supportsRangeOptimization

#### Get Signature

```ts
get supportsRangeOptimization(): boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:79](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L79)

Whether range lookups (gt/gte/lt/lte) on this index can be trusted to
return every matching key. Range traversal relies on the index ordering, so
it is unsafe when the index uses a custom comparator, whose order may not
match the WHERE evaluator's relational operators. Callers must fall back to
a full scan when this is `false`.

##### Returns

`boolean`

***

### valueMapData

#### Get Signature

```ts
get valueMapData(): Map<any, Set<TKey>>;
```

Defined in: [packages/db/src/indexes/base-index.ts:68](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L68)

##### Returns

`Map`\<`any`, `Set`\<`TKey`\>\>

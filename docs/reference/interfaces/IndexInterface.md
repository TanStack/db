---
id: IndexInterface
title: IndexInterface
---

# Interface: IndexInterface\<TKey\>

Defined in: [packages/db/src/indexes/base-index.ts:51](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L51)

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### add()

```ts
add: (key, item) => void;
```

Defined in: [packages/db/src/indexes/base-index.ts:54](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L54)

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

Defined in: [packages/db/src/indexes/base-index.ts:58](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L58)

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

Defined in: [packages/db/src/indexes/base-index.ts:59](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L59)

#### Returns

`void`

***

### equalityLookup()

```ts
equalityLookup: (value) => Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:63](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L63)

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

Defined in: [packages/db/src/indexes/base-index.ts:107](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L107)

#### Returns

[`IndexStats`](IndexStats.md)

***

### inArrayLookup()

```ts
inArrayLookup: (values) => Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:64](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L64)

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

Defined in: [packages/db/src/indexes/base-index.ts:61](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L61)

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

Defined in: [packages/db/src/indexes/base-index.ts:104](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L104)

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

Defined in: [packages/db/src/indexes/base-index.ts:105](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L105)

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

Defined in: [packages/db/src/indexes/base-index.ts:103](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L103)

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

Defined in: [packages/db/src/indexes/base-index.ts:66](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L66)

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

Defined in: [packages/db/src/indexes/base-index.ts:67](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L67)

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

Defined in: [packages/db/src/indexes/base-index.ts:55](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L55)

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

Defined in: [packages/db/src/indexes/base-index.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L92)

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

Defined in: [packages/db/src/indexes/base-index.ts:69](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L69)

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

Defined in: [packages/db/src/indexes/base-index.ts:74](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L74)

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

Defined in: [packages/db/src/indexes/base-index.ts:75](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L75)

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

Defined in: [packages/db/src/indexes/base-index.ts:80](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L80)

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

Defined in: [packages/db/src/indexes/base-index.ts:56](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L56)

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

Defined in: [packages/db/src/indexes/base-index.ts:89](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L89)

##### Returns

`Set`\<`TKey`\>

***

### keyCount

#### Get Signature

```ts
get keyCount(): number;
```

Defined in: [packages/db/src/indexes/base-index.ts:85](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L85)

##### Returns

`number`

***

### orderedEntriesArray

#### Get Signature

```ts
get orderedEntriesArray(): [any, Set<TKey>][];
```

Defined in: [packages/db/src/indexes/base-index.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L86)

##### Returns

\[`any`, `Set`\<`TKey`\>\][]

***

### orderedEntriesArrayReversed

#### Get Signature

```ts
get orderedEntriesArrayReversed(): [any, Set<TKey>][];
```

Defined in: [packages/db/src/indexes/base-index.ts:87](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L87)

##### Returns

\[`any`, `Set`\<`TKey`\>\][]

***

### supportsRangeOptimization

#### Get Signature

```ts
get supportsRangeOptimization(): boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:101](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L101)

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

Defined in: [packages/db/src/indexes/base-index.ts:90](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L90)

##### Returns

`Map`\<`any`, `Set`\<`TKey`\>\>

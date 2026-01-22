---
id: IndexInterface
title: IndexInterface
---

# Interface: IndexInterface\<TKey\>

Defined in: [packages/db/src/indexes/base-index.ts:28](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L28)

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### add()

```ts
add: (key, item) => void;
```

Defined in: [packages/db/src/indexes/base-index.ts:31](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L31)

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

Defined in: [packages/db/src/indexes/base-index.ts:35](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L35)

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

Defined in: [packages/db/src/indexes/base-index.ts:36](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L36)

#### Returns

`void`

***

### equalityLookup()

```ts
equalityLookup: (value) => Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:40](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L40)

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

Defined in: [packages/db/src/indexes/base-index.ts:70](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L70)

#### Returns

[`IndexStats`](IndexStats.md)

***

### inArrayLookup()

```ts
inArrayLookup: (values) => Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:41](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L41)

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

Defined in: [packages/db/src/indexes/base-index.ts:38](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L38)

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

Defined in: [packages/db/src/indexes/base-index.ts:67](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L67)

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

Defined in: [packages/db/src/indexes/base-index.ts:68](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L68)

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

Defined in: [packages/db/src/indexes/base-index.ts:66](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L66)

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

Defined in: [packages/db/src/indexes/base-index.ts:43](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L43)

#### Parameters

##### options

`RangeQueryOptions`

#### Returns

`Set`\<`TKey`\>

***

### rangeQueryReversed()

```ts
rangeQueryReversed: (options) => Set<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:44](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L44)

#### Parameters

##### options

`RangeQueryOptions`

#### Returns

`Set`\<`TKey`\>

***

### remove()

```ts
remove: (key, item) => void;
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

### supports()

```ts
supports: (operation) => boolean;
```

Defined in: [packages/db/src/indexes/base-index.ts:64](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L64)

#### Parameters

##### operation

`"eq"` | `"gt"` | `"gte"` | `"lt"` | `"lte"` | `"in"` | `"like"` | `"ilike"`

#### Returns

`boolean`

***

### take()

```ts
take: (n, from?, filterFn?) => TKey[];
```

Defined in: [packages/db/src/indexes/base-index.ts:46](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L46)

#### Parameters

##### n

`number`

##### from?

`TKey`

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

***

### takeReversed()

```ts
takeReversed: (n, from?, filterFn?) => TKey[];
```

Defined in: [packages/db/src/indexes/base-index.ts:51](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L51)

#### Parameters

##### n

`number`

##### from?

`TKey`

##### filterFn?

(`key`) => `boolean`

#### Returns

`TKey`[]

***

### update()

```ts
update: (key, oldItem, newItem) => void;
```

Defined in: [packages/db/src/indexes/base-index.ts:33](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L33)

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

Defined in: [packages/db/src/indexes/base-index.ts:61](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L61)

##### Returns

`Set`\<`TKey`\>

***

### keyCount

#### Get Signature

```ts
get keyCount(): number;
```

Defined in: [packages/db/src/indexes/base-index.ts:57](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L57)

##### Returns

`number`

***

### orderedEntriesArray

#### Get Signature

```ts
get orderedEntriesArray(): [any, Set<TKey>][];
```

Defined in: [packages/db/src/indexes/base-index.ts:58](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L58)

##### Returns

\[`any`, `Set`\<`TKey`\>\][]

***

### orderedEntriesArrayReversed

#### Get Signature

```ts
get orderedEntriesArrayReversed(): [any, Set<TKey>][];
```

Defined in: [packages/db/src/indexes/base-index.ts:59](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L59)

##### Returns

\[`any`, `Set`\<`TKey`\>\][]

***

### valueMapData

#### Get Signature

```ts
get valueMapData(): Map<any, Set<TKey>>;
```

Defined in: [packages/db/src/indexes/base-index.ts:62](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L62)

##### Returns

`Map`\<`any`, `Set`\<`TKey`\>\>

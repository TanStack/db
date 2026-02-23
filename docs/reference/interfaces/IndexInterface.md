---
id: IndexInterface
title: IndexInterface
---

# Interface: IndexInterface\<TKey\>

Defined in: packages/db/src/indexes/base-index.ts:28

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` \| `undefined` = `string` \| `number` \| `undefined`

## Properties

### add()

```ts
add: (key, item) => void;
```

Defined in: packages/db/src/indexes/base-index.ts:31

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

Defined in: packages/db/src/indexes/base-index.ts:35

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

Defined in: packages/db/src/indexes/base-index.ts:36

#### Returns

`void`

***

### equalityLookup()

```ts
equalityLookup: (value) => Set<TKey>;
```

Defined in: packages/db/src/indexes/base-index.ts:40

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

Defined in: packages/db/src/indexes/base-index.ts:75

#### Returns

[`IndexStats`](IndexStats.md)

***

### inArrayLookup()

```ts
inArrayLookup: (values) => Set<TKey>;
```

Defined in: packages/db/src/indexes/base-index.ts:41

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

Defined in: packages/db/src/indexes/base-index.ts:38

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

Defined in: packages/db/src/indexes/base-index.ts:72

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

Defined in: packages/db/src/indexes/base-index.ts:73

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

Defined in: packages/db/src/indexes/base-index.ts:71

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

Defined in: packages/db/src/indexes/base-index.ts:43

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

Defined in: packages/db/src/indexes/base-index.ts:44

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

Defined in: packages/db/src/indexes/base-index.ts:32

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

Defined in: packages/db/src/indexes/base-index.ts:69

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

Defined in: packages/db/src/indexes/base-index.ts:46

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

Defined in: packages/db/src/indexes/base-index.ts:51

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

Defined in: packages/db/src/indexes/base-index.ts:52

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

Defined in: packages/db/src/indexes/base-index.ts:57

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

Defined in: packages/db/src/indexes/base-index.ts:33

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

Defined in: packages/db/src/indexes/base-index.ts:66

##### Returns

`Set`\<`TKey`\>

***

### keyCount

#### Get Signature

```ts
get keyCount(): number;
```

Defined in: packages/db/src/indexes/base-index.ts:62

##### Returns

`number`

***

### orderedEntriesArray

#### Get Signature

```ts
get orderedEntriesArray(): [any, Set<TKey>][];
```

Defined in: packages/db/src/indexes/base-index.ts:63

##### Returns

\[`any`, `Set`\<`TKey`\>\][]

***

### orderedEntriesArrayReversed

#### Get Signature

```ts
get orderedEntriesArrayReversed(): [any, Set<TKey>][];
```

Defined in: packages/db/src/indexes/base-index.ts:64

##### Returns

\[`any`, `Set`\<`TKey`\>\][]

***

### valueMapData

#### Get Signature

```ts
get valueMapData(): Map<any, Set<TKey>>;
```

Defined in: packages/db/src/indexes/base-index.ts:67

##### Returns

`Map`\<`any`, `Set`\<`TKey`\>\>

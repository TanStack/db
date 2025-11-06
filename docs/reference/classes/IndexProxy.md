---
id: IndexProxy
title: IndexProxy
---

# Class: IndexProxy\<TKey\>

Defined in: packages/db/src/indexes/lazy-index.ts:131

Proxy that provides synchronous interface while index loads asynchronously

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Constructors

### Constructor

```ts
new IndexProxy<TKey>(indexId, lazyIndex): IndexProxy<TKey>;
```

Defined in: packages/db/src/indexes/lazy-index.ts:132

#### Parameters

##### indexId

`number`

##### lazyIndex

[`LazyIndexWrapper`](../LazyIndexWrapper.md)\<`TKey`\>

#### Returns

`IndexProxy`\<`TKey`\>

## Accessors

### expression

#### Get Signature

```ts
get expression(): BasicExpression;
```

Defined in: packages/db/src/indexes/lazy-index.ts:178

Get the index expression (available immediately)

##### Returns

[`BasicExpression`](../../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)

***

### id

#### Get Signature

```ts
get id(): number;
```

Defined in: packages/db/src/indexes/lazy-index.ts:161

Get the index ID

##### Returns

`number`

***

### index

#### Get Signature

```ts
get index(): BaseIndex<TKey>;
```

Defined in: packages/db/src/indexes/lazy-index.ts:140

Get the resolved index (throws if not ready)

##### Returns

[`BaseIndex`](../BaseIndex.md)\<`TKey`\>

***

### indexedKeysSet

#### Get Signature

```ts
get indexedKeysSet(): Set<TKey>;
```

Defined in: packages/db/src/indexes/lazy-index.ts:216

##### Returns

`Set`\<`TKey`\>

***

### isReady

#### Get Signature

```ts
get isReady(): boolean;
```

Defined in: packages/db/src/indexes/lazy-index.ts:147

Check if index is ready

##### Returns

`boolean`

***

### keyCount

#### Get Signature

```ts
get keyCount(): number;
```

Defined in: packages/db/src/indexes/lazy-index.ts:211

Get the key count (throws if not ready)

##### Returns

`number`

***

### name

#### Get Signature

```ts
get name(): string | undefined;
```

Defined in: packages/db/src/indexes/lazy-index.ts:168

Get the index name (throws if not ready)

##### Returns

`string` \| `undefined`

***

### orderedEntriesArray

#### Get Signature

```ts
get orderedEntriesArray(): [any, Set<TKey>][];
```

Defined in: packages/db/src/indexes/lazy-index.ts:221

##### Returns

\[`any`, `Set`\<`TKey`\>\][]

***

### valueMapData

#### Get Signature

```ts
get valueMapData(): Map<any, Set<TKey>>;
```

Defined in: packages/db/src/indexes/lazy-index.ts:226

##### Returns

`Map`\<`any`, `Set`\<`TKey`\>\>

## Methods

### \_getLazyWrapper()

```ts
_getLazyWrapper(): LazyIndexWrapper<TKey>;
```

Defined in: packages/db/src/indexes/lazy-index.ts:248

#### Returns

[`LazyIndexWrapper`](../LazyIndexWrapper.md)\<`TKey`\>

***

### equalityLookup()

```ts
equalityLookup(value): Set<TKey>;
```

Defined in: packages/db/src/indexes/lazy-index.ts:232

#### Parameters

##### value

`any`

#### Returns

`Set`\<`TKey`\>

***

### getStats()

```ts
getStats(): IndexStats;
```

Defined in: packages/db/src/indexes/lazy-index.ts:192

Get index statistics (throws if not ready)

#### Returns

[`IndexStats`](../../interfaces/IndexStats.md)

***

### inArrayLookup()

```ts
inArrayLookup(values): Set<TKey>;
```

Defined in: packages/db/src/indexes/lazy-index.ts:242

#### Parameters

##### values

`any`[]

#### Returns

`Set`\<`TKey`\>

***

### matchesField()

```ts
matchesField(fieldPath): boolean;
```

Defined in: packages/db/src/indexes/lazy-index.ts:199

Check if index matches a field path (available immediately)

#### Parameters

##### fieldPath

`string`[]

#### Returns

`boolean`

***

### rangeQuery()

```ts
rangeQuery(options): Set<TKey>;
```

Defined in: packages/db/src/indexes/lazy-index.ts:237

#### Parameters

##### options

`any`

#### Returns

`Set`\<`TKey`\>

***

### supports()

```ts
supports(operation): boolean;
```

Defined in: packages/db/src/indexes/lazy-index.ts:185

Check if index supports an operation (throws if not ready)

#### Parameters

##### operation

`any`

#### Returns

`boolean`

***

### whenReady()

```ts
whenReady(): Promise<BaseIndex<TKey>>;
```

Defined in: packages/db/src/indexes/lazy-index.ts:154

Wait for index to be ready

#### Returns

`Promise`\<[`BaseIndex`](../BaseIndex.md)\<`TKey`\>\>

---
id: LazyIndexWrapper
title: LazyIndexWrapper
---

# Class: LazyIndexWrapper\<TKey\>

Defined in: [packages/db/src/indexes/lazy-index.ts:39](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/lazy-index.ts#L39)

Wrapper that defers index creation until first sync

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Constructors

### Constructor

```ts
new LazyIndexWrapper<TKey>(
   id, 
   expression, 
   name, 
   resolver, 
   options, 
collectionEntries?): LazyIndexWrapper<TKey>;
```

Defined in: [packages/db/src/indexes/lazy-index.ts:43](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/lazy-index.ts#L43)

#### Parameters

##### id

`number`

##### expression

[`BasicExpression`](../../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)

##### name

`string` | `undefined`

##### resolver

[`IndexResolver`](../../type-aliases/IndexResolver.md)\<`TKey`\>

##### options

`any`

##### collectionEntries?

`Iterable`\<\[`TKey`, `any`\], `any`, `any`\>

#### Returns

`LazyIndexWrapper`\<`TKey`\>

## Methods

### getExpression()

```ts
getExpression(): BasicExpression;
```

Defined in: [packages/db/src/indexes/lazy-index.ts:118](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/lazy-index.ts#L118)

Get the index expression

#### Returns

[`BasicExpression`](../../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)

***

### getId()

```ts
getId(): number;
```

Defined in: [packages/db/src/indexes/lazy-index.ts:104](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/lazy-index.ts#L104)

Get the index ID

#### Returns

`number`

***

### getName()

```ts
getName(): string | undefined;
```

Defined in: [packages/db/src/indexes/lazy-index.ts:111](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/lazy-index.ts#L111)

Get the index name

#### Returns

`string` \| `undefined`

***

### getResolved()

```ts
getResolved(): BaseIndex<TKey>;
```

Defined in: [packages/db/src/indexes/lazy-index.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/lazy-index.ts#L92)

Get resolved index (throws if not ready)

#### Returns

[`BaseIndex`](../BaseIndex.md)\<`TKey`\>

***

### isResolved()

```ts
isResolved(): boolean;
```

Defined in: [packages/db/src/indexes/lazy-index.ts:85](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/lazy-index.ts#L85)

Check if already resolved

#### Returns

`boolean`

***

### resolve()

```ts
resolve(): Promise<BaseIndex<TKey>>;
```

Defined in: [packages/db/src/indexes/lazy-index.ts:69](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/lazy-index.ts#L69)

Resolve the actual index

#### Returns

`Promise`\<[`BaseIndex`](../BaseIndex.md)\<`TKey`\>\>

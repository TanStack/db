---
id: CollectionLike
title: CollectionLike
---

# Interface: CollectionLike\<T, TKey\>

Defined in: [packages/db/src/types.ts:15](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L15)

Interface for a collection-like object that provides the necessary methods
for the change events system to work

## Extends

- `Pick`\<[`Collection`](Collection.md)\<`T`, `TKey`\>, `"get"` \| `"has"` \| `"entries"` \| `"indexes"` \| `"id"` \| `"compareOptions"`\>

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### compareOptions

```ts
compareOptions: StringCollationConfig;
```

Defined in: [packages/db/src/collection/index.ts:671](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L671)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`compareOptions`](../classes/CollectionImpl.md#compareoptions)

***

### id

```ts
id: string;
```

Defined in: [packages/db/src/collection/index.ts:280](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L280)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`id`](../classes/CollectionImpl.md#id)

***

### indexes

```ts
indexes: Map<number, BaseIndex<TKey>>;
```

Defined in: [packages/db/src/collection/index.ts:656](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L656)

#### Inherited from

```ts
Pick.indexes
```

## Methods

### entries()

```ts
entries(): IterableIterator<[TKey, WithVirtualProps<T, TKey>]>;
```

Defined in: [packages/db/src/collection/index.ts:547](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L547)

Get all entries (virtual derived state)

#### Returns

`IterableIterator`\<\[`TKey`, [`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`T`, `TKey`\>\]\>

#### Inherited from

```ts
Pick.entries
```

***

### get()

```ts
get(key): 
  | WithVirtualProps<T, TKey>
  | undefined;
```

Defined in: [packages/db/src/collection/index.ts:507](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L507)

Get the current value for a key (virtual derived state)

#### Parameters

##### key

`TKey`

#### Returns

  \| [`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`T`, `TKey`\>
  \| `undefined`

#### Inherited from

```ts
Pick.get
```

***

### has()

```ts
has(key): boolean;
```

Defined in: [packages/db/src/collection/index.ts:514](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L514)

Check if a key exists in the collection (virtual derived state)

#### Parameters

##### key

`TKey`

#### Returns

`boolean`

#### Inherited from

```ts
Pick.has
```

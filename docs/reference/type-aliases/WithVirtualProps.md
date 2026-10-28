---
id: WithVirtualProps
title: WithVirtualProps
---

```ts
type WithVirtualProps<T, TKey> = T & PublishedVirtualRowProps<TKey>;
```

Defined in: [packages/db/src/virtual-props.ts:157](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L157)

Adds virtual properties to a row type.

## Type Parameters

### T

`T` *extends* `object`

The base row type

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

The type of the row's key

## Example

```typescript
type User = { id: string; name: string }
type UserWithVirtual = WithVirtualProps<User, string>
// { id: string; name: string; $hasPendingWrites: boolean; $synced: boolean; $origin: 'local' | 'remote'; $key: string; $collectionId: string }
// $synced is deprecated; use !$hasPendingWrites instead.
```

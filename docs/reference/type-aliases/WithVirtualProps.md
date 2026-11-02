---
id: WithVirtualProps
title: WithVirtualProps
---

```ts
type WithVirtualProps<T, TKey> = T & VirtualRowProps<TKey>;
```

Defined in: [packages/db/src/virtual-props.ts:132](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L132)

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
// { id: string; name: string; $hasPendingWrites: boolean; $origin: 'local' | 'remote'; $key: string; $collectionId: string }
```

---
id: WithoutVirtualProps
title: WithoutVirtualProps
---

# Type Alias: WithoutVirtualProps\<T\>

```ts
type WithoutVirtualProps<T> = Omit<T, keyof VirtualRowProps>;
```

Defined in: [packages/db/src/virtual-props.ts:130](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L130)

Extracts the base type from a type that may have virtual properties.
Useful when you need to work with the raw data without virtual properties.

## Type Parameters

### T

`T`

The type that may include virtual properties

## Example

```typescript
type UserWithVirtual = { id: string; name: string; $synced: boolean; $origin: 'local' | 'remote' }
type User = WithoutVirtualProps<UserWithVirtual>
// { id: string; name: string }
```

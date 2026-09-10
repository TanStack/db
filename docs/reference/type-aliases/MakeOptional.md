---
id: MakeOptional
title: MakeOptional
---

# Type Alias: MakeOptional\<T, K\>

```ts
type MakeOptional<T, K> = Omit<T, K> & Partial<Pick<T, K>>;
```

Defined in: [packages/db/src/types.ts:1070](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1070)

## Type Parameters

### T

`T`

### K

`K` *extends* keyof `T`

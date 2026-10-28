---
id: MakeOptional
title: MakeOptional
---

```ts
type MakeOptional<T, K> = Omit<T, K> & Partial<Pick<T, K>>;
```

Defined in: [packages/db/src/types.ts:1411](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1411)

## Type Parameters

### T

`T`

### K

`K` *extends* keyof `T`

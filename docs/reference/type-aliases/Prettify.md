---
id: Prettify
title: Prettify
---

# Type Alias: Prettify\<T\>

```ts
type Prettify<T> = { [K in keyof T]: T[K] } & object;
```

Defined in: [packages/db/src/query/builder/types.ts:845](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L845)

Prettify - Utility type for clean IDE display

## Type Parameters

### T

`T`

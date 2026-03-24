---
id: Prettify
title: Prettify
---

# Type Alias: Prettify\<T\>

```ts
type Prettify<T> = { [K in keyof T]: T[K] } & object;
```

Defined in: [packages/db/src/query/builder/types.ts:859](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L859)

Prettify - Utility type for clean IDE display

## Type Parameters

### T

`T`

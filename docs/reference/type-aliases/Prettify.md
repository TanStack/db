---
id: Prettify
title: Prettify
---

```ts
type Prettify<T> = { [K in keyof T]: T[K] } & object;
```

Defined in: [packages/db/src/query/builder/types.ts:1378](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L1378)

Prettify - Utility type for clean IDE display

## Type Parameters

### T

`T`

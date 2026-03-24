---
id: SelectObject
title: SelectObject
---

# Type Alias: SelectObject\<T\>

```ts
type SelectObject<T> = T;
```

Defined in: [packages/db/src/query/builder/types.ts:188](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L188)

SelectObject - Wrapper type for select clause objects

This ensures that objects passed to `select()` have valid SelectValue types
for all their properties. It's a simple wrapper that provides better error
messages when invalid selections are attempted.

## Type Parameters

### T

`T` *extends* `SelectShape` = `SelectShape`

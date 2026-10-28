---
id: OperatorCallback
title: OperatorCallback
---

```ts
type OperatorCallback<TContext, TCallback> = 0 extends 1 & TContext ? (refs) => any : TCallback;
```

Defined in: [packages/db/src/query/builder/types.ts:662](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L662)

A callback that an operator value receives before the query supplies its
context. Without noImplicitAny, TypeScript skips that inference and the
context is `any`; the callback is then untyped, as other unannotated
callbacks are in that mode.

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

### TCallback

`TCallback`

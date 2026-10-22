---
id: InjectConditionalLiveQueryResult
title: InjectConditionalLiveQueryResult
---

```ts
type InjectConditionalLiveQueryResult<TContext> = Omit<InjectLiveQueryResult<TContext>, "data"> & object;
```

Defined in: [index.ts:74](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L74)

## Type Declaration

### data

```ts
data: Signal<InferConditionalResultType<TContext>>;
```

## Type Parameters

### TContext

`TContext` *extends* `Context`

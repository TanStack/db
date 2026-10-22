---
id: InjectConditionalLiveQueryResult
title: InjectConditionalLiveQueryResult
---

```ts
type InjectConditionalLiveQueryResult<TContext> = Omit<InjectLiveQueryResult<TContext>, "data"> & object;
```

Defined in: [index.ts:83](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L83)

## Type Declaration

### data

```ts
data: Signal<InferConditionalResultType<TContext>>;
```

## Type Parameters

### TContext

`TContext` *extends* `Context`

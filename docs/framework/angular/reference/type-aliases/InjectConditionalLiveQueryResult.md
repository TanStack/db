---
id: InjectConditionalLiveQueryResult
title: InjectConditionalLiveQueryResult
---

```ts
type InjectConditionalLiveQueryResult<TContext> = Omit<InjectLiveQueryResult<TContext>, "data"> & object;
```

Defined in: [angular-db/src/index.ts:76](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L76)

## Type Declaration

### data

```ts
data: Signal<InferConditionalResultType<TContext>>;
```

## Type Parameters

### TContext

`TContext` *extends* `Context`

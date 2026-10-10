---
id: EffectQueryInput
title: EffectQueryInput
---

```ts
type EffectQueryInput<TContext> = 
  | (q) => QueryBuilder<TContext>
| QueryBuilder<TContext>;
```

Defined in: [packages/db/src/query/effect.ts:90](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L90)

Query input - can be a builder function or a prebuilt query

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

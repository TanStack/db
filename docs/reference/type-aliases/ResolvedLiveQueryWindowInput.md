---
id: ResolvedLiveQueryWindowInput
title: ResolvedLiveQueryWindowInput
---

# Type Alias: ResolvedLiveQueryWindowInput\<TContext\>

```ts
type ResolvedLiveQueryWindowInput<TContext> =
  | {
  collection: Collection<any, any, any>;
  kind: "collection";
}
  | {
  kind: "query";
  query: QueryBuilder<TContext>;
};
```

Defined in: [packages/db/src/live-query-window-controller.ts:30](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L30)

**`Internal`**

The supported, enabled input forms for infinite-query adapters.

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

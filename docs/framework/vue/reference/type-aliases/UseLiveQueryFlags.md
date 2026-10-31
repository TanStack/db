---
id: UseLiveQueryFlags
title: UseLiveQueryFlags
---

```ts
type UseLiveQueryFlags = object & { [K in keyof LiveQueryStatusFlags]: ComputedRef<LiveQueryStatusFlags[K]> };
```

Defined in: [useLiveQuery.ts:59](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L59)

The status and flag refs every `useLiveQuery` result has.

## Type Declaration

### status

```ts
status: ComputedRef<CollectionStatus>;
```

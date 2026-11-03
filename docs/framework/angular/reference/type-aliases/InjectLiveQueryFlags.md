---
id: InjectLiveQueryFlags
title: InjectLiveQueryFlags
---

```ts
type InjectLiveQueryFlags = object & { [K in keyof LiveQueryStatusFlags]: Signal<LiveQueryStatusFlags[K]> };
```

Defined in: [angular-db/src/index.ts:43](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L43)

The status and flag signals every `injectLiveQuery` result has.

## Type Declaration

### status

```ts
status: Signal<CollectionStatus | "disabled">;
```

A signal containing the current status of the collection

---
id: PersistedReadinessSnapshot
title: PersistedReadinessSnapshot
---

```ts
type PersistedReadinessSnapshot = 
  | {
  error?: never;
  status: "loading";
}
  | {
  error?: never;
  status: "ready";
}
  | {
  error: unknown;
  status: "error";
};
```

Defined in: [packages/db/src/persisted-readiness.ts:2](https://github.com/TanStack/db/blob/main/packages/db/src/persisted-readiness.ts#L2)

The local-restore boundary of one opted-in persisted Collection.

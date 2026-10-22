---
id: convexOfflineMutation
title: convexOfflineMutation
---

```ts
function convexOfflineMutation<TMutation>(config): OfflineMutationFn;
```

Defined in: offline.ts:21

Use as a named mutationFn in startOfflineExecutor. The existing outbox owns
durability, restoration, leadership and retries. The server mutation must
atomically deduplicate idempotencyKey with its writes.

## Type Parameters

### TMutation

`TMutation` *extends* `FunctionReference`\<`"mutation"`\>

## Parameters

### config

`object` & `FunctionArgs`\<`TMutation`\> *extends* `object` ? `unknown` : `never`

## Returns

`OfflineMutationFn`

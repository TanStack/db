---
id: SyncConfigRes
title: SyncConfigRes
---

```ts
type SyncConfigRes = object;
```

Defined in: [packages/db/src/types.ts:417](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L417)

## Properties

### cleanup?

```ts
optional cleanup: CleanupFn;
```

Defined in: [packages/db/src/types.ts:418](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L418)

***

### loadSubset?

```ts
optional loadSubset: LoadSubsetFn;
```

Defined in: [packages/db/src/types.ts:419](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L419)

***

### restartAfterScopedRecovery()?

```ts
optional restartAfterScopedRecovery: (cacheRotated) => void | Promise<void>;
```

Defined in: [packages/db/src/types.ts:427](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L427)

Optional provider-controlled restart for a lost managed cache claim.
Retire old provider callbacks synchronously and start the replacement only
after `cacheRotated` fulfills; it rejects if scoped recovery fails. When
absent, the persistence wrapper cleans up and reenters `sync` itself.

#### Parameters

##### cacheRotated

`Promise`\<`void`\>

#### Returns

`void` \| `Promise`\<`void`\>

***

### unloadSubset?

```ts
optional unloadSubset: UnloadSubsetFn;
```

Defined in: [packages/db/src/types.ts:420](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L420)

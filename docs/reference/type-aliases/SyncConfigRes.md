---
id: SyncConfigRes
title: SyncConfigRes
---

```ts
type SyncConfigRes = object;
```

Defined in: [packages/db/src/types.ts:431](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L431)

## Properties

### cleanup?

```ts
optional cleanup: CleanupFn;
```

Defined in: [packages/db/src/types.ts:432](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L432)

***

### loadSubset?

```ts
optional loadSubset: LoadSubsetFn;
```

Defined in: [packages/db/src/types.ts:433](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L433)

***

### restartAfterScopedRecovery()?

```ts
optional restartAfterScopedRecovery: (cacheRotated) => void | Promise<void>;
```

Defined in: [packages/db/src/types.ts:441](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L441)

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

Defined in: [packages/db/src/types.ts:434](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L434)

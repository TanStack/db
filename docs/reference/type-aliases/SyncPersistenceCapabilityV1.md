---
id: SyncPersistenceCapabilityV1
title: SyncPersistenceCapabilityV1
---

```ts
type SyncPersistenceCapabilityV1<TKey> = object;
```

Defined in: [packages/db/src/types.ts:602](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L602)

**`Internal`**

Unstable cross-package protocol for persistence-aware adapters.

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### hydrateBaseline()

```ts
readonly hydrateBaseline: () => Promise<void>;
```

Defined in: [packages/db/src/types.ts:611](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L611)

#### Returns

`Promise`\<`void`\>

***

### managedCacheGeneration?

```ts
readonly optional managedCacheGeneration: boolean;
```

Defined in: [packages/db/src/types.ts:608](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L608)

This run owns a claimed on-demand cache generation.

***

### protocol

```ts
readonly protocol: "@tanstack/db/sync-persistence";
```

Defined in: [packages/db/src/types.ts:605](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L605)

***

### reserveCommitTurn()

```ts
readonly reserveCommitTurn: () => void;
```

Defined in: [packages/db/src/types.ts:634](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L634)

Reserve the open sync transaction's FIFO turn. Every persisted hydration
that would start before it commits waits for that commit: a subset load,
a reload or reset from a peer notice, and sequence-gap recovery. A subset
load admitted while the turn is reserved also runs after the commit's
durable write. The source must end the transaction: commit it, or abandon
it by committing with an aborted signal. An abandon releases the waiting
hydrations as a commit does, so they run. A peer reset abandons a
reserved transaction that began before the reset: its commit rejects
with `SyncTransactionAbortedError`, and the reset does not wait.
Sequence-gap recovery counts as a hydration only from the point where it
changes rows. A source that stops for good
abandons it, or every later hydration keeps waiting. The source must not
await a `hydrateBaseline` that it started before reserving while the
reservation is open: that baseline waits for the commit. Calling
`hydrateBaseline` while the reservation is open rejects.

#### Returns

`void`

***

### resumeSnapshot

```ts
readonly resumeSnapshot: object;
```

Defined in: [packages/db/src/types.ts:638](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L638)

#### certify()

```ts
readonly certify: () => Promise<void>;
```

##### Returns

`Promise`\<`void`\>

#### expectCurrentCommit()

```ts
readonly expectCurrentCommit: () => void;
```

##### Returns

`void`

#### expectSourceProgress()?

```ts
readonly optional expectSourceProgress: (progress) => void;
```

Atomically compare the durable source token with this transaction's
predecessor. The source stages its next opaque string token in collection
metadata at `key`. A discontinuity invalidates source progress evidence
until an authoritative truncate; rows and receipts still apply normally.
Re-delivering the same complete source position must be idempotent; it
preserves existing evidence, including an earlier incompatibility.
Only adapters that implement the durable comparison expose this method.

##### Parameters

###### progress

###### key

`string`

###### previous

`string` \| `undefined`

##### Returns

`void`

#### getKeySetEvidence()

```ts
readonly getKeySetEvidence: () => 
  | SyncPersistenceKeySetEvidence
  | undefined;
```

##### Returns

  \| [`SyncPersistenceKeySetEvidence`](SyncPersistenceKeySetEvidence.md)
  \| `undefined`

#### getSourceProgressCompatible()?

```ts
readonly optional getSourceProgressCompatible: () => boolean | undefined;
```

Source progress evidence from the atomic persisted resume snapshot.

##### Returns

`boolean` \| `undefined`

***

### scanPersistedRows()

```ts
readonly scanPersistedRows: (options?) => Promise<SyncPersistenceScannedRow<TKey>[]>;
```

Defined in: [packages/db/src/types.ts:635](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L635)

#### Parameters

##### options?

[`SyncPersistenceScanOptions`](SyncPersistenceScanOptions.md)

#### Returns

`Promise`\<[`SyncPersistenceScannedRow`](SyncPersistenceScannedRow.md)\<`TKey`\>[]\>

***

### startScopedRecovery()?

```ts
readonly optional startScopedRecovery: (resetMetadata?) => Promise<void>;
```

Defined in: [packages/db/src/types.ts:613](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L613)

Retire untrusted on-demand rows and retain the provider's reset metadata.

#### Parameters

##### resetMetadata?

###### key

`string`

###### value

`unknown`

#### Returns

`Promise`\<`void`\>

***

### startupCacheGenerationRotated?

```ts
readonly optional startupCacheGenerationRotated: boolean;
```

Defined in: [packages/db/src/types.ts:610](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L610)

The on-demand cache generation rotated before the source sync run entered.

***

### version

```ts
readonly version: 1;
```

Defined in: [packages/db/src/types.ts:606](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L606)

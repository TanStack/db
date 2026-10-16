---
id: SyncPersistenceCapabilityV1
title: SyncPersistenceCapabilityV1
---

```ts
type SyncPersistenceCapabilityV1<TKey> = object;
```

Defined in: [packages/db/src/types.ts:548](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L548)

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

Defined in: [packages/db/src/types.ts:557](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L557)

#### Returns

`Promise`\<`void`\>

***

### managedCacheGeneration?

```ts
readonly optional managedCacheGeneration: boolean;
```

Defined in: [packages/db/src/types.ts:554](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L554)

This run owns a claimed on-demand cache generation.

***

### protocol

```ts
readonly protocol: "@tanstack/db/sync-persistence";
```

Defined in: [packages/db/src/types.ts:551](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L551)

***

### reserveCommitTurn()

```ts
readonly reserveCommitTurn: () => void;
```

Defined in: [packages/db/src/types.ts:567](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L567)

Reserve the open sync transaction's FIFO turn, so a subset hydration
that starts before it commits waits for that commit.

#### Returns

`void`

***

### resumeSnapshot

```ts
readonly resumeSnapshot: object;
```

Defined in: [packages/db/src/types.ts:571](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L571)

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

#### getKeySetEvidence()

```ts
readonly getKeySetEvidence: () => 
  | SyncPersistenceKeySetEvidence
  | undefined;
```

##### Returns

  \| [`SyncPersistenceKeySetEvidence`](SyncPersistenceKeySetEvidence.md)
  \| `undefined`

***

### scanPersistedRows()

```ts
readonly scanPersistedRows: (options?) => Promise<SyncPersistenceScannedRow<TKey>[]>;
```

Defined in: [packages/db/src/types.ts:568](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L568)

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

Defined in: [packages/db/src/types.ts:559](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L559)

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

Defined in: [packages/db/src/types.ts:556](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L556)

The on-demand cache generation rotated before the source sync run entered.

***

### version

```ts
readonly version: 1;
```

Defined in: [packages/db/src/types.ts:552](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L552)

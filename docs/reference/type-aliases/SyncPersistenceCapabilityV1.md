---
id: SyncPersistenceCapabilityV1
title: SyncPersistenceCapabilityV1
---

```ts
type SyncPersistenceCapabilityV1<TKey> = object;
```

Defined in: [packages/db/src/types.ts:570](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L570)

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

Defined in: [packages/db/src/types.ts:579](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L579)

#### Returns

`Promise`\<`void`\>

***

### managedCacheGeneration?

```ts
readonly optional managedCacheGeneration: boolean;
```

Defined in: [packages/db/src/types.ts:576](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L576)

This run owns a claimed on-demand cache generation.

***

### protocol

```ts
readonly protocol: "@tanstack/db/sync-persistence";
```

Defined in: [packages/db/src/types.ts:573](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L573)

***

### reserveCommitTurn()

```ts
readonly reserveCommitTurn: () => void;
```

Defined in: [packages/db/src/types.ts:589](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L589)

Reserve the open sync transaction's FIFO turn, so a subset hydration
that starts before it commits waits for that commit.

#### Returns

`void`

***

### resumeSnapshot

```ts
readonly resumeSnapshot: object;
```

Defined in: [packages/db/src/types.ts:593](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L593)

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

Defined in: [packages/db/src/types.ts:590](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L590)

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

Defined in: [packages/db/src/types.ts:581](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L581)

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

Defined in: [packages/db/src/types.ts:578](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L578)

The on-demand cache generation rotated before the source sync run entered.

***

### version

```ts
readonly version: 1;
```

Defined in: [packages/db/src/types.ts:574](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L574)

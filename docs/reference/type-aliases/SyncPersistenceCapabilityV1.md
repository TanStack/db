---
id: SyncPersistenceCapabilityV1
title: SyncPersistenceCapabilityV1
---

```ts
type SyncPersistenceCapabilityV1<TKey> = object;
```

Defined in: [packages/db/src/types.ts:530](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L530)

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

Defined in: [packages/db/src/types.ts:535](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L535)

#### Returns

`Promise`\<`void`\>

***

### protocol

```ts
readonly protocol: "@tanstack/db/sync-persistence";
```

Defined in: [packages/db/src/types.ts:533](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L533)

***

### reserveCommitTurn()

```ts
readonly reserveCommitTurn: () => void;
```

Defined in: [packages/db/src/types.ts:540](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L540)

Reserve the open sync transaction's FIFO turn, so a subset hydration
that starts before it commits waits for that commit.

#### Returns

`void`

***

### resumeSnapshot

```ts
readonly resumeSnapshot: object;
```

Defined in: [packages/db/src/types.ts:544](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L544)

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

Defined in: [packages/db/src/types.ts:541](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L541)

#### Parameters

##### options?

[`SyncPersistenceScanOptions`](SyncPersistenceScanOptions.md)

#### Returns

`Promise`\<[`SyncPersistenceScannedRow`](SyncPersistenceScannedRow.md)\<`TKey`\>[]\>

***

### version

```ts
readonly version: 1;
```

Defined in: [packages/db/src/types.ts:534](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L534)

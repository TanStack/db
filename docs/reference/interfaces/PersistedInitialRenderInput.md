---
id: PersistedInitialRenderInput
title: PersistedInitialRenderInput
---

Defined in: [packages/db/src/persisted-readiness.ts:33](https://github.com/TanStack/db/blob/main/packages/db/src/persisted-readiness.ts#L33)

**`Internal`**

What a live query observer passes to the initial-render wait.

## Properties

### clientQuery

```ts
clientQuery: InitialRenderClientQuery | undefined;
```

Defined in: [packages/db/src/persisted-readiness.ts:41](https://github.com/TanStack/db/blob/main/packages/db/src/persisted-readiness.ts#L41)

The client query stream at the start of the wait, if any.

***

### collectionStatus()

```ts
collectionStatus: () => string | undefined;
```

Defined in: [packages/db/src/persisted-readiness.ts:45](https://github.com/TanStack/db/blob/main/packages/db/src/persisted-readiness.ts#L45)

The live query Collection's status now.

#### Returns

`string` \| `undefined`

***

### currentClientQuery()

```ts
currentClientQuery: () => unknown;
```

Defined in: [packages/db/src/persisted-readiness.ts:43](https://github.com/TanStack/db/blob/main/packages/db/src/persisted-readiness.ts#L43)

The client query stream now, for a failed stream's identity.

#### Returns

`unknown`

***

### network

```ts
network: Promise<void>;
```

Defined in: [packages/db/src/persisted-readiness.ts:39](https://github.com/TanStack/db/blob/main/packages/db/src/persisted-readiness.ts#L39)

The network preload that this render prefers.

***

### onReady()

```ts
onReady: () => void;
```

Defined in: [packages/db/src/persisted-readiness.ts:48](https://github.com/TanStack/db/blob/main/packages/db/src/persisted-readiness.ts#L48)

Runs once the render may proceed, before the promise resolves.

#### Returns

`void`

***

### readPersisted()

```ts
readPersisted: () => object;
```

Defined in: [packages/db/src/persisted-readiness.ts:46](https://github.com/TanStack/db/blob/main/packages/db/src/persisted-readiness.ts#L46)

#### Returns

`object`

##### error

```ts
error: unknown;
```

##### status

```ts
status: string;
```

***

### sources

```ts
sources: readonly object[];
```

Defined in: [packages/db/src/persisted-readiness.ts:34](https://github.com/TanStack/db/blob/main/packages/db/src/persisted-readiness.ts#L34)

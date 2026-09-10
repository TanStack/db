---
id: IndexDevModeConfig
title: IndexDevModeConfig
---

# Interface: IndexDevModeConfig

Defined in: [packages/db/src/indexes/index-registry.ts:15](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/index-registry.ts#L15)

## Properties

### collectionSizeThreshold

```ts
collectionSizeThreshold: number;
```

Defined in: [packages/db/src/indexes/index-registry.ts:19](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/index-registry.ts#L19)

Suggest indexes when collection has more than this many items

***

### enabled

```ts
enabled: boolean;
```

Defined in: [packages/db/src/indexes/index-registry.ts:17](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/index-registry.ts#L17)

Enable dev mode index suggestions

***

### onSuggestion

```ts
onSuggestion: (suggestion) => void | null;
```

Defined in: [packages/db/src/indexes/index-registry.ts:23](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/index-registry.ts#L23)

Custom handler for index suggestions

***

### slowQueryThresholdMs

```ts
slowQueryThresholdMs: number;
```

Defined in: [packages/db/src/indexes/index-registry.ts:21](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/index-registry.ts#L21)

Suggest indexes when queries take longer than this (ms)

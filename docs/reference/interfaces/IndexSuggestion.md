---
id: IndexSuggestion
title: IndexSuggestion
---

# Interface: IndexSuggestion

Defined in: [packages/db/src/indexes/index-registry.ts:26](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/index-registry.ts#L26)

## Properties

### collectionId

```ts
collectionId: string;
```

Defined in: [packages/db/src/indexes/index-registry.ts:28](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/index-registry.ts#L28)

***

### collectionSize?

```ts
optional collectionSize: number;
```

Defined in: [packages/db/src/indexes/index-registry.ts:31](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/index-registry.ts#L31)

***

### fieldPath

```ts
fieldPath: string[];
```

Defined in: [packages/db/src/indexes/index-registry.ts:29](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/index-registry.ts#L29)

***

### message

```ts
message: string;
```

Defined in: [packages/db/src/indexes/index-registry.ts:30](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/index-registry.ts#L30)

***

### queryCount?

```ts
optional queryCount: number;
```

Defined in: [packages/db/src/indexes/index-registry.ts:33](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/index-registry.ts#L33)

***

### queryTimeMs?

```ts
optional queryTimeMs: number;
```

Defined in: [packages/db/src/indexes/index-registry.ts:32](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/index-registry.ts#L32)

***

### type

```ts
type: "collection-size" | "slow-query" | "frequent-field";
```

Defined in: [packages/db/src/indexes/index-registry.ts:27](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/index-registry.ts#L27)

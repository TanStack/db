---
id: DbClientLiveQuery
title: DbClientLiveQuery
---

# Type Alias: DbClientLiveQuery

```ts
type DbClientLiveQuery = object;
```

Defined in: [packages/db/src/client.ts:136](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L136)

## Properties

### dehydratedAt

```ts
readonly dehydratedAt: number;
```

Defined in: [packages/db/src/client.ts:138](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L138)

***

### error?

```ts
readonly optional error: unknown;
```

Defined in: [packages/db/src/client.ts:142](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L142)

***

### promise

```ts
readonly promise: Promise<void>;
```

Defined in: [packages/db/src/client.ts:140](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L140)

***

### queryHash

```ts
readonly queryHash: string;
```

Defined in: [packages/db/src/client.ts:137](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L137)

***

### snapshot?

```ts
readonly optional snapshot: DehydratedLiveQueryResult;
```

Defined in: [packages/db/src/client.ts:141](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L141)

***

### status

```ts
readonly status: DbClientLiveQueryState;
```

Defined in: [packages/db/src/client.ts:139](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L139)

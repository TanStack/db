---
id: DbClientLiveQuery
title: DbClientLiveQuery
---

```ts
type DbClientLiveQuery = object;
```

Defined in: [packages/db/src/client.ts:159](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L159)

## Properties

### dehydratedAt

```ts
readonly dehydratedAt: number;
```

Defined in: [packages/db/src/client.ts:161](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L161)

***

### error?

```ts
readonly optional error: unknown;
```

Defined in: [packages/db/src/client.ts:165](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L165)

***

### promise

```ts
readonly promise: Promise<void>;
```

Defined in: [packages/db/src/client.ts:163](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L163)

***

### queryHash

```ts
readonly queryHash: string;
```

Defined in: [packages/db/src/client.ts:160](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L160)

***

### snapshot?

```ts
readonly optional snapshot: DehydratedLiveQueryResult;
```

Defined in: [packages/db/src/client.ts:164](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L164)

***

### status

```ts
readonly status: DbClientLiveQueryState;
```

Defined in: [packages/db/src/client.ts:162](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L162)

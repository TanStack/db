---
id: DbClientLiveQuery
title: DbClientLiveQuery
---

```ts
type DbClientLiveQuery = object;
```

Defined in: [packages/db/src/client.ts:173](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L173)

## Properties

### dehydratedAt

```ts
readonly dehydratedAt: number;
```

Defined in: [packages/db/src/client.ts:175](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L175)

***

### error?

```ts
readonly optional error: unknown;
```

Defined in: [packages/db/src/client.ts:181](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L181)

***

### initialSnapshot?

```ts
readonly optional initialSnapshot: DehydratedLiveQueryResult;
```

Defined in: [packages/db/src/client.ts:179](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L179)

Initial hydration view retained while a local preload completes.

***

### promise

```ts
readonly promise: Promise<void>;
```

Defined in: [packages/db/src/client.ts:177](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L177)

***

### queryHash

```ts
readonly queryHash: string;
```

Defined in: [packages/db/src/client.ts:174](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L174)

***

### snapshot?

```ts
readonly optional snapshot: DehydratedLiveQueryResult;
```

Defined in: [packages/db/src/client.ts:180](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L180)

***

### status

```ts
readonly status: DbClientLiveQueryState;
```

Defined in: [packages/db/src/client.ts:176](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L176)

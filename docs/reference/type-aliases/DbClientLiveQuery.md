---
id: DbClientLiveQuery
title: DbClientLiveQuery
---

```ts
type DbClientLiveQuery = object;
```

Defined in: [packages/db/src/client.ts:166](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L166)

## Properties

### dehydratedAt

```ts
readonly dehydratedAt: number;
```

Defined in: [packages/db/src/client.ts:168](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L168)

***

### error?

```ts
readonly optional error: unknown;
```

Defined in: [packages/db/src/client.ts:174](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L174)

***

### initialSnapshot?

```ts
readonly optional initialSnapshot: DehydratedLiveQueryResult;
```

Defined in: [packages/db/src/client.ts:172](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L172)

Initial hydration view retained while a local preload completes.

***

### promise

```ts
readonly promise: Promise<void>;
```

Defined in: [packages/db/src/client.ts:170](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L170)

***

### queryHash

```ts
readonly queryHash: string;
```

Defined in: [packages/db/src/client.ts:167](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L167)

***

### snapshot?

```ts
readonly optional snapshot: DehydratedLiveQueryResult;
```

Defined in: [packages/db/src/client.ts:173](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L173)

***

### status

```ts
readonly status: DbClientLiveQueryState;
```

Defined in: [packages/db/src/client.ts:169](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L169)

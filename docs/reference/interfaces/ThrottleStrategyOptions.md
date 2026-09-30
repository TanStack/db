---
id: ThrottleStrategyOptions
title: ThrottleStrategyOptions
---

Defined in: [packages/db/src/strategies/types.ts:78](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L78)

Options for throttle strategy
Ensures executions are evenly spaced over time

## Properties

### leading?

```ts
optional leading: boolean;
```

Defined in: [packages/db/src/strategies/types.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L82)

Execute immediately on the first call. Defaults to true unless trailing is explicitly true.

***

### trailing?

```ts
optional trailing: boolean;
```

Defined in: [packages/db/src/strategies/types.ts:84](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L84)

Execute on the last call after wait period. Defaults to true. Disabled trailing rejects skipped optimistic calls.

***

### wait

```ts
wait: number;
```

Defined in: [packages/db/src/strategies/types.ts:80](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L80)

Minimum wait time between executions (milliseconds)

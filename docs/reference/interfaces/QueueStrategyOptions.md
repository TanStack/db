---
id: QueueStrategyOptions
title: QueueStrategyOptions
---

Defined in: [packages/db/src/strategies/types.ts:57](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L57)

Options for queue strategy
Processes all executions in order (FIFO/LIFO)

## Properties

### addItemsTo?

```ts
optional addItemsTo: "front" | "back";
```

Defined in: [packages/db/src/strategies/types.ts:63](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L63)

Where to add new items in the queue

***

### getItemsFrom?

```ts
optional getItemsFrom: "front" | "back";
```

Defined in: [packages/db/src/strategies/types.ts:65](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L65)

Where to get items from when processing

***

### maxSize?

```ts
optional maxSize: number;
```

Defined in: [packages/db/src/strategies/types.ts:61](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L61)

Maximum waiting items. Overflow rejects its transaction; 0 rejects every mutation.

***

### wait?

```ts
optional wait: number;
```

Defined in: [packages/db/src/strategies/types.ts:59](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L59)

Wait time between processing queue items (milliseconds)

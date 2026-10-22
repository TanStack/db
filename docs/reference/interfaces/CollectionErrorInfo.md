---
id: CollectionErrorInfo
title: CollectionErrorInfo
---

Defined in: [packages/db/src/types.ts:789](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L789)

Detail about a Collection problem. Every field except `cause` is plain data,
so the value can be logged or sent as JSON; `cause` keeps the original value
and is omitted from JSON.

## Properties

### at

```ts
readonly at: number;
```

Defined in: [packages/db/src/types.ts:794](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L794)

Epoch milliseconds when the problem was reported.

***

### cause

```ts
readonly cause: unknown;
```

Defined in: [packages/db/src/types.ts:795](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L795)

***

### code?

```ts
readonly optional code: string;
```

Defined in: [packages/db/src/types.ts:792](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L792)

***

### message

```ts
readonly message: string;
```

Defined in: [packages/db/src/types.ts:791](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L791)

***

### name

```ts
readonly name: string;
```

Defined in: [packages/db/src/types.ts:790](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L790)

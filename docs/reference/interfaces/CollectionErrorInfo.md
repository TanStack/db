---
id: CollectionErrorInfo
title: CollectionErrorInfo
---

Defined in: [packages/db/src/types.ts:794](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L794)

Detail about a Collection problem. Every field except `cause` is plain data,
so the value can be logged or sent as JSON; `cause` keeps the original value
and is omitted from JSON.

## Properties

### at

```ts
readonly at: number;
```

Defined in: [packages/db/src/types.ts:799](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L799)

Epoch milliseconds when the problem was reported.

***

### cause

```ts
readonly cause: unknown;
```

Defined in: [packages/db/src/types.ts:800](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L800)

***

### code?

```ts
readonly optional code: string;
```

Defined in: [packages/db/src/types.ts:797](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L797)

***

### message

```ts
readonly message: string;
```

Defined in: [packages/db/src/types.ts:796](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L796)

***

### name

```ts
readonly name: string;
```

Defined in: [packages/db/src/types.ts:795](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L795)

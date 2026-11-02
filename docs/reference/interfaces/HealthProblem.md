---
id: HealthProblem
title: HealthProblem
---

Defined in: [packages/db/src/types.ts:842](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L842)

A problem on a health node. Its own fields are its newest failure's, and
`errors` lists every failure of its frame that is still open, oldest
first; the last entry is the newest. A source's `failureReason` lists each
`reportError()` of the sync run since the problem began, once per error
value; `reportHealthy(error)` removes that value's failure, and
`reportHealthy()` ends it. An `error` from `fail()`, a failed first load, or a crash is one
failure. A query's request error lists every request failure still open
on its node, once per error value, and a failed replay adds each load it
failed for.

## Extends

- [`CollectionErrorInfo`](CollectionErrorInfo.md)

## Properties

### at

```ts
readonly at: number;
```

Defined in: [packages/db/src/types.ts:827](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L827)

Epoch milliseconds when the problem was reported.

#### Inherited from

[`CollectionErrorInfo`](CollectionErrorInfo.md).[`at`](CollectionErrorInfo.md#at)

***

### cause

```ts
readonly cause: unknown;
```

Defined in: [packages/db/src/types.ts:828](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L828)

#### Inherited from

[`CollectionErrorInfo`](CollectionErrorInfo.md).[`cause`](CollectionErrorInfo.md#cause)

***

### code?

```ts
readonly optional code: string;
```

Defined in: [packages/db/src/types.ts:825](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L825)

#### Inherited from

[`CollectionErrorInfo`](CollectionErrorInfo.md).[`code`](CollectionErrorInfo.md#code)

***

### errors

```ts
readonly errors: readonly CollectionErrorInfo[];
```

Defined in: [packages/db/src/types.ts:843](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L843)

***

### message

```ts
readonly message: string;
```

Defined in: [packages/db/src/types.ts:824](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L824)

#### Inherited from

[`CollectionErrorInfo`](CollectionErrorInfo.md).[`message`](CollectionErrorInfo.md#message)

***

### name

```ts
readonly name: string;
```

Defined in: [packages/db/src/types.ts:823](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L823)

#### Inherited from

[`CollectionErrorInfo`](CollectionErrorInfo.md).[`name`](CollectionErrorInfo.md#name)

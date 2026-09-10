---
id: safeRandomUUID
title: safeRandomUUID
---

# Function: safeRandomUUID()

```ts
function safeRandomUUID(): string;
```

Defined in: [packages/db/src/utils/uuid.ts:11](https://github.com/TanStack/db/blob/main/packages/db/src/utils/uuid.ts#L11)

Returns a RFC 4122 version 4 UUID.

Prefers `crypto.randomUUID()` when available. In non-secure browser contexts
(e.g. a dev server accessed via a LAN IP over HTTP) `crypto.randomUUID` is
`undefined`, so this falls back to building a UUIDv4 from
`crypto.getRandomValues`. Throws if neither API is available.

See https://github.com/TanStack/db/issues/1541.

## Returns

`string`

---
id: warnOnce
title: warnOnce
---

```ts
function warnOnce(key, message): void;
```

Defined in: [packages/db/src/utils.ts:313](https://github.com/TanStack/db/blob/main/packages/db/src/utils.ts#L313)

**`Internal`**

Log a warning message only once per unique key.
Subsequent calls with the same key will be silently ignored.

 Used by first-party collection adapters.

## Parameters

### key

`string`

Unique identifier for this warning

### message

`string`

The warning message to display

## Returns

`void`

## Example

```typescript
// First call logs the warning
warnOnce('deprecated-api', 'This API is deprecated')

// Subsequent calls with same key are ignored
warnOnce('deprecated-api', 'This API is deprecated') // silent
```

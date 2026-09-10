---
id: compareLiveQueryWindowDependencies
title: compareLiveQueryWindowDependencies
---

# Function: compareLiveQueryWindowDependencies()

```ts
function compareLiveQueryWindowDependencies(previous, current): object;
```

Defined in: [packages/db/src/live-query-window-controller.ts:432](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L432)

**`Internal`**

Compare adapter dependencies by identity and structure.

## Parameters

### previous

readonly `unknown`[] | `null` | `undefined`

### current

readonly `unknown`[]

## Returns

`object`

### changed

```ts
changed: boolean;
```

### structurallyEqual

```ts
structurallyEqual: boolean;
```

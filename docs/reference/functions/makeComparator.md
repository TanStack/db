---
id: makeComparator
title: makeComparator
---

```ts
function makeComparator(opts, scope): (a, b) => number;
```

Defined in: [packages/db/src/utils/comparison.ts:141](https://github.com/TanStack/db/blob/main/packages/db/src/utils/comparison.ts#L141)

**`Internal`**

Used by first-party collection adapters.

## Parameters

### opts

`CompareOptions`

### scope

`"values"` | `"index"`

## Returns

```ts
(a, b): number;
```

### Parameters

#### a

`any`

#### b

`any`

### Returns

`number`

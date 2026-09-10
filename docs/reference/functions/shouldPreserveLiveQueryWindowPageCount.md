---
id: shouldPreserveLiveQueryWindowPageCount
title: shouldPreserveLiveQueryWindowPageCount
---

# Function: shouldPreserveLiveQueryWindowPageCount()

```ts
function shouldPreserveLiveQueryWindowPageCount(options): boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:448](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L448)

**`Internal`**

Shared page-depth preservation policy for framework adapters.

## Parameters

### options

#### dependenciesChanged

`boolean`

#### dependenciesStructurallyEqual

`boolean`

#### hasPreviousController

`boolean`

#### inputKind

`"collection"` \| `"query"`

#### pageShapeChanged

`boolean`

#### previousInputKind

`"collection"` \| `"query"` \| `undefined`

#### sameCollection

`boolean`

## Returns

`boolean`

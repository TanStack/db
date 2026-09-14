---
id: LiveQueryWindowCollection
title: LiveQueryWindowCollection
---

# Type Alias: LiveQueryWindowCollection

```ts
type LiveQueryWindowCollection = Collection<any, any, any> & object;
```

Defined in: [packages/db/src/live-query-window-controller.ts:109](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L109)

**`Internal`**

Shared adapter view of a collection with an ordered window.

## Type Declaration

### utils

```ts
utils: object;
```

#### utils.getWindow()

```ts
getWindow: () => LiveQueryWindow | undefined;
```

##### Returns

`LiveQueryWindow` \| `undefined`

#### utils.setWindow()

```ts
setWindow: (options) => WindowResult;
```

##### Parameters

###### options

`LiveQueryWindow`

##### Returns

`WindowResult`

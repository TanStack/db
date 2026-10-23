---
id: LiveQueryWindowCollection
title: LiveQueryWindowCollection
---

```ts
type LiveQueryWindowCollection = Collection<any, any, any> & object;
```

Defined in: [packages/db/src/live-query-window-controller.ts:132](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L132)

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

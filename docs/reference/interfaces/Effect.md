---
id: Effect
title: Effect
---

# Interface: Effect

Defined in: [packages/db/src/query/effect.ts:142](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L142)

Handle returned by createEffect

## Properties

### dispose()

```ts
dispose: () => Promise<void>;
```

Defined in: [packages/db/src/query/effect.ts:144](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L144)

Dispose the effect. Returns a promise that resolves when in-flight handlers complete.

#### Returns

`Promise`\<`void`\>

***

### disposed

```ts
readonly disposed: boolean;
```

Defined in: [packages/db/src/query/effect.ts:146](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L146)

Whether this effect has been disposed

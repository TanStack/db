---
id: Effect
title: Effect
---

# Interface: Effect

Defined in: [packages/db/src/query/effect.ts:134](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L134)

Handle returned by createEffect

## Properties

### dispose()

```ts
dispose: () => Promise<void>;
```

Defined in: [packages/db/src/query/effect.ts:136](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L136)

Dispose the effect. Returns a promise that resolves when in-flight handlers complete.

#### Returns

`Promise`\<`void`\>

***

### disposed

```ts
readonly disposed: boolean;
```

Defined in: [packages/db/src/query/effect.ts:138](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L138)

Whether this effect has been disposed

---
id: Effect
title: Effect
---

Defined in: [packages/db/src/query/effect.ts:164](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L164)

Handle returned by createEffect

## Properties

### dispose()

```ts
dispose: () => Promise<void>;
```

Defined in: [packages/db/src/query/effect.ts:169](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L169)

Dispose the effect and await in-flight handlers. Calls during one cleanup
attempt, including calls from abort/release callbacks, share its outcome.

#### Returns

`Promise`\<`void`\>

***

### disposed

```ts
readonly disposed: boolean;
```

Defined in: [packages/db/src/query/effect.ts:171](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L171)

Whether this effect has been disposed

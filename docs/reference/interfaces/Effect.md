---
id: Effect
title: Effect
---

Defined in: [packages/db/src/query/effect.ts:148](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L148)

Handle returned by createEffect

## Properties

### dispose()

```ts
dispose: () => Promise<void>;
```

Defined in: [packages/db/src/query/effect.ts:153](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L153)

Dispose the effect and await in-flight handlers. Calls during one cleanup
attempt, including calls from abort/release callbacks, share its outcome.

#### Returns

`Promise`\<`void`\>

***

### disposed

```ts
readonly disposed: boolean;
```

Defined in: [packages/db/src/query/effect.ts:155](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L155)

Whether this effect has been disposed

---
id: Effect
title: Effect
---

Defined in: [packages/db/src/query/effect.ts:149](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L149)

Handle returned by createEffect

## Properties

### dispose()

```ts
dispose: () => Promise<void>;
```

Defined in: [packages/db/src/query/effect.ts:154](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L154)

Dispose the effect and await in-flight handlers. Calls during one cleanup
attempt, including calls from abort/release callbacks, share its outcome.

#### Returns

`Promise`\<`void`\>

***

### disposed

```ts
readonly disposed: boolean;
```

Defined in: [packages/db/src/query/effect.ts:156](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L156)

Whether this effect has been disposed

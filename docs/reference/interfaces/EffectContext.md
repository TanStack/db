---
id: EffectContext
title: EffectContext
---

Defined in: [packages/db/src/query/effect.ts:81](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L81)

Context passed to effect handlers

## Properties

### effectId

```ts
effectId: string;
```

Defined in: [packages/db/src/query/effect.ts:83](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L83)

ID of this effect (auto-generated if not provided)

***

### signal

```ts
signal: AbortSignal;
```

Defined in: [packages/db/src/query/effect.ts:85](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L85)

Aborted when effect.dispose() is called

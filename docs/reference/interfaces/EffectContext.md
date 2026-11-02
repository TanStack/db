---
id: EffectContext
title: EffectContext
---

Defined in: [packages/db/src/query/effect.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L88)

Context passed to effect handlers

## Properties

### effectId

```ts
effectId: string;
```

Defined in: [packages/db/src/query/effect.ts:90](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L90)

ID of this effect (auto-generated if not provided)

***

### signal

```ts
signal: AbortSignal;
```

Defined in: [packages/db/src/query/effect.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L92)

Aborted when effect.dispose() is called

---
id: EffectContext
title: EffectContext
---

# Interface: EffectContext

Defined in: [packages/db/src/query/effect.ts:75](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L75)

Context passed to effect handlers

## Properties

### effectId

```ts
effectId: string;
```

Defined in: [packages/db/src/query/effect.ts:77](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L77)

ID of this effect (auto-generated if not provided)

***

### signal

```ts
signal: AbortSignal;
```

Defined in: [packages/db/src/query/effect.ts:79](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L79)

Aborted when effect.dispose() is called

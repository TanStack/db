---
id: EffectContext
title: EffectContext
---

Defined in: [packages/db/src/query/effect.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L82)

Context passed to effect handlers

## Properties

### effectId

```ts
effectId: string;
```

Defined in: [packages/db/src/query/effect.ts:84](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L84)

ID of this effect (auto-generated if not provided)

***

### signal

```ts
signal: AbortSignal;
```

Defined in: [packages/db/src/query/effect.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L86)

Aborted when effect.dispose() is called

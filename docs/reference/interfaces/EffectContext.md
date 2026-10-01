---
id: EffectContext
title: EffectContext
---

Defined in: [packages/db/src/query/effect.ts:80](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L80)

Context passed to effect handlers

## Properties

### effectId

```ts
effectId: string;
```

Defined in: [packages/db/src/query/effect.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L82)

ID of this effect (auto-generated if not provided)

***

### signal

```ts
signal: AbortSignal;
```

Defined in: [packages/db/src/query/effect.ts:84](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L84)

Aborted when effect.dispose() is called

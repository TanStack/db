---
id: EffectContext
title: EffectContext
---

# Interface: EffectContext

Defined in: [packages/db/src/query/effect.ts:67](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L67)

Context passed to effect handlers

## Properties

### effectId

```ts
effectId: string;
```

Defined in: [packages/db/src/query/effect.ts:69](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L69)

ID of this effect (auto-generated if not provided)

***

### signal

```ts
signal: AbortSignal;
```

Defined in: [packages/db/src/query/effect.ts:71](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L71)

Aborted when effect.dispose() is called

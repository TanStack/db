---
id: EffectContext
title: EffectContext
---

Defined in: [packages/db/src/query/effect.ts:87](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L87)

Context passed to effect handlers

## Properties

### effectId

```ts
effectId: string;
```

Defined in: [packages/db/src/query/effect.ts:89](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L89)

ID of this effect (auto-generated if not provided)

***

### signal

```ts
signal: AbortSignal;
```

Defined in: [packages/db/src/query/effect.ts:91](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L91)

Aborted when effect.dispose() is called

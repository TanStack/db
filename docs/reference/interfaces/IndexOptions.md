---
id: IndexOptions
title: IndexOptions
---

# Interface: IndexOptions\<TResolver\>

Defined in: packages/db/src/indexes/index-options.ts:6

Enhanced index options that support both sync and async resolvers

## Type Parameters

### TResolver

`TResolver` *extends* [`IndexResolver`](../type-aliases/IndexResolver.md) = [`IndexResolver`](../type-aliases/IndexResolver.md)

## Properties

### indexType?

```ts
optional indexType: TResolver;
```

Defined in: packages/db/src/indexes/index-options.ts:8

***

### name?

```ts
optional name: string;
```

Defined in: packages/db/src/indexes/index-options.ts:7

***

### options?

```ts
optional options: TResolver extends IndexConstructor<any> ? TResolver<TResolver> extends (id, expr, name?, options?) => any ? O : never : TResolver extends () => Promise<TCtor> ? TCtor extends (id, expr, name?, options?) => any ? O : never : never;
```

Defined in: packages/db/src/indexes/index-options.ts:9

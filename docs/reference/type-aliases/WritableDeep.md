---
id: WritableDeep
title: WritableDeep
---

# Type Alias: WritableDeep\<T\>

```ts
type WritableDeep<T> = T extends BuiltIns ? T : T extends (...arguments_) => unknown ? object extends WritableObjectDeep<T> ? T : HasMultipleCallSignatures<T> extends true ? T : (...arguments_) => ReturnType<T> & WritableObjectDeep<T> : T extends ReadonlyMap<unknown, unknown> ? WritableMapDeep<T> : T extends ReadonlySet<unknown> ? WritableSetDeep<T> : T extends ReadonlyArray<unknown> ? WritableArrayDeep<T> : T extends object ? WritableObjectDeep<T> : unknown;
```

Defined in: packages/db/src/types.ts:777

## Type Parameters

### T

`T`

---
id: StringCollationConfig
title: StringCollationConfig
---

```ts
type StringCollationConfig = 
  | {
  stringSort?: "lexical";
}
  | {
  locale?: string;
  localeOptions?: object;
  stringSort?: "locale";
}
  | {
  compare: (a: string, b: string) => number;
  stringSort: "custom";
};
```

Defined in: [packages/db/src/types.ts:32](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L32)

StringCollationConfig - Options for string sorting behavior

This discriminated union allows for three types of string sorting:
- **Lexical**: Simple character-by-character comparison
- **Locale**: Locale-aware sorting with optional customization
- **Custom**: Local comparison by a stable user-provided function reference

Custom comparators must remain deterministic and immutable for their lifetime.
Runtime query and index identity uses the exact function reference.

---
id: StringCollationConfig
title: StringCollationConfig
---

# Type Alias: StringCollationConfig

```ts
type StringCollationConfig = 
  | {
  stringSort?: "lexical";
}
  | {
  locale?: string;
  localeOptions?: object;
  stringSort?: "locale";
};
```

Defined in: packages/db/src/types.ts:30

StringSortOpts - Options for string sorting behavior

This discriminated union allows for two types of string sorting:
- **Lexical**: Simple character-by-character comparison (default)
- **Locale**: Locale-aware sorting with optional customization

The union ensures that locale options are only available when locale sorting is selected.

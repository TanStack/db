---
'@tanstack/db': patch
---

Compare strings under locale collation with one `Intl.Collator` per compare-options object instead of calling `localeCompare` for each comparison. The order is unchanged. Building a collator on every comparison was slow on Hermes for Android, where each one is a Java object.

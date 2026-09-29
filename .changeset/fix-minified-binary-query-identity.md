---
'@tanstack/db': patch
---

Keep typed-array query and subset demand identities stable when applications minify class names. Read intrinsic view bytes even when a subclass overrides byte accessors or iteration, and preserve equality distinctions for changed public lengths. Keep recognized Buffer copies hashable across implementations, while rejecting a Buffer whose shadowed length changes conversion. Keep views with custom conversion distinct when their ordering behavior differs. Keep built-in index resolver names stable in public metadata and index events across minified builds.

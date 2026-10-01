---
'@tanstack/db': patch
---

Simplify the mutation draft proxy and share one equality walker with `deepEquals`. A typical app bundle is about 350 B smaller with gzip.

This change also fixes draft writes that were lost or wrong:

- A function stored in a row is now returned as stored when read from a draft. Before, the draft returned a bound copy, so `draft.handler === handler` was false. A stored method also saw a private copy as `this`, so `collection.update` dropped the writes it made through `this`.
- Array methods such as `at`, `slice`, `concat`, `flat`, `toReversed`, and `with` now return drafts, so a write through their result is saved. `indexOf` and `includes` find an element that the draft returned, and `draft.items.constructor === Array` is true.
- `Object.defineProperty(draft, key, { value })` no longer throws when the descriptor does not set `writable` or `configurable`. Defining a getter on a draft is now a change.
- `fill`, `set`, `sort`, `reverse`, and `copyWithin` on a typed array in a draft, and writes through its `subarray`, are now saved.
- Deleting a nested key that the callback added, or writing a nested value back, no longer leaves the parent marked as changed.
- A typed-array subclass whose constructor does not forward its argument is now copied with its elements. Typed arrays that hold `NaN` now equal themselves.

`deepEquals` and draft change detection also have new rules:

- Instances of two different classes are not equal. A plain or null-prototype object compares by keys with any class.
- A class instance without enumerable keys, such as a `File` or an object whose state is in private fields, equals only itself. Before, two such instances were always equal, so a draft dropped a write that replaced one.
- URLs compare by `href`.
- In draft change detection only, a typed array of another class is a change.

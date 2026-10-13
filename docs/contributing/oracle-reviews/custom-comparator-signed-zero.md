# Signed zero under a custom index comparator

The direct IndexInterface contract permits a numeric custom comparator.
JavaScript `Map` equality treats `-0` and `+0` as one exact lookup class, while
a callback can distinguish their order. For this PR, the maintainer chose
per-row callback order inside a query-equality class. The index refinement
oracle supplies independent rank labels for `-0`, `+0`, and `1`, then checks
exact lookup, full ordered take, a bounded range, and a cursor after `add` or
`build`. It removes the negative row and checks the surviving class and order.

The unmodified BasicIndex ordered-bucket `Map` used SameValueZero keys for the
callback positions. Both new add/build histories returned `positive` twice
and omitted `negative` at `takeFromStart`; BTreeIndex passed both controls.
BasicIndex now encodes negative zero separately for its private ordered-bucket
key, while exact membership keeps the ordinary `Map` key. All four new
histories and the full 416-test index refinement owner pass with no type errors.
The independent rank model is supplied by the fixture, not copied from either
index. This fixed witness covers only the stated signed-zero callback and
direct operations; arbitrary callbacks, longer histories, public order
selection, and provider paths remain separate.

## Exact-commit hostile review

Pending fresh review of the committed oracle and production paths.

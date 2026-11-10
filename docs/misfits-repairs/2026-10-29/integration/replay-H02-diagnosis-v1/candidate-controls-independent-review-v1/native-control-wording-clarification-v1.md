# Native and controlled binding clarification

This additive correction narrows one sentence in
`baseline-vs-candidate-gates-v1.md`: “native real-helper receiving and controlled
completion receiving need distinct cut languages” is stronger than necessary.

The drivers may share the same legal program grammar, semantic cut union, model
and comparison. Their control semantics must differ: a native driver observes
actual real-helper enqueue/return/answer/dispatch boundaries and waits for native
dispatch; it does not hold or manually dispatch that queue. The controlled driver
may deliberately retain and dispatch its module-controlled queue for exact
failure/completion cuts. A delegating observer still needs exact source review
and actual real-helper execution evidence. Shared recipe names alone establish
neither mode's physical binding.

The earlier common-grammar challenge remains a binding prerequisite, not a
claim that native recipes are impossible or that the union must be split.
Nothing changes the accepted V4 baseline evidence, candidate UNREACHED status,
source acceptance gate, invocation limits, or current absence of implementation.

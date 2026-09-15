# Mutation failure and committed state

The check succeeds when it correctly observes a **failed mutation**. The original
boundary tests showed rejected handlers skipping reconciliation and the client
losing a committed row when retiring optimism. The repair separated handler
outcome from reconciliation outcome. Named boundary tests then passed; a later
browser/PG campaign recorded post-commit error witnesses.

This is a recorded boundary-test repair followed by broader evidence. It is not
a claim that the E2E generator originally found this bug.

## Evidence process

Capture the counterexample → identify the incorrect rollback assumption → change
the protocol/settlement implementation → check the original boundary law and
the browser path → report each result with its own scope.

The two checks share repaired code as a prerequisite. Neither consumes the
other's result. Their order can be exchanged in the model, though that proposed
independence is not a new scheduling experiment.

The countermodel allowed a passing boundary test to produce the broader browser
claim. Requiring the separate browser witness excludes that path. A note after
the failure also cannot stand in for repair or passing evidence. Full replay of
the documented aggregate history survives that correction.

At the application level, the PG test commits one insert and then hits a duplicate
key on another. Reconciliation returns the committed row and preserves the handler
error without repeating the mutation. No transaction wrapper, retry of writes,
or recovery connection to existing clients is inferred from these results.

## Bounds

The old E2E report records an aggregate post-commit witness, not each original
generated trace and replay identity. Named boundary laws are retained, but that
is not an exact browser-counterexample replay. Future evidence should retain the
observations appropriate to its claim; this study does not manufacture missing
historical detail. No current production behavior was retested.

Sources: C0–C5 and R in [source captures](../sources.json). Full [model and
prerequisites](model.json); [replay](replay.json).

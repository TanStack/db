# Exploratory design grammar: accepted and visible settlement

This is a separate, versioned **v1** grammar for the receipt boundary during
on-demand scoped recovery. Its source is Git
`d3d617273318573df9e15287d704dc1853a67337`. The executable
[TLA+ model](ReceiptSettlement.tla) and the [Model](model.md),
[Evidence](evidence.md), and [Process](process.md) layers preserve the rules,
checks, and limits. The preservation preview is provisional; this is not a
user-confirmed exact-equivalence model.

## What this tells us

Acceptance and visibility are separate events. An ordinary sync transaction
can be accepted while an optimistic transaction is persisting, yet its applied
receipt stays pending until its rows become visible. The scoped-recovery
truncate has a different rule: core applies it immediately, together with
earlier accepted work. That immediate application releases recovery even if
its caller is an optimistic handler.

The proposed startup cycle requires **two** weakened rules together: hold the
truncate behind the optimistic transaction _and_ make recovery wait for its
visibility. TLC reaches a state where recovery cannot finish and the handler
cannot return. Waiting for visibility alone does not create that cycle while
the truncate still applies immediately. The model also shows why subset
success needs a different gate: a later ordinary fresh write may be accepted
but still invisible, so a demand cannot succeed on acceptance alone.

## What it changes

- The safe model checked all **30 distinct** states in its bounded optimistic
  history without a safety violation. The no-optimistic and visibility-gated
  neighbors also passed. Seven fault configurations produced their intended
  invariant failures.
- A separate reachability check found the documented self-wait: an optimistic
  handler that awaits its own subset demand can hold that demand's accepted
  source write. This is a limit of the caller's wait, not evidence of a new
  scoped-recovery bug.
- The mixed-order production oracle added alongside this work passed its full
  65-test file. A temporary SQLite mutant that let an expired run advance the
  shared cache head failed at the new head comparison and was removed. This
  calibrates cache authority; it is not a production validation of the receipt
  model.

## What it does not tell us

The receipt model has one optimistic transaction, one prior sync write, one
truncate, and one fresh demanded write. It does not model receipt rejection,
abort, multiple optimistic handlers, SQLite durability, provider delivery,
public event batches, or fairness. Its green result establishes safety only
for its encoded finite histories; it does not prove eventual demand settlement
or a live-service schedule. The controlled source in the new SQLite oracle
invokes scoped recovery directly. Electric's invalid-resume classification
followed by the same held-expiry order remains a separate receiving witness
in the [coverage map](../../docs/contributing/oracle-coverage.md).

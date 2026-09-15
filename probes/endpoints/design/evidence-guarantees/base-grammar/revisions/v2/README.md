# Evidence grammar v2: argument routes and applicable repair

This is the user-authorized repair of the [v1 exploratory grammar](../../README.md)
after [Fracture Scan and Hostile Assay](../../../base-stress/README.md). It is a
versioned repair specification, not a claim that those instruments or the full
Design Grammar were rerun after the changes. The original frozen artifacts remain
unchanged.

The six candidate building blocks remain. Three relationships are now explicit:

1. **An explanation retains its argument routes.** Routes are alternatives; each
   route's premises are jointly required. Shared claims can still appear once in
   a task inventory, but that inventory cannot replace the route structure.
2. **A resolution has history and current applicability.** Linking a replay to a
   challenge does not make the replay permanently authoritative. With the current
   coarse epoch model, an epoch change expires every replay from the old epoch.
   The failure remains in history and needs a current replay to clear it again.
3. **Replay requires an execution relation.** The prototype admits only a separate
   check invoked after the failure was recorded. At invocation the runner captures
   the last committed observation. A pass from an earlier or same-batch check
   cannot become a replay merely by arriving later. The trusted checker must
   execute fresh measurements; cached returns are not replay evidence.

These choices fix the bounded prototype. They do not settle richer scope matching,
durable repair certificates, distributed execution clocks or selective invalidation.
Rejecting same-run repair and expiring all resolutions on a context advance are
conservative prototype rules, not claims that more permissive designs are impossible.

The public assessment now exposes nested `routes` and structured challenge IDs.
Its flat `gaps` array remains an inventory; top-level observation/rule lists name
one successful route's support. The full route report preserves alternatives.
Rejected submitted arguments are distinct from routes awaiting premise support.

The new oracles failed on v1 and passed after repair. They check completion sets
described by explanations, resolution lifetime across epochs and reordered run
delivery. The old scalar failure model was repaired to retain historical
obligations. Seven code mutations—including removal of each new protection—are
detected by unchanged tests. These bounded tests do not prove arbitrary rule code
sound or validate the base against an independent application.

- [Model](model.json): revised relationships and rules, with v1 ancestry.
- [Evidence](evidence.json): red/green outcomes and test-law changes.
- [Process](process.json): repair scope and unchanged controls.
- [Freeze manifest](freeze.json).
- [Prototype and run commands](../../../../../../evidence-base/README.md).

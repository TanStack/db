# Root omission launch corrections: inactive successor

This minimal additive successor addresses only OMIT-SOURCE-F01 and
OMIT-SOURCE-F02 from the independent v1 source review. V1, the source review,
and both author/reviewer diagnostics remain unchanged.

F01: the exact outer invocation now uses the same pinned Python executable
with `-I -S -B`. The binding names those flags. The launcher text is byte-exact
v1; no checker, test, config, trace, model, source freeze or native argument
changes. Actual dispatch of the exact command remains root's responsibility.

F02: the proposed actual exec_command metadata now requires
`sandbox_permissions=require_escalated` and includes its justification. Text
metadata is not proof of actual execution mode; only a later exact root tool
call can satisfy that condition. No runtime admission is made here.

The launcher reads this successor's binding. Its materialized source/config/
manifest members refer to the same immutable v1 inert files by absolute path.
Their bytes and proposed output names are unchanged. The existing proposed
run-v1 workspace is still absent, so no new run namespace is necessary.

All checker composition, one-property mutation footprint, first-divergence
classification, healthy control, receiving/production-mutant/closure limits,
resource bounds and root-owned lifecycle/lint/admission remain exactly as v1.
No startup census, new hostile case, framework stage, source successor, runtime,
import, compiler, materialization, process probe, install, Git/PR or canonical
action was added. Root delta review and separate exact one-shot admission are
the next steps.

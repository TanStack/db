# H02 v4: binding PASS, pre-premise receipt I/O failure

The single accepted v4 canonical launch ran one receiving history and exited1.
The outer suite selected1 test, failed1, and skipped3. The receiving suite
selected1 and failed1. Actual source provenance passed:318 binding entries,
0 failures. The separate bound-provenance-v1.json preserves that result.

The driver reached initial-publication and reload-start. Synchronous writes to
the nonblocking stdout pipe then threw EAGAIN at driver line42. The receiving
catch tried to report worker-error through the same stdout sink and also threw
EAGAIN. The outer failure is the generic worker-exit assertion, not a product
value/progress assertion. Raw events cannot establish completeness after the
I/O error; gaps receive no semantic or reach credit.

No conflicting-cache-premise, answer-queued, answer-executed, or final-publication
receipt exists. This is instrumentation I/O failure before the conditional
premise, not queued-answer progress RED, semantic product RED, or product GREEN.
There was no heap/RSS/wall termination and no kill. Final binding elapsed2366ms;
maximum sampled receiving-group RSS was478609408bytes. These are measurements,
not product limits. The source envelope and accepted containment remain unchanged.

Outer PID/PGID78265/78265, parent Vitest worker78277, receiving PID/PGID78280/78280.
Supervisor last group rows and cleanup errors are empty. Root independently
checked PGIDs78265 and78280 with approved ps; both were empty. That is root's
observation, not an author process-list run. Direct Collection cleanup is not
established by these process observations or the missing worker-cleaned receipt.

The full1933-file raw receiving directory is copied under raw/ without changing
its bytes: worker output, source inventory, actual evaluated code, V8 scripts,
plugin logs, exact history, supervisor result, and binding result remain auditable.
Original path: /var/folders/zy/zxh2j5n97vq2tt8d8q7_1t5r0000gp/T/h02-progress-78277-400166e4-a247-400b-87ca-a6bc9bee6116.
All511 production,17 instrument and11 shared accepted files still match.
No source edit or rerun followed this attempt. Both earlier v3 setup-failure
packets remain intact and each had zero receiving executions.

Root separately authorized instrument-only regular-file receipt transport,
pure logging calibration and exact review. That successor is pending only;
no next receiving run, production change, model/grammar change, commit or
publication is authorized by this result.
